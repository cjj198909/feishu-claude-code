// src/claude/bridge.ts
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'result';
  content: string;
  toolName?: string;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
}

export interface BridgeOptions {
  cwd: string;
  resume?: string;
  allowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
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

  get isBusy(): boolean {
    return this.busyAbortController !== null;
  }

  abort() {
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
      };

      logger.info('Starting Claude Code query', {
        cwd: options.cwd,
        resume: options.resume,
        pluginsCount: plugins.length
      });

      for await (const message of query({ prompt, options: queryOptions })) {
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
    } finally {
      this.busyAbortController = null;
    }
  }
}
