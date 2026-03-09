// src/core/question-manager.ts
import { logger } from '../utils/logger.js';

const TIMEOUT_MS = 120_000; // 2 minutes

export interface AskQuestion {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

/**
 * QuestionManager — coordinates between Claude's AskUserQuestion tool
 * and Feishu card form submissions.
 *
 * Flow:
 * 1. canUseTool Hook intercepts AskUserQuestion
 * 2. Hook calls waitForAnswers() which returns a Promise
 * 3. Router appends a form to the streaming card
 * 4. User fills form and submits → card.action.trigger event
 * 5. submitAnswers() resolves the Promise
 * 6. Hook returns the answers to Claude via updatedInput
 */
export class QuestionManager {
  private pending = new Map<string, {
    resolve: (answers: Record<string, string>) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  /**
   * Wait for user answers (called from canUseTool Hook).
   * Blocks until submitAnswers() is called or timeout.
   */
  async waitForAnswers(questionId: string): Promise<Record<string, string>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(questionId)) {
          logger.warn(`Question ${questionId} timed out after ${TIMEOUT_MS}ms`);
          this.pending.delete(questionId);
          resolve({}); // Empty = timeout
        }
      }, TIMEOUT_MS);

      this.pending.set(questionId, { resolve, timer });
    });
  }

  /**
   * Submit user answers (called from card.action.trigger handler).
   * Returns true if a pending question was resolved.
   */
  submitAnswers(questionId: string, answers: Record<string, string>): boolean {
    const entry = this.pending.get(questionId);
    if (!entry) {
      logger.warn(`No pending question for ID ${questionId}`);
      return false;
    }

    clearTimeout(entry.timer);
    this.pending.delete(questionId);
    entry.resolve(answers);
    logger.info(`Answers submitted for question ${questionId}`);
    return true;
  }

  /**
   * Cancel all pending questions (called on abort / task cleanup).
   * Clears timers so they don't fire after the SDK process is gone.
   */
  cancelAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      logger.info(`Question ${id} cancelled (task aborted)`);
      // Do NOT call entry.resolve() — the SDK process is already dead,
      // so resolving would trigger a write to a dead process.
    }
    this.pending.clear();
  }

  /**
   * Check if there's a pending question.
   */
  hasPending(): boolean {
    return this.pending.size > 0;
  }
}
