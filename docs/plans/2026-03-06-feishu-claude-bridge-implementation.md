# Feishu x Claude Code Bridge - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Node.js service that bridges Feishu IM with Claude Code Agent SDK, enabling a personal bot to manage multiple projects with session persistence and streaming card output.

**Architecture:** Single-process Node.js server. Feishu WSClient receives messages, routes them to either a command handler or the Claude Code bridge. Claude Code responses stream back as Feishu interactive card updates. SQLite stores projects, sessions, and usage stats.

**Tech Stack:** Node.js 20+ TypeScript ESM, @anthropic-ai/claude-agent-sdk, @larksuiteoapi/node-sdk, better-sqlite3, dotenv, vitest (testing)

**Design Doc:** `docs/plans/2026-03-06-feishu-claude-bridge-design.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/index.ts` (placeholder)

**Step 1: Initialize package.json**

```json
{
  "name": "feishu-claude-bridge",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 2: Install dependencies**

Run:
```bash
npm install @anthropic-ai/claude-agent-sdk @larksuiteoapi/node-sdk better-sqlite3 dotenv
npm install -D typescript tsx vitest @types/better-sqlite3 @types/node
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "data"]
}
```

**Step 4: Create .env.example**

```bash
# Feishu
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxx

# Claude Code
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx

