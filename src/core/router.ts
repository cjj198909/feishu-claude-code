// src/core/router.ts
import { existsSync } from 'fs';
import { parse } from './command.js';
import { SessionManager } from './session.js';
import { QuestionManager } from './question-manager.js';
import { ClaudeCodeBridge, type StreamEvent } from '../claude/bridge.js';
import { FeishuBot, type MessageHandler, type CardActionEvent } from '../feishu/bot.js';
import { buildStreamingCard, buildDoneStreamingCard, buildErrorStreamingCard, buildAbortedStreamingCard, buildProcessingStreamingCard, buildRunningCard, buildDoneCard, buildErrorCard, buildAbortedCard, buildQuestionFormElements, ELEMENT_IDS } from '../feishu/card.js';
import { saveImage } from '../feishu/image.js';
import { logger } from '../utils/logger.js';

export class MessageRouter {
  private sessions: SessionManager;
  private bridge: ClaudeCodeBridge;
  private bot: FeishuBot;
  private questionMgr: QuestionManager;

  constructor(sessions: SessionManager, bridge: ClaudeCodeBridge, bot: FeishuBot) {
    this.sessions = sessions;
    this.bridge = bridge;
    this.bot = bot;
    this.questionMgr = new QuestionManager();

    // Wire QuestionManager into the bridge (enables canUseTool Hook)
    this.bridge.setQuestionManager(this.questionMgr);

    // Register card action handler for form submissions
    this.bot.setCardActionHandler(this.handleCardAction.bind(this));
  }

  /**
   * Main entry point — wire this to FeishuBot.setMessageHandler().
   */
  handle: MessageHandler = async (event) => {
    const { chatId, msgType, content, messageId, imageKey } = event;

    try {
      if (msgType === 'text') {
        let text: string;
        try {
          const parsed = JSON.parse(content);
          text = parsed.text ?? '';
        } catch {
          text = content;
        }
        // Strip @bot mentions
        text = text.replace(/@_user_\d+/g, '').trim();

        if (!text) return;

        const result = parse(text);
        if (result.type === 'command') {
          await this.handleCommand(chatId, result.name, result.args);
        } else {
          await this.handlePrompt(chatId, result.text);
        }
      } else if (msgType === 'image') {
        if (!imageKey) {
          await this.bot.sendText(chatId, 'Failed to get image key from message.');
          return;
        }
        const buffer = await this.bot.downloadImage(messageId, imageKey);
        const filepath = saveImage(buffer, 'png');
        const prompt = `Please look at this image: ${filepath}`;
        await this.handlePrompt(chatId, prompt);
      } else if (msgType === 'post') {
        // Rich text (post) message — extract text and images
        await this.handlePostMessage(chatId, messageId, content);
      } else {
        await this.bot.sendText(chatId, `Unsupported message type: ${msgType}. Please send text or image.`);
      }
    } catch (err) {
      logger.error('Unhandled error in MessageRouter.handle', err);
      await this.bot.sendText(chatId, `Internal error: ${(err as Error).message}`).catch(() => {});
    }
  };

  // ─── Command handlers ───────────────────────────────────────────

  private async handleCommand(chatId: string, name: string, args: string[]): Promise<void> {
    try {
      switch (name) {
        case 'add':
          await this.cmdAdd(chatId, args);
          break;
        case 'remove':
          await this.cmdRemove(chatId, args);
          break;
        case 'use':
          await this.cmdUse(chatId, args);
          break;
        case 'list':
          await this.cmdList(chatId);
          break;
        case 'status':
          await this.cmdStatus(chatId);
          break;
        case 'reset':
          await this.cmdReset(chatId);
          break;
        case 'stop':
          await this.cmdStop(chatId);
          break;
        case 'history':
          await this.cmdHistory(chatId);
          break;
        case 'resume':
          await this.cmdResume(chatId, args);
          break;
        case 'config':
          await this.cmdConfig(chatId, args);
          break;
        case 'cost':
          await this.cmdCost(chatId);
          break;
        case 'help':
          await this.cmdHelp(chatId);
          break;
        default:
          await this.bot.sendText(chatId, `Unknown command: /${name}. Use /help for a list of commands.`);
      }
    } catch (err) {
      await this.bot.sendText(chatId, `Command error: ${(err as Error).message}`);
    }
  }

