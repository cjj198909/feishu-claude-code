// src/claude/bridge.ts
import { query, type Options, type CanUseTool, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { QuestionManager, type AskQuestion } from '../core/question-manager.js';

/** Image attachment for multimodal prompts */
export interface Attachment {
  buffer: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

/** Detect image MIME type from magic bytes, default to image/png */
function detectImageMime(buf: Buffer): Attachment['mediaType'] {
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return 'image/png';
}

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'result' | 'ask_questions';
  content: string;
  toolName?: string;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  // Interactive questions
  questions?: AskQuestion[];
  questionId?: string;
}

export interface BridgeOptions {
  cwd: string;
  resume?: string;
  allowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  enableQuestions?: boolean;
  attachments?: Buffer[];
}

/**
 * Discover enabled plugins from ~/.claude/settings.json
 */
function discoverPlugins(): Array<{ type: 'local'; path: string }> {
  const homeDir = process.env.HOME;
  if (!homeDir) return [];

  const pluginConfigs: Array<{ type: 'local'; path: string }> = [];
  const userSettingsPath = join(homeDir, '.claude/settings.json');
  const pluginCacheDir = join(homeDir, '.claude/plugins/cache');

  try {
    if (!existsSync(userSettingsPath) || !existsSync(pluginCacheDir)) {
      return [];
    }

    const settings = JSON.parse(readFileSync(userSettingsPath, 'utf-8'));
    const enabledPlugins = settings.enabledPlugins || {};

    for (const [pluginId, enabled] of Object.entries(enabledPlugins)) {
      if (enabled !== true) continue;

      // Parse "plugin-name@marketplace-id"
      const parts = pluginId.split('@');
      if (parts.length !== 2) continue;

      const [pluginName, marketplaceId] = parts;
      const pluginDir = join(pluginCacheDir, marketplaceId, pluginName);

      if (!existsSync(pluginDir)) continue;

      // Get latest version
      const versions = readdirSync(pluginDir).sort();
      const latestVersion = versions[versions.length - 1];

      if (latestVersion) {
        const pluginPath = join(pluginDir, latestVersion);
        pluginConfigs.push({ type: 'local', path: pluginPath });
      }
    }

    logger.info(`Discovered ${pluginConfigs.length} plugins from cache`);
  } catch (error) {
    logger.warn('Error discovering plugins', { error });
  }

  return pluginConfigs;
}

export class ClaudeCodeBridge {
  private busyAbortController: AbortController | null = null;
  private questionManager: QuestionManager | null = null;

  get isBusy(): boolean {
    return this.busyAbortController !== null;
  }

  setQuestionManager(mgr: QuestionManager): void {
    this.questionManager = mgr;
  }

  abort() {
    // Cancel pending questions FIRST — their timers must not fire after
    // the SDK process is killed, otherwise they try to write to a dead process.
    if (this.questionManager) {
      this.questionManager.cancelAll();
    }
    if (this.busyAbortController) {
      this.busyAbortController.abort();
      this.busyAbortController = null;
    }
  }

  async execute(
    prompt: string,
    options: BridgeOptions,
    onStream: (event: StreamEvent) => void,
  ): Promise<void> {
    if (this.isBusy) {
      throw new Error('A task is already running');
    }

    const abortController = new AbortController();
    this.busyAbortController = abortController;

    try {
      // Discover and load plugins
      const plugins = discoverPlugins();

      // Build canUseTool Hook for intercepting AskUserQuestion
      let canUseTool: CanUseTool | undefined;
      {
        const mgr = options.enableQuestions ? this.questionManager : null;
        canUseTool = async (toolName, input, opts) => {
          // Block Bash commands that would restart/stop this bot's own PM2 process
          if (toolName === 'Bash') {
            const cmd = String(input.command ?? '');
            if (/pm2\s+(restart|stop|delete|kill|reload)\b/.test(cmd)) {
              logger.warn('Blocked self-destructive pm2 command:', cmd);
              return {
                behavior: 'deny' as const,
                message: 'Cannot restart/stop the bot PM2 process from within the bot. Apply changes by telling the user to restart manually.',
                toolUseID: opts.toolUseID,
              };
            }
          }

          // Intercept AskUserQuestion (only when questions are enabled)
          if (toolName !== 'AskUserQuestion' || !mgr) {
            return { behavior: 'allow' as const, toolUseID: opts.toolUseID };
          }

          logger.info('AskUserQuestion intercepted', { toolName, inputKeys: Object.keys(input) });

          // Extract questions from tool input
          const rawQuestions = (input.questions || []) as Array<{
            question: string;
            header?: string;
            options: Array<{ label: string; description?: string }>;
            multiSelect?: boolean;
          }>;

          if (rawQuestions.length === 0) {
            return {
              behavior: 'deny' as const,
              message: 'No questions provided',
              toolUseID: opts.toolUseID,
            };
          }

          const questions: AskQuestion[] = rawQuestions.map(q => ({
            question: q.question,
            header: q.header,
            options: q.options || [],
            multiSelect: q.multiSelect ?? false,
          }));

          // Generate unique question ID
          const questionId = `q_${Date.now()}_${opts.toolUseID.slice(0, 8)}`;

          // Emit ask_questions event → router will append form to card
          onStream({
            type: 'ask_questions',
            content: '',
            questions,
            questionId,
          });

          // Wait for user to submit form (blocks Hook until resolved)
          const answers = await mgr.waitForAnswers(questionId);

          if (Object.keys(answers).length === 0) {
            // Timeout or cancelled
            return {
              behavior: 'deny' as const,
              message: 'User did not provide answers (timeout)',
              toolUseID: opts.toolUseID,
            };
          }

          // Return answers via updatedInput
          logger.info('Returning answers to Claude', { questionId, answers });
          return {
            behavior: 'allow' as const,
            updatedInput: { ...input, answers },
            toolUseID: opts.toolUseID,
          };
        };
      }

      const queryOptions: Options = {
        cwd: options.cwd,

        // Enable Skills: load from user and project directories
        settingSources: ['user', 'project'],

        // Load discovered plugins (enables plugin skills)
        plugins,

        // Add 'Skill' to allowed tools if not already present
        allowedTools: options.allowedTools
          ? [...new Set([...options.allowedTools, 'Skill'])]
          : undefined,

        permissionMode:
          (options.permissionMode as Options['permissionMode']) ?? 'bypassPermissions',
        allowDangerouslySkipPermissions:
          options.permissionMode === 'bypassPermissions' || !options.permissionMode,
        maxTurns: options.maxTurns,
        abortController,
        resume: options.resume,
        canUseTool,
      };

      logger.info('Starting Claude Code query', {
        cwd: options.cwd,
        resume: options.resume,
        pluginsCount: plugins.length,
        questionsEnabled: !!canUseTool,
      });

      // Build prompt: multimodal (AsyncIterable) when attachments present, string otherwise
      let queryPrompt: string | AsyncIterable<SDKUserMessage> = prompt;
      if (options.attachments && options.attachments.length > 0) {
        const contentBlocks: Array<
          | { type: 'text'; text: string }
          | { type: 'image'; source: { type: 'base64'; media_type: Attachment['mediaType']; data: string } }
        > = [];

        // Add image blocks first
        for (const buf of options.attachments) {
          const mime = detectImageMime(buf);
          contentBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: mime, data: buf.toString('base64') },
          });
        }

        // Add text prompt
        contentBlocks.push({ type: 'text', text: prompt });

        const userMessage: SDKUserMessage = {
          type: 'user' as const,
          session_id: '',
          message: { role: 'user' as const, content: contentBlocks as any },
          parent_tool_use_id: null,
        };
        queryPrompt = (async function* () { yield userMessage; })();

        logger.info('Using multimodal prompt', {
          imageCount: options.attachments.length,
          mimeTypes: options.attachments.map(b => detectImageMime(b)),
        });
      }

      for await (const message of query({ prompt: queryPrompt, options: queryOptions })) {
        if (abortController.signal.aborted) break;

        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              onStream({ type: 'text', content: block.text });
            } else if (block.type === 'tool_use') {
              onStream({ type: 'tool_use', content: block.name, toolName: block.name });
            }
          }
        } else if (message.type === 'result') {
          onStream({
            type: 'result',
            content: message.subtype === 'success' ? (message as any).result ?? '' : '',
            sessionId: message.session_id,
            costUsd: message.total_cost_usd,
            durationMs: message.duration_ms,
            numTurns: message.num_turns,
          });
        }
      }
    } catch (err) {
      // SDK throws "Operation aborted" internally when abortController fires.
      // Re-throw only if it is NOT an expected abort so the caller can show the
      // correct card state (aborted vs error).
      const msg = (err as Error)?.message ?? String(err);
      if (abortController.signal.aborted || /abort/i.test(msg)) {
        logger.info('Claude Code query aborted');
        throw err; // let router handle abort card
      }
      logger.error('Claude Code query error:', msg);
      throw err;
    } finally {
      // Clean up any pending questions whose timers would otherwise fire
      // and try to write to the now-dead SDK process
      if (this.questionManager) {
        this.questionManager.cancelAll();
      }
      this.busyAbortController = null;
    }
  }
}