# Optional
DEFAULT_PERMISSION_MODE=bypassPermissions
DEFAULT_ALLOWED_TOOLS=Read,Write,Edit,Bash,Glob,Grep
DEFAULT_MAX_TURNS=100
LOG_LEVEL=info
DB_PATH=./data/bridge.db
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
data/
.env
*.db
```

**Step 6: Create placeholder entry point**

```typescript
// src/index.ts
console.log('feishu-claude-bridge starting...');
```

**Step 7: Verify build works**

Run: `npx tsx src/index.ts`
Expected: prints "feishu-claude-bridge starting..."

**Step 8: Commit**

```bash
git init && git add -A && git commit -m "chore: project scaffolding"
```

---

## Task 2: Config & Logger Utilities

**Files:**
- Create: `src/utils/config.ts`
- Create: `src/utils/logger.ts`
- Create: `src/utils/__tests__/config.test.ts`

**Step 1: Write config test**

```typescript
// src/utils/__tests__/config.test.ts
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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/config.test.ts`
Expected: FAIL

**Step 3: Implement config.ts**

```typescript
// src/utils/config.ts
import 'dotenv/config';

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
```

**Step 4: Implement logger.ts**

```typescript
// src/utils/logger.ts
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
```

**Step 5: Run tests**

Run: `npx vitest run src/utils/__tests__/config.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/utils/ && git commit -m "feat: add config loader and logger"
```

---

## Task 3: Database Layer

**Files:**
- Create: `src/db/database.ts`
- Create: `src/db/__tests__/database.test.ts`

**Step 1: Write database test**

```typescript
// src/db/__tests__/database.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../database.js';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('should create all tables on init', () => {
    const tables = db.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('projects');
    expect(names).toContain('sessions');
    expect(names).toContain('usage_stats');
  });

  // --- projects ---
  it('should add and list projects', () => {
    db.addProject('myapp', '/home/user/myapp');
    const projects = db.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('myapp');
    expect(projects[0].path).toBe('/home/user/myapp');
  });

  it('should reject duplicate project names', () => {
    db.addProject('myapp', '/path/a');
    expect(() => db.addProject('myapp', '/path/b')).toThrow();
  });

  it('should remove a project', () => {
    db.addProject('myapp', '/path/a');
    db.removeProject('myapp');
    expect(db.listProjects()).toHaveLength(0);
  });

  it('should get project by name', () => {
    db.addProject('myapp', '/path/a', { description: 'test' });
    const p = db.getProject('myapp');
    expect(p?.description).toBe('test');
  });

  it('should update project config', () => {
    db.addProject('myapp', '/path/a');
    db.updateProjectConfig('myapp', 'permission_mode', 'acceptEdits');
    const p = db.getProject('myapp');
    expect(p?.permission_mode).toBe('acceptEdits');
  });

  // --- sessions ---
  it('should save and get active session', () => {
    db.addProject('myapp', '/path/a');
    db.saveSession('myapp', 'sess-123', 'did stuff');
    db.setActiveSession('myapp', 1);
    const s = db.getActiveSession('myapp');
    expect(s?.session_id).toBe('sess-123');
  });

  it('should list session history', () => {
    db.addProject('myapp', '/path/a');
    db.saveSession('myapp', 'sess-1', 'first');
    db.saveSession('myapp', 'sess-2', 'second');
    const history = db.listSessions('myapp');
    expect(history).toHaveLength(2);
  });

  // --- usage_stats ---
  it('should record and query usage', () => {
    db.addProject('myapp', '/path/a');
    db.recordUsage('myapp', 'sess-1', 0.05, 1500, 10);
    db.recordUsage('myapp', 'sess-2', 0.03, 800, 5);
    const stats = db.getUsageStats();
    expect(stats.total.cost).toBeCloseTo(0.08);
    expect(stats.total.calls).toBe(2);
    expect(stats.byProject['myapp'].cost).toBeCloseTo(0.08);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/database.test.ts`
Expected: FAIL

**Step 3: Implement database.ts**

```typescript
// src/db/database.ts
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export interface Project {
  id: number;
  name: string;
  path: string;
  description: string | null;
  permission_mode: string;
  allowed_tools: string;
  max_turns: number;
  created_at: string;
}

export interface Session {
  id: number;
  project_name: string;
  session_id: string;
  summary: string | null;
  is_active: number;
  last_used_at: string | null;
  created_at: string;
}

export interface UsageStats {
  total: { cost: number; calls: number; turns: number };
  today: { cost: number; calls: number; turns: number };
  week: { cost: number; calls: number; turns: number };
  month: { cost: number; calls: number; turns: number };
  byProject: Record<string, { cost: number; calls: number }>;
}

export class Database {
  db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        path TEXT NOT NULL,
        description TEXT,
        permission_mode TEXT DEFAULT 'bypassPermissions',
        allowed_tools TEXT DEFAULT 'Read,Write,Edit,Bash,Glob,Grep',
        max_turns INTEGER DEFAULT 100,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        summary TEXT,
        is_active BOOLEAN DEFAULT 0,
        last_used_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS usage_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        session_id TEXT,
        cost_usd REAL DEFAULT 0,
        duration_ms INTEGER,
        num_turns INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // --- Projects ---

  addProject(name: string, path: string, options?: { description?: string; permission_mode?: string; allowed_tools?: string; max_turns?: number }) {
    this.db.prepare(
      'INSERT INTO projects (name, path, description, permission_mode, allowed_tools, max_turns) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      name, path,
      options?.description ?? null,
      options?.permission_mode ?? 'bypassPermissions',
      options?.allowed_tools ?? 'Read,Write,Edit,Bash,Glob,Grep',
      options?.max_turns ?? 100
    );
  }

  removeProject(name: string) {
    this.db.prepare('DELETE FROM projects WHERE name = ?').run(name);
    this.db.prepare('DELETE FROM sessions WHERE project_name = ?').run(name);
  }

  getProject(name: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as Project | undefined;
  }

  listProjects(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY name').all() as Project[];
  }

  updateProjectConfig(name: string, key: string, value: string) {
    const allowed = ['permission_mode', 'allowed_tools', 'max_turns', 'description'];
    if (!allowed.includes(key)) throw new Error(`Invalid config key: ${key}`);
    this.db.prepare(`UPDATE projects SET ${key} = ? WHERE name = ?`).run(value, name);
  }

  // --- Sessions ---

  saveSession(projectName: string, sessionId: string, summary: string | null) {
    // Deactivate all sessions for this project
    this.db.prepare('UPDATE sessions SET is_active = 0 WHERE project_name = ?').run(projectName);
    // Insert new active session
    this.db.prepare(
      'INSERT INTO sessions (project_name, session_id, summary, is_active, last_used_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)'
    ).run(projectName, sessionId, summary);
  }

  setActiveSession(projectName: string, sessionDbId: number) {
    this.db.prepare('UPDATE sessions SET is_active = 0 WHERE project_name = ?').run(projectName);
    this.db.prepare('UPDATE sessions SET is_active = 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(sessionDbId);
  }

  getActiveSession(projectName: string): Session | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE project_name = ? AND is_active = 1').get(projectName) as Session | undefined;
  }

  listSessions(projectName: string): Session[] {
    return this.db.prepare('SELECT * FROM sessions WHERE project_name = ? ORDER BY created_at DESC').all(projectName) as Session[];
  }

  resetSession(projectName: string) {
    this.db.prepare('UPDATE sessions SET is_active = 0 WHERE project_name = ?').run(projectName);
  }

  getSessionById(id: number): Session | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  }

  // --- Usage Stats ---

  recordUsage(projectName: string, sessionId: string | null, costUsd: number, durationMs: number, numTurns: number) {
    this.db.prepare(
      'INSERT INTO usage_stats (project_name, session_id, cost_usd, duration_ms, num_turns) VALUES (?, ?, ?, ?, ?)'
    ).run(projectName, sessionId, costUsd, durationMs, numTurns);
  }

  getUsageStats(): UsageStats {
    const total = this.db.prepare(
      'SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls, COALESCE(SUM(num_turns),0) as turns FROM usage_stats'
    ).get() as { cost: number; calls: number; turns: number };

    const today = this.db.prepare(
      "SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls, COALESCE(SUM(num_turns),0) as turns FROM usage_stats WHERE date(created_at) = date('now')"
    ).get() as { cost: number; calls: number; turns: number };

    const week = this.db.prepare(
      "SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls, COALESCE(SUM(num_turns),0) as turns FROM usage_stats WHERE created_at >= datetime('now', '-7 days')"
    ).get() as { cost: number; calls: number; turns: number };

    const month = this.db.prepare(
      "SELECT COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls, COALESCE(SUM(num_turns),0) as turns FROM usage_stats WHERE created_at >= datetime('now', '-30 days')"
    ).get() as { cost: number; calls: number; turns: number };

    const byProjectRows = this.db.prepare(
      'SELECT project_name, COALESCE(SUM(cost_usd),0) as cost, COUNT(*) as calls FROM usage_stats GROUP BY project_name'
    ).all() as { project_name: string; cost: number; calls: number }[];

    const byProject: Record<string, { cost: number; calls: number }> = {};
    for (const row of byProjectRows) {
      byProject[row.project_name] = { cost: row.cost, calls: row.calls };
    }

    return { total, today, week, month, byProject };
  }

  close() {
    this.db.close();
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/db/__tests__/database.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/db/ && git commit -m "feat: SQLite database layer with projects, sessions, usage_stats"
```

---

## Task 4: Command Parser

**Files:**
- Create: `src/core/command.ts`
- Create: `src/core/__tests__/command.test.ts`

**Step 1: Write command parser test**

```typescript
// src/core/__tests__/command.test.ts
import { describe, it, expect } from 'vitest';
import { parse } from '../command.js';

describe('parse', () => {
  it('should parse /add command', () => {
    const result = parse('/add frontend /home/user/frontend');
    expect(result).toEqual({ type: 'command', name: 'add', args: ['frontend', '/home/user/frontend'] });
  });

  it('should parse /use command', () => {
    const result = parse('/use backend');
    expect(result).toEqual({ type: 'command', name: 'use', args: ['backend'] });
  });

  it('should parse /list with no args', () => {
    const result = parse('/list');
    expect(result).toEqual({ type: 'command', name: 'list', args: [] });
  });

  it('should parse /config with key value', () => {
    const result = parse('/config permission_mode acceptEdits');
    expect(result).toEqual({ type: 'command', name: 'config', args: ['permission_mode', 'acceptEdits'] });
  });

  it('should parse /resume with id', () => {
    const result = parse('/resume 3');
    expect(result).toEqual({ type: 'command', name: 'resume', args: ['3'] });
  });

  it('should treat non-slash messages as prompts', () => {
    const result = parse('help me fix the bug');
    expect(result).toEqual({ type: 'prompt', text: 'help me fix the bug' });
  });

  it('should treat empty messages as prompts', () => {
    const result = parse('');
    expect(result).toEqual({ type: 'prompt', text: '' });
  });

  it('should handle /cost and /help and /stop and /reset and /status and /history', () => {
    for (const cmd of ['cost', 'help', 'stop', 'reset', 'status', 'history']) {
      const result = parse(`/${cmd}`);
      expect(result).toEqual({ type: 'command', name: cmd, args: [] });
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/command.test.ts`
Expected: FAIL

**Step 3: Implement command.ts**

```typescript
// src/core/command.ts
export interface ParsedCommand {
  type: 'command';
  name: string;
  args: string[];
}

export interface ParsedPrompt {
  type: 'prompt';
  text: string;
}

export type ParseResult = ParsedCommand | ParsedPrompt;

export function parse(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { type: 'prompt', text: trimmed };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase() ?? '';
  const args = parts.slice(1);

  return { type: 'command', name, args };
}
```

**Step 4: Run tests**

Run: `npx vitest run src/core/__tests__/command.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/ && git commit -m "feat: command parser"
```

---

## Task 5: Session Manager

**Files:**
- Create: `src/core/session.ts`
- Create: `src/core/__tests__/session.test.ts`

**Step 1: Write session manager test**

```typescript
// src/core/__tests__/session.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../session.js';
import { Database } from '../../db/database.js';

describe('SessionManager', () => {
  let db: Database;
  let sm: SessionManager;

  beforeEach(() => {
    db = new Database(':memory:');
    sm = new SessionManager(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should add and switch projects', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    expect(sm.getActiveProject()?.name).toBe('myapp');
  });

  it('should return null if no active project', () => {
    expect(sm.getActiveProject()).toBeNull();
  });

  it('should switch between projects', () => {
    sm.addProject('a', '/path/a');
    sm.addProject('b', '/path/b');
    sm.switchProject('a');
    expect(sm.getActiveProject()?.name).toBe('a');
    sm.switchProject('b');
    expect(sm.getActiveProject()?.name).toBe('b');
  });

  it('should throw when switching to non-existent project', () => {
    expect(() => sm.switchProject('nope')).toThrow();
  });

  it('should reject paths with ..', () => {
    expect(() => sm.addProject('bad', '/home/../etc/passwd')).toThrow();
  });

  it('should save and restore session', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    sm.saveCurrentSession('sess-abc', 'did things');
    const session = sm.getCurrentSessionId();
    expect(session).toBe('sess-abc');
  });

  it('should reset session', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    sm.saveCurrentSession('sess-abc', 'did things');
    sm.resetCurrentSession();
    expect(sm.getCurrentSessionId()).toBeNull();
  });

  it('should list session history', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    sm.saveCurrentSession('sess-1', 'first');
    sm.saveCurrentSession('sess-2', 'second');
    const history = sm.getSessionHistory();
    expect(history).toHaveLength(2);
  });

  it('should resume session by db id', () => {
    sm.addProject('myapp', '/home/user/myapp');
    sm.switchProject('myapp');
    sm.saveCurrentSession('sess-1', 'first');
    sm.saveCurrentSession('sess-2', 'second');
    const history = sm.getSessionHistory();
    const oldId = history.find(s => s.session_id === 'sess-1')!.id;
    sm.resumeSession(oldId);
    expect(sm.getCurrentSessionId()).toBe('sess-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/__tests__/session.test.ts`
Expected: FAIL

**Step 3: Implement session.ts**

```typescript
// src/core/session.ts
import { Database, type Project, type Session } from '../db/database.js';

export class SessionManager {
  private db: Database;
  private activeProjectName: string | null = null;

  constructor(db: Database) {
    this.db = db;
  }

  // --- Projects ---

  addProject(name: string, path: string, options?: { description?: string; permission_mode?: string; allowed_tools?: string; max_turns?: number }) {
    if (path.includes('..')) {
      throw new Error('Path must not contain ".."');
    }
    this.db.addProject(name, path, options);
  }

  removeProject(name: string) {
    this.db.removeProject(name);
    if (this.activeProjectName === name) {
      this.activeProjectName = null;
    }
  }

  listProjects(): Project[] {
    return this.db.listProjects();
  }

  switchProject(name: string) {
    const project = this.db.getProject(name);
    if (!project) throw new Error(`Project "${name}" not found`);
    this.activeProjectName = name;
  }

  getActiveProject(): Project | null {
    if (!this.activeProjectName) return null;
    return this.db.getProject(this.activeProjectName) ?? null;
  }

  updateProjectConfig(key: string, value: string) {
    if (!this.activeProjectName) throw new Error('No active project');
    this.db.updateProjectConfig(this.activeProjectName, key, value);
  }

  // --- Sessions ---

  getCurrentSessionId(): string | null {
    if (!this.activeProjectName) return null;
    const session = this.db.getActiveSession(this.activeProjectName);
    return session?.session_id ?? null;
  }

  saveCurrentSession(sessionId: string, summary: string | null) {
    if (!this.activeProjectName) throw new Error('No active project');
    this.db.saveSession(this.activeProjectName, sessionId, summary);
  }

  resetCurrentSession() {
    if (!this.activeProjectName) throw new Error('No active project');
    this.db.resetSession(this.activeProjectName);
  }

  getSessionHistory(): Session[] {
    if (!this.activeProjectName) return [];
    return this.db.listSessions(this.activeProjectName);
  }

  resumeSession(dbId: number) {
    const session = this.db.getSessionById(dbId);
    if (!session) throw new Error(`Session #${dbId} not found`);
    if (session.project_name !== this.activeProjectName) {
      throw new Error(`Session #${dbId} belongs to project "${session.project_name}", not "${this.activeProjectName}"`);
    }
    this.db.setActiveSession(this.activeProjectName!, dbId);
  }

  // --- Usage ---

  recordUsage(sessionId: string | null, costUsd: number, durationMs: number, numTurns: number) {
    if (!this.activeProjectName) throw new Error('No active project');
    this.db.recordUsage(this.activeProjectName, sessionId, costUsd, durationMs, numTurns);
  }

  getUsageStats() {
    return this.db.getUsageStats();
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/core/__tests__/session.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/core/session.ts src/core/__tests__/session.test.ts && git commit -m "feat: session manager with project and session CRUD"
```

---

## Task 6: Feishu Card Templates

**Files:**
- Create: `src/feishu/card.ts`
- Create: `src/feishu/__tests__/card.test.ts`

**Step 1: Write card template test**

```typescript
// src/feishu/__tests__/card.test.ts
import { describe, it, expect } from 'vitest';
import { buildRunningCard, buildDoneCard, buildErrorCard } from '../card.js';

describe('card templates', () => {
  it('should build running card', () => {
    const card = buildRunningCard('frontend', ['Read src/App.tsx', 'Edit src/App.tsx'], 'Analyzing...', 15);
    expect(card.header.template).toBe('blue');
    expect(card.header.title.content).toContain('frontend');
    const md = card.elements.find((e: any) => e.tag === 'markdown');
    expect(md.content).toContain('Read src/App.tsx');
    expect(md.content).toContain('Analyzing...');
  });

  it('should build done card', () => {
    const card = buildDoneCard('frontend', 'Here is the result', { tools: 'Read×2, Edit×1', elapsed: 23, cost: 0.04, turns: 5 });
    expect(card.header.template).toBe('green');
    const md = card.elements.find((e: any) => e.tag === 'markdown');
    expect(md.content).toContain('Here is the result');
  });

  it('should truncate long output in done card', () => {
    const longText = 'x'.repeat(5000);
    const card = buildDoneCard('frontend', longText, { tools: '', elapsed: 1, cost: 0, turns: 1 });
    const md = card.elements.find((e: any) => e.tag === 'markdown');
    expect(md.content.length).toBeLessThan(4200);
    expect(md.content).toContain('输出已截断');
  });

  it('should build error card', () => {
    const card = buildErrorCard('frontend', 'Something went wrong', 3);
    expect(card.header.template).toBe('red');
    const md = card.elements.find((e: any) => e.tag === 'markdown');
    expect(md.content).toContain('Something went wrong');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/feishu/__tests__/card.test.ts`
Expected: FAIL

**Step 3: Implement card.ts**

```typescript
// src/feishu/card.ts

const MAX_CONTENT_LENGTH = 4000;

interface CardElement {
  tag: string;
  [key: string]: unknown;
}

interface Card {
  config: { wide_screen_mode: boolean };
  header: {
    title: { tag: string; content: string };
    template: string;
  };
  elements: CardElement[];
}

export function buildRunningCard(projectName: string, toolCalls: string[], latestText: string, elapsedSec: number): Card {
  const toolLines = toolCalls.map(t => `🔧 ${t}`).join('\n');
  const body = toolLines ? `${toolLines}\n\n${latestText}` : latestText || '处理中...';

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `🔄 执行中 | 项目: ${projectName}` },
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content: truncate(body) },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `⏱️ ${elapsedSec}s | 🔧 ${toolCalls.length} tools` }] },
    ],
  };
}

export function buildDoneCard(projectName: string, resultText: string, stats: { tools: string; elapsed: number; cost: number; turns: number }): Card {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `✅ 完成 | 项目: ${projectName}` },
      template: 'green',
    },
    elements: [
      { tag: 'markdown', content: truncate(resultText) },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `🔧 ${stats.tools} | ⏱️ ${stats.elapsed}s | 💰 $${stats.cost.toFixed(4)} | 🔄 ${stats.turns} turns` }] },
    ],
  };
}

export function buildErrorCard(projectName: string, errorMessage: string, elapsedSec: number): Card {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `❌ 错误 | 项目: ${projectName}` },
      template: 'red',
    },
    elements: [
      { tag: 'markdown', content: truncate(errorMessage) },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `⏱️ ${elapsedSec}s` }] },
    ],
  };
}