  private async cmdAdd(chatId: string, args: string[]): Promise<void> {
    if (args.length < 2) {
      await this.bot.sendText(chatId, 'Usage: /add <name> <path>');
      return;
    }
    const [name, path] = args;
    if (!existsSync(path)) {
      await this.bot.sendText(chatId, `Path does not exist: ${path}`);
      return;
    }
    this.sessions.addProject(name, path);
    this.sessions.switchProject(name);
    await this.bot.sendText(chatId, `Project "${name}" added and switched to (${path}).`);
  }

  private async cmdRemove(chatId: string, args: string[]): Promise<void> {
    if (args.length < 1) {
      await this.bot.sendText(chatId, 'Usage: /remove <name>');
      return;
    }
    this.sessions.removeProject(args[0]);
    await this.bot.sendText(chatId, `Project "${args[0]}" removed.`);
  }

  private async cmdUse(chatId: string, args: string[]): Promise<void> {
    if (args.length < 1) {
      await this.bot.sendText(chatId, 'Usage: /use <name>');
      return;
    }
    this.sessions.switchProject(args[0]);
    const sessionId = this.sessions.getCurrentSessionId();
    const sessionInfo = sessionId ? `\nActive session: ${sessionId}` : '\nNo active session.';
    await this.bot.sendText(chatId, `Switched to project "${args[0]}".${sessionInfo}`);
  }

  private async cmdList(chatId: string): Promise<void> {
    const projects = this.sessions.listProjects();
    if (projects.length === 0) {
      await this.bot.sendText(chatId, 'No projects registered. Use /add <name> <path> to add one.');
      return;
    }
    const active = this.sessions.getActiveProject();
    const lines = projects.map(p => {
      const marker = active && active.name === p.name ? ' (active)' : '';
      return `- ${p.name}: ${p.path}${marker}`;
    });
    await this.bot.sendText(chatId, `Projects:\n${lines.join('\n')}`);
  }

  private async cmdStatus(chatId: string): Promise<void> {
    const project = this.sessions.getActiveProject();
    const projectInfo = project ? `Project: ${project.name} (${project.path})` : 'No active project';
    const sessionId = this.sessions.getCurrentSessionId();
    const sessionInfo = sessionId ? `Session: ${sessionId}` : 'No active session';
    const busyInfo = `Busy: ${this.bridge.isBusy ? 'yes' : 'no'}`;
    await this.bot.sendText(chatId, `${projectInfo}\n${sessionInfo}\n${busyInfo}`);
  }

  private async cmdReset(chatId: string): Promise<void> {
    this.sessions.resetCurrentSession();
    await this.bot.sendText(chatId, 'Session reset. Next prompt will start a new conversation.');
  }

  private async cmdStop(chatId: string): Promise<void> {
    if (!this.bridge.isBusy) {
      await this.bot.sendText(chatId, 'No task is running.');
      return;
    }
    this.bridge.abort();
    await this.bot.sendText(chatId, 'Abort signal sent.');
  }

  private async cmdHistory(chatId: string): Promise<void> {
    const sessions = this.sessions.getSessionHistory();
    if (sessions.length === 0) {
      await this.bot.sendText(chatId, 'No session history.');
      return;
    }
    const lines = sessions.map(s => {
      const active = s.is_active ? ' (active)' : '';
      const summary = s.summary ? ` - ${s.summary}` : '';
      return `#${s.id}: ${s.session_id.slice(0, 8)}...${active}${summary}`;
    });
    await this.bot.sendText(chatId, `Sessions:\n${lines.join('\n')}`);
  }

  private async cmdResume(chatId: string, args: string[]): Promise<void> {
    if (args.length < 1) {
      await this.bot.sendText(chatId, 'Usage: /resume <id>');
      return;
    }
    const dbId = parseInt(args[0], 10);
    if (isNaN(dbId)) {
      await this.bot.sendText(chatId, 'Invalid session ID. Must be a number.');
      return;
    }
    this.sessions.resumeSession(dbId);
    await this.bot.sendText(chatId, `Resumed session #${dbId}.`);
  }

