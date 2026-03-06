import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load required feishu config', async () => {
    process.env.FEISHU_APP_ID = 'test_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();
    expect(config.feishu.appId).toBe('test_id');
    expect(config.feishu.appSecret).toBe('test_secret');
  });

  it('should throw if required env vars missing', async () => {
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    const { loadConfig } = await import('../config.js');
    expect(() => loadConfig()).toThrow();
  });

  it('should use defaults for optional config', async () => {
    process.env.FEISHU_APP_ID = 'test_id';
    process.env.FEISHU_APP_SECRET = 'test_secret';
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();
    expect(config.defaultPermissionMode).toBe('bypassPermissions');
    expect(config.defaultMaxTurns).toBe(100);
    expect(config.dbPath).toBe('./data/bridge.db');
  });
});