export function buildAbortedCard(projectName: string, lastText: string, elapsedSec: number): Card {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `⏹️ 已中止 | 项目: ${projectName}` },
      template: 'orange',
    },
    elements: [
      { tag: 'markdown', content: truncate(lastText || '任务已中止') },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `⏱️ ${elapsedSec}s` }] },
    ],
  };
}

function truncate(text: string): string {
  if (text.length <= MAX_CONTENT_LENGTH) return text;
  return text.slice(0, MAX_CONTENT_LENGTH) + '\n\n---\n⚠️ 输出已截断';
}
```

**Step 4: Run tests**

Run: `npx vitest run src/feishu/__tests__/card.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/feishu/ && git commit -m "feat: Feishu card templates (running/done/error/aborted)"
```

---

## Task 7: Feishu Bot (WSClient + Message Send/Update)

**Files:**
- Create: `src/feishu/bot.ts`

> Note: No unit tests for this module — it's a thin wrapper around the Feishu SDK. Will be validated via integration test in Task 11.

**Step 1: Implement bot.ts**

```typescript
// src/feishu/bot.ts
import * as lark from '@larksuiteoapi/node-sdk';
import { logger } from '../utils/logger.js';

export type MessageHandler = (event: {
  messageId: string;
  chatId: string;
  senderId: string;
  msgType: string;
  content: string;       // raw JSON string
  imageKey?: string;      // for image messages
}) => Promise<void>;