  private async cmdConfig(chatId: string, args: string[]): Promise<void> {
    if (args.length < 2) {
      await this.bot.sendText(chatId, 'Usage: /config <key> <value>\nKeys: permission_mode, allowed_tools, max_turns, description');
      return;
    }
    const [key, ...rest] = args;
    const value = rest.join(' ');
    this.sessions.updateProjectConfig(key, value);
    await this.bot.sendText(chatId, `Config "${key}" updated to "${value}".`);
  }

  private async cmdCost(chatId: string): Promise<void> {
    const stats = this.sessions.getUsageStats();
    const lines = [
      `Today:  $${stats.today.cost.toFixed(4)} | ${stats.today.calls} calls | ${stats.today.turns} turns`,
      `Week:   $${stats.week.cost.toFixed(4)} | ${stats.week.calls} calls | ${stats.week.turns} turns`,
      `Month:  $${stats.month.cost.toFixed(4)} | ${stats.month.calls} calls | ${stats.month.turns} turns`,
      `Total:  $${stats.total.cost.toFixed(4)} | ${stats.total.calls} calls | ${stats.total.turns} turns`,
    ];
    const projectEntries = Object.entries(stats.byProject);
    if (projectEntries.length > 0) {
      lines.push('', 'By project:');
      for (const [name, data] of projectEntries) {
        lines.push(`  ${name}: $${data.cost.toFixed(4)} | ${data.calls} calls`);
      }
    }
    await this.bot.sendText(chatId, lines.join('\n'));
  }

  private async cmdHelp(chatId: string): Promise<void> {
    const help = [
      '/add <name> <path> - Register a project',
      '/remove <name> - Remove a project',
      '/use <name> - Switch to a project',
      '/list - List all projects',
      '/status - Show current status',
      '/reset - Reset current session',
      '/stop - Abort running task',
      '/history - Show session history',
      '/resume <id> - Resume a session',
      '/config <key> <value> - Update project config',
      '/cost - Show usage statistics',
      '/help - Show this help',
    ];
    await this.bot.sendText(chatId, help.join('\n'));
  }

  // ─── Post (rich text) handling ──────────────────────────────────

  private async handlePostMessage(chatId: string, messageId: string, content: string): Promise<void> {
    try {
      const parsed = JSON.parse(content);
      // post content can be localized: { "zh_cn": { "title": "...", "content": [[...]] } }
      // or directly { "title": "...", "content": [[...]] }
      const postBody = parsed.zh_cn || parsed.en_us || parsed.ja_jp || parsed;
      const lines: Array<Array<{ tag: string; text?: string; image_key?: string }>> = postBody.content || [];

      const textParts: string[] = [];
      const imagePaths: string[] = [];

      for (const line of lines) {
        for (const element of line) {
          if (element.tag === 'text' && element.text) {
            textParts.push(element.text);
          } else if (element.tag === 'img' && element.image_key) {
            try {
              const buffer = await this.bot.downloadImage(messageId, element.image_key);
              const filepath = saveImage(buffer, 'png');
              imagePaths.push(filepath);
            } catch (e) {
              logger.error('Failed to download image from post:', e);
            }
          }
        }
      }

      // Build prompt combining text and image paths
      let prompt = textParts.join('').replace(/@_user_\d+/g, '').trim();
      if (imagePaths.length > 0) {
        const imageRefs = imagePaths.map(p => `Image: ${p}`).join('\n');
        prompt = prompt ? `${prompt}\n\n${imageRefs}` : `Please look at these images:\n${imageRefs}`;
      }

      if (!prompt) return;

      // Check if it's a command
      const result = parse(prompt);
      if (result.type === 'command') {
        await this.handleCommand(chatId, result.name, result.args);
      } else {
        await this.handlePrompt(chatId, result.text);
      }
    } catch (err) {
      logger.error('Failed to parse post message:', err);
      await this.bot.sendText(chatId, 'Failed to parse rich text message.');
    }
  }

