type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

function log(level: LogLevel, message: string, ...args: unknown[]) {
  if (LEVELS[level] >= LEVELS[currentLevel]) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    console[level === 'debug' ? 'log' : level](prefix, message, ...args);
  }
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', msg, ...args),
  info: (msg: string, ...args: unknown[]) => log('info', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log('warn', msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', msg, ...args),
};