export class FeishuBot {
  private client: lark.Client;
  private wsClient?: lark.WSClient;
  private onMessage?: MessageHandler;

  constructor(appId: string, appSecret: string) {
    this.client = new lark.Client({ appId, appSecret });
  }

  setMessageHandler(handler: MessageHandler) {
    this.onMessage = handler;
  }

  async start() {
    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        try {
          const msg = data.message;
          const sender = data.sender;

          const event = {
            messageId: msg.message_id,
            chatId: msg.chat_id,
            senderId: sender.sender_id?.open_id ?? 'unknown',
            msgType: msg.message_type,
            content: msg.content,
            imageKey: undefined as string | undefined,
          };

          // Extract image_key for image messages
          if (msg.message_type === 'image') {
            try {
              const parsed = JSON.parse(msg.content);
              event.imageKey = parsed.image_key;
            } catch {}
          }

          if (this.onMessage) {
            await this.onMessage(event);
          }
        } catch (err) {
          logger.error('Error handling Feishu message:', err);
        }
      },
    });

    this.wsClient = new lark.WSClient({
      appId: this.client.appId!,
      appSecret: this.client.appSecret!,
      eventDispatcher: dispatcher,
      loggerLevel: lark.LoggerLevel.WARN,
    } as any);

    await this.wsClient.start();
    logger.info('Feishu WSClient connected');
  }

  async sendText(chatId: string, text: string): Promise<string> {
    const resp = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
    return resp.data?.message_id ?? '';
  }

  async sendCard(chatId: string, card: object): Promise<string> {
    const resp = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
    return resp.data?.message_id ?? '';
  }

  async updateCard(messageId: string, card: object): Promise<void> {
    await this.client.im.message.patch({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(card),
      },
    });
  }

  async downloadImage(messageId: string, imageKey: string): Promise<Buffer> {
    const resp = await this.client.im.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type: 'image' },
    });
    // The SDK returns a readable stream or buffer
    if (Buffer.isBuffer(resp)) return resp;
    // If stream, collect into buffer
    const chunks: Buffer[] = [];
    for await (const chunk of resp as any) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (or only minor type issues to fix)