  // ─── Prompt handling ────────────────────────────────────────────

  private async handlePrompt(chatId: string, text: string): Promise<void> {
    const project = this.sessions.getActiveProject();
    if (!project) {
      await this.bot.sendText(chatId, 'No active project. Use /use <name> to select one, or /add <name> <path> to register.');
      return;
    }

    if (this.bridge.isBusy) {
      await this.bot.sendText(chatId, 'A task is already running. Please wait or use /stop to abort it.');
      return;
    }

    const projectName = project.name;
    const startTime = Date.now();

    // Try streaming card (cardkit JSON 2.0), fall back to legacy card
    let cardMessageId: string;
    let useCardkit = false;

    try {
      const streamCard = buildStreamingCard(projectName);
      cardMessageId = await this.bot.sendStreamingCard(chatId, streamCard);
      useCardkit = true;
      logger.info('Streaming card created via cardkit');
    } catch (err) {
      logger.warn('Cardkit streaming failed, falling back to legacy card:', err);
      const card = buildRunningCard(projectName, [], '', 0);
      cardMessageId = await this.bot.sendCard(chatId, card);
    }

    // Streaming state
    const toolCalls: string[] = [];
    let latestText = '';
    let lastUpdateTime = 0;
    let resultSessionId: string | undefined;
    let resultCost = 0;
    let resultTurns = 0;
    let aborted = false;

    const resumeSessionId = this.sessions.getCurrentSessionId();

    try {
      await this.bridge.execute(
        text,
        {
          cwd: project.path,
          resume: resumeSessionId ?? undefined,
          allowedTools: project.allowed_tools ? project.allowed_tools.split(',') : undefined,
          permissionMode: project.permission_mode,
          maxTurns: project.max_turns,
          enableQuestions: useCardkit, // Only enable interactive questions when cardkit is available
        },
        (event: StreamEvent) => {
          if (event.type === 'tool_use' && event.toolName) {
            toolCalls.push(event.toolName);
          } else if (event.type === 'text') {
            latestText = event.content;
          } else if (event.type === 'ask_questions' && useCardkit) {
            // Claude wants to ask the user a question — show an interactive form
            // 1. Close streaming mode so form interactions are enabled
            // 2. Append question form elements to the card
            // Note: bridge is blocked in canUseTool Hook awaiting the answer
            logger.info('Appending question form to card', {
              questionId: event.questionId,
              questionCount: event.questions?.length,
            });
            (async () => {
              try {
                await this.bot.closeCardStreaming(cardMessageId);
                const formElements = buildQuestionFormElements(
                  event.questions!,
                  event.questionId!,
                  chatId,
                  projectName,
                );
                await this.bot.appendCardElements(cardMessageId, formElements);
              } catch (e) {
                logger.error('Failed to append question form', e);
              }
            })();
            return;
          } else if (event.type === 'result') {
            resultSessionId = event.sessionId;
            resultCost = event.costUsd ?? 0;
            resultTurns = event.numTurns ?? 0;
            // Save session and record usage
            if (event.sessionId) {
              const summary = latestText.slice(0, 200) || null;
              try { this.sessions.saveCurrentSession(event.sessionId, summary); } catch (e) { logger.error('Failed to save session', e); }
            }
            if (event.costUsd != null && event.durationMs != null && event.numTurns != null) {
              try { this.sessions.recordUsage(event.sessionId ?? null, event.costUsd, event.durationMs, event.numTurns); } catch (e) { logger.error('Failed to record usage', e); }
            }
            // Skip further updates - done card will be sent after execute() completes
            return;
          }

          // Throttle updates to 800ms
          const now = Date.now();
          if (now - lastUpdateTime >= 800) {
            lastUpdateTime = now;

            if (useCardkit) {
              // Element-level update (efficient, preserves card structure)
              this.bot.updateCardElement(cardMessageId, ELEMENT_IDS.mainContent, latestText)
                .catch(e => logger.error('Failed to update card element', e));
            } else {
              // Legacy: full card replacement
              const elapsedSec = Math.round((now - startTime) / 1000);
              const runCard = buildRunningCard(projectName, toolCalls, latestText, elapsedSec);
              this.bot.updateCard(cardMessageId, runCard)
                .catch(e => logger.error('Failed to update running card', e));
            }
          }
        },
      );

      // Execution completed successfully
      if (!aborted && resultSessionId !== undefined) {
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);

        if (useCardkit) {
          // Full card update: replaces header (green ✅) + body + closes streaming
          const doneStreamCard = buildDoneStreamingCard(projectName, latestText || 'Done.', {
            tools: this.summarizeTools(toolCalls),
            elapsed: elapsedSec,
            cost: resultCost,
            turns: resultTurns,
          });
          await this.bot.updateStreamingCard(cardMessageId, doneStreamCard)
            .catch(e => logger.error('Failed to update done streaming card', e));
        } else {
          // Legacy: full card replacement
          const doneCard = buildDoneCard(projectName, latestText || 'Done.', {
            tools: this.summarizeTools(toolCalls),
            elapsed: elapsedSec,
            cost: resultCost,
            turns: resultTurns,
          });
          await this.bot.updateCard(cardMessageId, doneCard)
            .catch(e => logger.error('Failed to update done card', e));
        }
      }
    } catch (err) {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      const message = (err as Error).message ?? String(err);

      if (message.includes('abort') || message.includes('Abort')) {
        aborted = true;
        if (useCardkit) {
          const abortStreamCard = buildAbortedStreamingCard(projectName, latestText, elapsedSec);
          await this.bot.updateStreamingCard(cardMessageId, abortStreamCard).catch(() => {});
        } else {
          const abortCard = buildAbortedCard(projectName, latestText, elapsedSec);
          await this.bot.updateCard(cardMessageId, abortCard).catch(e => logger.error('Failed to update aborted card', e));
        }
      } else {
        if (useCardkit) {
          const errStreamCard = buildErrorStreamingCard(projectName, message, elapsedSec);
          await this.bot.updateStreamingCard(cardMessageId, errStreamCard).catch(() => {});
        } else {
          const errCard = buildErrorCard(projectName, message, elapsedSec);
          await this.bot.updateCard(cardMessageId, errCard).catch(e => logger.error('Failed to update error card', e));
        }
      }
    }
  }

  // ─── Card action handler (form submissions) ────────────────────

  private async handleCardAction(event: CardActionEvent): Promise<void> {
    const value = event.action?.value;
    if (value?.['_fcc_action'] !== 'questions_submit') return;

    const questionId = value['_fcc_question_id'] as string | undefined;
    const projectName = value['_fcc_project_name'] as string | undefined;
    const messageId = event.context?.open_message_id;
    const formValue = event.action?.form_value ?? {};

    if (!questionId) {
      logger.warn('Card action: missing question_id');
      return;
    }

    // Reconstruct ordered answers from q0, q1, … keys
    const answers: Record<string, string> = {};
    for (const [key, val] of Object.entries(formValue)) {
      if (/^q\d+$/.test(key)) {
        answers[key] = val;
      }
    }

    if (Object.keys(answers).length === 0) {
      logger.warn('Card action: form_value has no q* entries');
      return;
    }

    logger.info('Card form submitted', { questionId, answers });

    // Immediately update card: remove form, show "processing", re-enable streaming
    if (messageId && projectName) {
      const processingCard = buildProcessingStreamingCard(projectName);
      await this.bot.reopenCardStreaming(messageId, processingCard)
        .catch(e => logger.error('Failed to update card to processing state', e));
    }

    // Submit answers — resolves the Promise in canUseTool Hook
    const submitted = this.questionMgr.submitAnswers(questionId, answers);
    if (!submitted) {
      logger.warn(`No pending question for ID ${questionId} (may have timed out)`);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  summarizeTools(toolCalls: string[]): string {
    if (toolCalls.length === 0) return 'none';
    const counts = new Map<string, number>();
    for (const name of toolCalls) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => `${name}x${count}`)
      .join(', ');
  }
}
