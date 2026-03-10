import dotenv from 'dotenv';
dotenv.config({ override: true });

export interface AppConfig {
  feishu: {
    appId: string;
    appSecret: string;
  };
  defaultPermissionMode: string;
  defaultAllowedTools: string[];
  defaultMaxTurns: number;
  logLevel: string;
  dbPath: string;
}

export function loadConfig(): AppConfig {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('Missing required env vars: FEISHU_APP_ID, FEISHU_APP_SECRET');
  }

  return {
    feishu: { appId, appSecret },
    defaultPermissionMode: process.env.DEFAULT_PERMISSION_MODE ?? 'bypassPermissions',
    defaultAllowedTools: (process.env.DEFAULT_ALLOWED_TOOLS ?? 'Read,Write,Edit,Bash,Glob,Grep').split(','),
    defaultMaxTurns: parseInt(process.env.DEFAULT_MAX_TURNS ?? '100', 10),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    dbPath: process.env.DB_PATH ?? './data/bridge.db',
  };
}