**Step 3: Commit**

```bash
git add src/feishu/bot.ts && git commit -m "feat: Feishu bot with WSClient, message send/update, image download"
```

---

## Task 8: Image Handler

**Files:**
- Create: `src/feishu/image.ts`

**Step 1: Implement image.ts**

```typescript
// src/feishu/image.ts
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

const IMAGE_DIR = '/tmp/feishu-images';

export function saveImage(imageBuffer: Buffer, extension: string = 'png'): string {
  mkdirSync(IMAGE_DIR, { recursive: true });
  const filename = `${randomUUID()}.${extension}`;
  const filepath = join(IMAGE_DIR, filename);
  writeFileSync(filepath, imageBuffer);
  return filepath;
}
```

**Step 2: Commit**

```bash
git add src/feishu/image.ts && git commit -m "feat: image download helper"
```

---

## Task 9: Claude Code Bridge

**Files:**
- Create: `src/claude/bridge.ts`

> Note: No unit tests — this wraps the Agent SDK. Will be validated via integration test in Task 11.

**Step 1: Implement bridge.ts**

```typescript
// src/claude/bridge.ts
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
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
      const queryOptions: Partial<Options> = {
        cwd: options.cwd,
        allowedTools: options.allowedTools as any,
        permissionMode: (options.permissionMode ?? 'bypassPermissions') as any,
        allowDangerouslySkipPermissions: options.permissionMode === 'bypassPermissions' || !options.permissionMode,
        maxTurns: options.maxTurns,
        abortController,
      };

      if (options.resume) {
        (queryOptions as any).resume = options.resume;
      }

      for await (const message of query({ prompt, options: queryOptions as Options })) {
        if (abortController.signal.aborted) break;

        if (message.type === 'assistant' && message.message?.content) {
          for (const block of message.message.content) {
            if ('text' in block && typeof block.text === 'string') {
              onStream({ type: 'text', content: block.text });
            } else if ('name' in block && typeof block.name === 'string') {
              onStream({ type: 'tool_use', content: block.name, toolName: block.name });
            }
          }
        } else if (message.type === 'result') {
          onStream({
            type: 'result',
            content: '',
            sessionId: (message as any).session_id,
            costUsd: (message as any).cost_usd,
            durationMs: (message as any).duration_ms,
            numTurns: (message as any).num_turns,
          });
        }
      }
    } finally {
      this.busyAbortController = null;
    }
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (types may need adjustment after installing actual SDK)

**Step 3: Commit**

```bash
git add src/claude/ && git commit -m "feat: Claude Code bridge with busy lock, abort, streaming"
```

---

## Task 10: Message Router (Wires Everything Together)

**Files:**
- Create: `src/core/router.ts`

**Step 1: Implement router.ts**

```typescript
// src/core/router.ts
import { parse } from './command.js';
import { SessionManager } from './session.js';
import { ClaudeCodeBridge, type StreamEvent } from '../claude/bridge.js';
import { FeishuBot } from '../feishu/bot.js';
import { buildRunningCard, buildDoneCard, buildErrorCard, buildAbortedCard } from '../feishu/card.js';
import { saveImage } from '../feishu/image.js';
import { logger } from '../utils/logger.js';
import { existsSync } from 'fs';

