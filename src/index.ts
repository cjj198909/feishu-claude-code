// Allow spawning Claude Code subprocess from within a Claude Code session
delete process.env.CLAUDECODE;

import { loadConfig } from './utils/config.js';
import { setLogLevel, logger } from './utils/logger.js';
import { Database } from './db/database.js';
import { SessionManager } from './core/session.js';
import { ClaudeCodeBridge } from './claude/bridge.js';
import { FeishuBot } from './feishu/bot.js';
import { MessageRouter } from './core/router.js';

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection (process kept alive):', reason);
});

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel as any);

  logger.info('Starting Feishu Claude Code Bridge...');

  // Init database
  const db = new Database(config.dbPath);
  logger.info(`Database initialized at ${config.dbPath}`);

  // Init components
  const session = new SessionManager(db);
  const bridge = new ClaudeCodeBridge();
  const bot = new FeishuBot(config.feishu.appId, config.feishu.appSecret);
  const router = new MessageRouter(session, bridge, bot);

  // Wire up message handler
  bot.setMessageHandler(async (event) => {
    logger.info(`Message from ${event.senderId}: ${event.msgType}`);
    await router.handle(event);
  });

  // Start Feishu WebSocket
  await bot.start();
  logger.info('Bot is running. Waiting for messages...');

  // Graceful shutdown — abort running queries so cards get updated before exit
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return; // Prevent double-shutdown
    shuttingDown = true;
    logger.info('Shutting down...');

    // Abort running Claude Code query — this triggers the abort card update
    bridge.abort();

    // Give a brief window for in-flight card updates to complete, then exit
    setTimeout(() => {
      db.close();
      process.exit(0);
    }, 3000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