export class MessageRouter {
  private session: SessionManager;
  private bridge: ClaudeCodeBridge;
  private bot: FeishuBot;

  constructor(session: SessionManager, bridge: ClaudeCodeBridge, bot: FeishuBot) {
    this.session = session;
    this.bridge = bridge;
    this.bot = bot;
  }

  async handle(event: { messageId: string; chatId: string; senderId: string; msgType: string; content: string; imageKey?: string }) {
    let userText = '';

    // Extract text from message content
    if (event.msgType === 'text') {
      try {
        const parsed = JSON.parse(event.content);
        userText = parsed.text ?? '';
      } catch {
        userText = event.content;
      }
      // Strip @bot mentions
      userText = userText.replace(/@_user_\d+/g, '').trim();
    } else if (event.msgType === 'image') {
      // Handle image: download and create prompt
      try {
        const imageBuffer = await this.bot.downloadImage(event.messageId, event.imageKey!);
        const imagePath = saveImage(imageBuffer);
        userText = `用户发送了一张图片，请查看并分析: ${imagePath}`;
      } catch (err) {
        await this.bot.sendText(event.chatId, `❌ 图片下载失败: ${err}`);
        return;
      }
    } else {
      await this.bot.sendText(event.chatId, '暂不支持此消息类型，请发送文本或图片');
      return;
    }

    const result = parse(userText);

    if (result.type === 'command') {
      await this.handleCommand(event.chatId, result.name, result.args);
    } else {
      await this.handlePrompt(event.chatId, result.text);
    }
  }

  private async handleCommand(chatId: string, name: string, args: string[]) {
    try {
      switch (name) {
        case 'add': {
          if (args.length < 2) { await this.bot.sendText(chatId, '用法: /add <name> <path>'); return; }
          const [pName, pPath] = args;
          if (!existsSync(pPath)) { await this.bot.sendText(chatId, `❌ 路径不存在: ${pPath}`); return; }
          this.session.addProject(pName, pPath);
          this.session.switchProject(pName);
          await this.bot.sendText(chatId, `✅ 已添加并切换到项目 ${pName} → ${pPath}`);
          break;
        }
        case 'remove': {
          if (args.length < 1) { await this.bot.sendText(chatId, '用法: /remove <name>'); return; }
          this.session.removeProject(args[0]);
          await this.bot.sendText(chatId, `✅ 已删除项目 ${args[0]}`);
          break;
        }
        case 'use': {
          if (args.length < 1) { await this.bot.sendText(chatId, '用法: /use <name>'); return; }
          this.session.switchProject(args[0]);
          const sessionId = this.session.getCurrentSessionId();
          const hint = sessionId ? '（已恢复上次会话）' : '（新会话）';
          await this.bot.sendText(chatId, `🔀 已切换到项目 ${args[0]} ${hint}`);
          break;
        }
        case 'list': {
          const projects = this.session.listProjects();
          if (projects.length === 0) { await this.bot.sendText(chatId, '暂无项目，使用 /add 添加'); return; }
          const active = this.session.getActiveProject();
          const lines = projects.map(p => `${p.name === active?.name ? '👉 ' : '   '}${p.name} → ${p.path}`);
          await this.bot.sendText(chatId, `📋 项目列表:\n${lines.join('\n')}`);
          break;
        }
        case 'status': {
          const project = this.session.getActiveProject();
          if (!project) { await this.bot.sendText(chatId, '未选择项目，使用 /use 切换'); return; }
          const sid = this.session.getCurrentSessionId();
          const busy = this.bridge.isBusy ? '🔄 执行中' : '💤 空闲';
          await this.bot.sendText(chatId, `📊 状态\n项目: ${project.name}\n路径: ${project.path}\n权限: ${project.permission_mode}\n会话: ${sid ?? '无'}\n状态: ${busy}`);
          break;
        }
        case 'reset': {
          this.session.resetCurrentSession();
          await this.bot.sendText(chatId, '🔄 已重置会话，下次提问将开始新会话');
          break;
        }
        case 'stop': {
          if (!this.bridge.isBusy) { await this.bot.sendText(chatId, '当前没有正在执行的任务'); return; }
          this.bridge.abort();
          await this.bot.sendText(chatId, '⏹️ 已发送中止信号');
          break;
        }
        case 'history': {
          const project = this.session.getActiveProject();
          if (!project) { await this.bot.sendText(chatId, '未选择项目，使用 /use 切换'); return; }
          const sessions = this.session.getSessionHistory();
          if (sessions.length === 0) { await this.bot.sendText(chatId, '暂无历史会话'); return; }
          const lines = sessions.map(s => {
            const active = s.is_active ? ' 👈 当前' : '';
            const time = s.last_used_at ?? s.created_at;
            return `#${s.id} (${time}) ${s.summary ?? '无摘要'}${active}`;
          });
          await this.bot.sendText(chatId, `📋 ${project.name} 的历史会话:\n${lines.join('\n')}`);
          break;
        }
        case 'resume': {
          if (args.length < 1) { await this.bot.sendText(chatId, '用法: /resume <id>'); return; }
          const id = parseInt(args[0], 10);
          if (isNaN(id)) { await this.bot.sendText(chatId, '❌ 请输入有效的会话 ID 数字'); return; }
          this.session.resumeSession(id);
          await this.bot.sendText(chatId, `🔄 已恢复会话 #${id}`);
          break;
        }
        case 'config': {
          if (args.length < 2) { await this.bot.sendText(chatId, '用法: /config <key> <value>\n可配置: permission_mode, allowed_tools, max_turns, description'); return; }
          this.session.updateProjectConfig(args[0], args.slice(1).join(' '));
          await this.bot.sendText(chatId, `✅ 已更新 ${args[0]} = ${args.slice(1).join(' ')}`);
          break;
        }
        case 'cost': {
          const stats = this.session.getUsageStats();
          const byProj = Object.entries(stats.byProject).map(([name, s]) => `  ${name}  $${s.cost.toFixed(4)} (${s.calls} 次)`).join('\n');
          await this.bot.sendText(chatId,
            `📊 费用统计\n` +
            `今日: $${stats.today.cost.toFixed(4)} (${stats.today.calls} 次, ${stats.today.turns} turns)\n` +
            `本周: $${stats.week.cost.toFixed(4)} (${stats.week.calls} 次)\n` +
            `本月: $${stats.month.cost.toFixed(4)} (${stats.month.calls} 次)\n` +
            `总计: $${stats.total.cost.toFixed(4)} (${stats.total.calls} 次)\n\n` +
            `按项目:\n${byProj || '  暂无数据'}`
          );
          break;
        }
        case 'help': {
          await this.bot.sendText(chatId,
            `🤖 Feishu Claude Code Bridge\n\n` +
            `/add <name> <path>  添加项目\n` +
            `/remove <name>      删除项目\n` +
            `/use <name>         切换项目\n` +
            `/list               列出项目\n` +
            `/status             当前状态\n` +
            `/reset              重置会话\n` +
            `/stop               中止任务\n` +
            `/history            历史会话\n` +
            `/resume <id>        恢复会话\n` +
            `/config <k> <v>     修改配置\n` +
            `/cost               费用统计\n` +
            `/help               帮助`
          );
          break;
        }
        default:
          await this.bot.sendText(chatId, `未知命令: /${name}，输入 /help 查看帮助`);
      }
    } catch (err: any) {
      await this.bot.sendText(chatId, `❌ 命令执行失败: ${err.message}`);
    }
  }

  private async handlePrompt(chatId: string, text: string) {
    const project = this.session.getActiveProject();
    if (!project) {
      await this.bot.sendText(chatId, '请先选择项目: /use <name>\n查看项目列表: /list');
      return;
    }

    if (this.bridge.isBusy) {
      await this.bot.sendText(chatId, '⏳ 当前有任务在执行，请等待完成或使用 /stop 中止');
      return;
    }

    const startTime = Date.now();
    const toolCalls: string[] = [];
    let latestText = '';
    let cardMessageId = '';
    let lastUpdateTime = 0;

    try {
      // Send initial running card
      const initialCard = buildRunningCard(project.name, [], '处理中...', 0);
      cardMessageId = await this.bot.sendCard(chatId, initialCard);

      const resumeSessionId = this.session.getCurrentSessionId() ?? undefined;

      await this.bridge.execute(
        text,
        {
          cwd: project.path,
          resume: resumeSessionId,
          allowedTools: project.allowed_tools.split(','),
          permissionMode: project.permission_mode,
          maxTurns: project.max_turns,
        },
        async (event: StreamEvent) => {
          if (event.type === 'tool_use' && event.toolName) {
            toolCalls.push(event.toolName);
          } else if (event.type === 'text') {
            latestText = event.content;
          } else if (event.type === 'result') {
            // Save session and usage
            if (event.sessionId) {
              // Extract summary from last text (first 50 chars)
              const summary = latestText.slice(0, 50) || null;
              this.session.saveCurrentSession(event.sessionId, summary);
            }
            this.session.recordUsage(
              event.sessionId ?? null,
              event.costUsd ?? 0,
              event.durationMs ?? (Date.now() - startTime),
              event.numTurns ?? 0,
            );

            // Final done card
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const toolSummary = summarizeTools(toolCalls);
            const doneCard = buildDoneCard(project.name, latestText, {
              tools: toolSummary,
              elapsed,
              cost: event.costUsd ?? 0,
              turns: event.numTurns ?? 0,
            });
            await this.bot.updateCard(cardMessageId, doneCard);
            return;
          }

          // Throttled card update (800ms)
          const now = Date.now();
          if (now - lastUpdateTime > 800 && cardMessageId) {
            lastUpdateTime = now;
            const elapsed = Math.round((now - startTime) / 1000);
            const card = buildRunningCard(project.name, toolCalls, latestText, elapsed);
            try {
              await this.bot.updateCard(cardMessageId, card);
            } catch {
              // Ignore throttle errors
            }
          }
        },
      );
    } catch (err: any) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        // Aborted by user
        if (cardMessageId) {
          const card = buildAbortedCard(project.name, latestText, elapsed);
          await this.bot.updateCard(cardMessageId, card).catch(() => {});
        }
      } else {
        // Real error
        logger.error('Claude Code execution error:', err);
        if (cardMessageId) {
          const card = buildErrorCard(project.name, err.message ?? String(err), elapsed);
          await this.bot.updateCard(cardMessageId, card).catch(() => {});
        } else {
          await this.bot.sendText(chatId, `❌ 执行失败: ${err.message}`);
        }
      }
    }
  }
}

function summarizeTools(toolCalls: string[]): string {
  if (toolCalls.length === 0) return '无';
  const counts: Record<string, number> = {};
  for (const t of toolCalls) {
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return Object.entries(counts).map(([name, count]) => count > 1 ? `${name}×${count}` : name).join(', ');
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/core/router.ts && git commit -m "feat: message router - wires commands, prompts, streaming cards"
```

---

## Task 11: Entry Point

**Files:**
- Modify: `src/index.ts`

**Step 1: Implement entry point**

```typescript
// src/index.ts
import { loadConfig } from './utils/config.js';
import { setLogLevel, logger } from './utils/logger.js';
import { Database } from './db/database.js';
import { SessionManager } from './core/session.js';
import { ClaudeCodeBridge } from './claude/bridge.js';
import { FeishuBot } from './feishu/bot.js';
import { MessageRouter } from './core/router.js';

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

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**Step 2: Commit**

```bash
git add src/index.ts && git commit -m "feat: entry point - wires all components together"
```

---

## Task 12: PM2 Config & Startup Script

**Files:**
- Create: `ecosystem.config.cjs`

**Step 1: Create PM2 config**

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'feishu-claude-bridge',
    script: 'npx',
    args: 'tsx src/index.ts',
    cwd: __dirname,
    env_file: '.env',
    watch: false,
    max_memory_restart: '500M',
    restart_delay: 5000,
    max_restarts: 10,
  }],
};
```

**Step 2: Commit**

```bash
git add ecosystem.config.cjs && git commit -m "chore: PM2 config"
```

---

## Task 13: Integration Smoke Test

**Goal:** Manually verify the full flow works end-to-end.

**Step 1: Create .env from .env.example and fill in real credentials**

**Step 2: Start the bot**

Run: `npx tsx src/index.ts`
Expected: "Bot is running. Waiting for messages..."

**Step 3: Test in Feishu**

1. Send `/help` → should see help text
2. Send `/add test /home/vmadmin/feishu-claude-code` → should confirm
3. Send `看看项目结构` → should see running card, then done card with output
4. Send `/cost` → should show usage stats
5. Send `/history` → should show session
6. Send `/stop` while a task is running → should abort
7. Send `/reset` then ask again → should start fresh session

**Step 4: Fix any issues found during smoke test**

**Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix: smoke test fixes"
```

---

## Task 14: Run All Tests

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

**Step 2: Final commit**

```bash
git add -A && git commit -m "chore: all tests passing, MVP complete"
```
