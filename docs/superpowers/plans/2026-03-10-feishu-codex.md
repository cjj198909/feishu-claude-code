# feishu-codex Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create feishu-codex — a Feishu bot that connects to OpenAI Codex Agent via `@openai/codex-sdk`, adapted from the existing feishu-claude-code project.

**Architecture:** Copy feishu-claude-code to `/home/vmadmin/feishu-codex`, replace the Claude Agent SDK bridge layer with a Codex SDK bridge, remove the interactive question/form system, and adapt all supporting files. The Feishu integration layer (WebSocket, Cardkit streaming cards, message handling) is kept intact.

**Tech Stack:** TypeScript, Node.js 20+, `@openai/codex-sdk` ^0.112.0, `@larksuiteoapi/node-sdk`, `better-sqlite3`, `dotenv`, `vitest`

**Spec:** `docs/superpowers/specs/2026-03-10-feishu-codex-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/codex/bridge.ts` | **Create** | Codex SDK wrapper. Translates `ThreadEvent` → `StreamEvent`. Manages thread lifecycle, abort, image handling, cost estimation. |
| `src/core/router.ts` | **Modify** | Remove question-form logic, remove `allowedTools`/`enableQuestions` from bridge call, rename session→thread references |
| `src/core/session.ts` | **Modify** | Remove `allowed_tools` from `addProject()` options type. Rename `sessionId` → `threadId` in method names and comments. |
| `src/core/command.ts` | **Keep** | Unchanged |
| `src/feishu/bot.ts` | **Modify** | Remove `closeCardStreaming()`, `reopenCardStreaming()`, `appendCardElements()` methods and card action handler registration |
| `src/feishu/card.ts` | **Modify** | Remove `buildQuestionFormElements()`, `buildProcessingStreamingCard()`. Add `~` prefix to estimated cost display. |
| `src/db/database.ts` | **Modify** | Remove `allowed_tools` column from schema + all references |
| `src/utils/config.ts` | **Modify** | Replace `ANTHROPIC_*` env vars with `OPENAI_*`, remove `defaultAllowedTools`, add `openaiModel` |
| `src/utils/logger.ts` | **Keep** | Unchanged |
| `src/index.ts` | **Modify** | Replace `ClaudeCodeBridge` with `CodexBridge`, remove `CLAUDECODE` env deletion |
| `src/core/question-manager.ts` | **Delete** | Not needed — Codex SDK has no tool interception hooks |
| `package.json` | **Modify** | Rename, swap SDK dependency |
| `.env.example` | **Create** | New env template for Codex |
| `tsconfig.json` | **Keep** | Unchanged |
| `ecosystem.config.cjs` | **Modify** | Update name |
| Tests in `__tests__/` | **Modify** | Adapt to removed features |

---

## Chunk 1: Project Scaffolding & Foundation

### Task 1: Copy project and initialize

**Files:**
- Create: `/home/vmadmin/feishu-codex/` (full copy)
- Modify: `/home/vmadmin/feishu-codex/package.json`
- Create: `/home/vmadmin/feishu-codex/.env.example`

- [ ] **Step 1: Copy the project**

```bash
cp -r /home/vmadmin/feishu-claude-code /home/vmadmin/feishu-codex
cd /home/vmadmin/feishu-codex
rm -rf node_modules dist data .git
git init
```

- [ ] **Step 2: Update package.json**

Replace the full content of `package.json`:

```json
{
  "name": "feishu-codex",
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
  },
  "dependencies": {
    "@openai/codex-sdk": "^0.112.0",
    "@larksuiteoapi/node-sdk": "^1.59.0",
    "better-sqlite3": "^12.6.2",
    "dotenv": "^17.3.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^25.3.5",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 3: Create .env.example**

```bash
# Feishu (required)
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxx

# OpenAI / Codex (required)
OPENAI_API_KEY=sk-xxxxxxxx

# Optional
OPENAI_BASE_URL=
OPENAI_MODEL=codex-mini

# Project defaults
DEFAULT_PERMISSION_MODE=bypassPermissions
DEFAULT_MAX_TURNS=100

# System
LOG_LEVEL=info
DB_PATH=./data/bridge.db
```

- [ ] **Step 4: Install dependencies**

```bash
cd /home/vmadmin/feishu-codex && npm install
```

Expected: Successful install with `@openai/codex-sdk` in node_modules.

- [ ] **Step 5: Delete question-manager.ts and rename claude/ → codex/**

```bash
cd /home/vmadmin/feishu-codex
rm src/core/question-manager.ts
rm -rf src/claude
mkdir -p src/codex
```

- [ ] **Step 6: Initial commit**

```bash
cd /home/vmadmin/feishu-codex
git add -A
git commit -m "chore: scaffold feishu-codex from feishu-claude-code"
```

---

### Task 2: Update config.ts

**Files:**
- Modify: `src/utils/config.ts`

- [ ] **Step 1: Write the failing test**

Update `src/utils/__tests__/config.test.ts` — replace the test for `defaultAllowedTools` with a test for `openaiModel`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

// config.ts uses top-level import 'dotenv/config', so set env BEFORE import
beforeEach(() => {
  process.env.FEISHU_APP_ID = 'test_id';
  process.env.FEISHU_APP_SECRET = 'test_secret';
});

describe('loadConfig', () => {
  it('loads required config', async () => {
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();
    expect(config.feishu.appId).toBe('test_id');
    expect(config.feishu.appSecret).toBe('test_secret');
  });

  it('has correct defaults', async () => {
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();
    expect(config.defaultPermissionMode).toBe('bypassPermissions');
    expect(config.defaultMaxTurns).toBe(100);
    expect(config.openaiModel).toBe('codex-mini');
    expect(config.logLevel).toBe('info');
    expect(config.dbPath).toBe('./data/bridge.db');
  });

  it('reads OPENAI_MODEL from env', async () => {
    process.env.OPENAI_MODEL = 'o4-mini';
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();
    expect(config.openaiModel).toBe('o4-mini');
    delete process.env.OPENAI_MODEL;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/vmadmin/feishu-codex && npx vitest run src/utils/__tests__/config.test.ts
```

Expected: FAIL — `openaiModel` property does not exist.

- [ ] **Step 3: Implement config.ts**

Replace `src/utils/config.ts` with:

```typescript
import 'dotenv/config';

export interface AppConfig {
  feishu: {
    appId: string;
    appSecret: string;
  };
  defaultPermissionMode: string;
  defaultMaxTurns: number;
  openaiModel: string;
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
    defaultMaxTurns: parseInt(process.env.DEFAULT_MAX_TURNS ?? '100', 10),
    openaiModel: process.env.OPENAI_MODEL ?? 'codex-mini',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    dbPath: process.env.DB_PATH ?? './data/bridge.db',
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/vmadmin/feishu-codex && npx vitest run src/utils/__tests__/config.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add src/utils/config.ts src/utils/__tests__/config.test.ts
git commit -m "feat: update config for Codex (OPENAI_* env vars)"
```

---

### Task 3: Update database.ts — remove allowed_tools

**Files:**
- Modify: `src/db/database.ts`
- Modify: `src/db/__tests__/database.test.ts`

- [ ] **Step 1: Write the failing test**

Update `src/db/__tests__/database.test.ts`. Replace any references to `allowed_tools` with assertions that it does NOT exist. Key test changes:

In the `addProject` / `getProject` tests, remove `allowed_tools` from assertions. Add a test verifying the `Project` interface no longer has `allowed_tools`:

```typescript
it('should add and retrieve a project without allowed_tools', () => {
  db.addProject('test', '/tmp/test');
  const project = db.getProject('test');
  expect(project).toBeDefined();
  expect(project!.name).toBe('test');
  expect(project!.permission_mode).toBe('bypassPermissions');
  expect(project!.max_turns).toBe(100);
  // allowed_tools should not exist
  expect((project as any).allowed_tools).toBeUndefined();
});
```

In `updateProjectConfig` test, remove the `allowed_tools` test case and verify it's rejected:

```typescript
it('should reject allowed_tools as config key', () => {
  db.addProject('test', '/tmp/test');
  expect(() => db.updateProjectConfig('test', 'allowed_tools', 'Read,Write')).toThrow('Invalid config key');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/vmadmin/feishu-codex && npx vitest run src/db/__tests__/database.test.ts
```

Expected: FAIL — `allowed_tools` still exists in schema and Project type.

- [ ] **Step 3: Update database.ts**

Changes to `src/db/database.ts`:

1. Remove `allowed_tools` from `Project` interface
2. Remove `allowed_tools` from `CREATE TABLE projects` SQL
3. Remove `allowed_tools` from `addProject()` INSERT and parameters
4. Remove `'allowed_tools'` from `updateProjectConfig()` allowed keys list

Updated `Project` interface:

```typescript
export interface Project {
  id: number;
  name: string;
  path: string;
  description: string | null;
  permission_mode: string;
  max_turns: number;
  created_at: string;
}
```

Updated `migrate()`:

```typescript
private migrate() {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      path TEXT NOT NULL,
      description TEXT,
      permission_mode TEXT DEFAULT 'bypassPermissions',
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
```

Updated `addProject()`:

```typescript
addProject(name: string, path: string, options?: { description?: string; permission_mode?: string; max_turns?: number }) {
  this.db.prepare(
    'INSERT INTO projects (name, path, description, permission_mode, max_turns) VALUES (?, ?, ?, ?, ?)'
  ).run(
    name, path,
    options?.description ?? null,
    options?.permission_mode ?? 'bypassPermissions',
    options?.max_turns ?? 100
  );
}
```

Updated `updateProjectConfig()`:

```typescript
updateProjectConfig(name: string, key: string, value: string) {
  const allowed = ['permission_mode', 'max_turns', 'description'];
  if (!allowed.includes(key)) throw new Error(`Invalid config key: ${key}`);
  this.db.prepare(`UPDATE projects SET ${key} = ? WHERE name = ?`).run(value, name);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/vmadmin/feishu-codex && npx vitest run src/db/__tests__/database.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add src/db/database.ts src/db/__tests__/database.test.ts
git commit -m "feat: remove allowed_tools from database schema"
```

---

## Chunk 2: Core Bridge Rewrite

### Task 4: Create CodexBridge (the core rewrite)

**Files:**
- Create: `src/codex/bridge.ts`

This is the heart of the migration. The bridge wraps `@openai/codex-sdk` and translates its `ThreadEvent` stream into the `StreamEvent` interface that the rest of the app consumes.

- [ ] **Step 1: Create src/codex/bridge.ts**

```typescript
// src/codex/bridge.ts
import { Codex, type ThreadOptions, type ThreadEvent, type ThreadItem } from '@openai/codex-sdk';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { logger } from '../utils/logger.js';

export interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'result';
  content: string;
  toolName?: string;
  toolLabel?: string;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
}

export interface BridgeOptions {
  cwd: string;
  resume?: string;        // Codex thread ID
  permissionMode?: string;
  maxTurns?: number;
  attachments?: Buffer[];  // image buffers from Feishu
}

// Per-token pricing estimates (USD) — update as pricing changes
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'codex-mini':  { input: 0.0015 / 1000, output: 0.006 / 1000 },
  'o4-mini':     { input: 0.0011 / 1000, output: 0.0044 / 1000 },
};
const DEFAULT_PRICING = { input: 0.002 / 1000, output: 0.008 / 1000 };

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return inputTokens * pricing.input + outputTokens * pricing.output;
}

/** Map our permission_mode string to Codex SDK options */
function mapPermissionMode(mode?: string): Pick<ThreadOptions, 'approvalPolicy' | 'sandboxMode'> {
  switch (mode) {
    case 'acceptEdits':
      return { approvalPolicy: 'on-failure', sandboxMode: 'workspace-write' };
    case 'default':
      return { approvalPolicy: 'on-request', sandboxMode: 'read-only' };
    case 'bypassPermissions':
    default:
      return { approvalPolicy: 'never', sandboxMode: 'danger-full-access' };
  }
}

/** Format a short tool label from a Codex item */
function formatItemLabel(item: ThreadItem): string {
  const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n) + '\u2026' : s;

  switch (item.type) {
    case 'command_execution':
      return `Bash(${truncate(item.command ?? '', 30)})`;
    case 'file_change': {
      const changes = (item as any).changes as Array<{ path: string; type: string }> | undefined;
      if (changes && changes.length > 0) {
        const first = changes[0].path.split('/').pop() ?? changes[0].path;
        return changes.length === 1 ? `FileChange(${first})` : `FileChange(${first} +${changes.length - 1})`;
      }
      return 'FileChange';
    }
    case 'mcp_tool_call':
      return `${(item as any).tool ?? 'MCP'}(${truncate(String((item as any).arguments ?? ''), 25)})`;
    default:
      return item.type;
  }
}

/** Map Codex item type to a tool name for display */
function itemToolName(item: ThreadItem): string {
  switch (item.type) {
    case 'command_execution': return 'Bash';
    case 'file_change': return 'FileChange';
    case 'mcp_tool_call': return (item as any).tool ?? 'MCP';
    case 'web_search': return 'WebSearch';
    default: return item.type;
  }
}

export class CodexBridge {
  private codex: Codex;
  private model: string;
  private busyAbortController: AbortController | null = null;

  constructor() {
    this.model = process.env.OPENAI_MODEL ?? 'codex-mini';
    this.codex = new Codex({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || undefined,
    });
  }

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

    // Write image attachments to temp files for Codex local_image input
    const tmpFiles: string[] = [];

    try {
      const permOpts = mapPermissionMode(options.permissionMode);

      const threadOptions: ThreadOptions = {
        model: this.model,
        workingDirectory: options.cwd,
        ...permOpts,
        // Note: Codex SDK does not expose a maxTurns option in ThreadOptions.
        // maxTurns is tracked locally and enforced by breaking out of the event loop.
      };

      // Create or resume thread
      const thread = options.resume
        ? this.codex.resumeThread(options.resume, threadOptions)
        : this.codex.startThread(threadOptions);

      // Build input: text or multimodal (text + images)
      let input: any = prompt;
      if (options.attachments && options.attachments.length > 0) {
        const parts: Array<{ type: string; text?: string; path?: string }> = [];

        for (let i = 0; i < options.attachments.length; i++) {
          const tmpPath = join(tmpdir(), `feishu-codex-${Date.now()}-${i}.png`);
          writeFileSync(tmpPath, options.attachments[i]);
          tmpFiles.push(tmpPath);
          parts.push({ type: 'local_image', path: tmpPath });
        }

        parts.push({ type: 'text', text: prompt });
        input = parts;

        logger.info('Using multimodal input', { imageCount: options.attachments.length });
      }

      logger.info('Starting Codex query', {
        cwd: options.cwd,
        model: this.model,
        resume: options.resume,
      });

      const startTime = Date.now();
      let threadId: string | null = null;
      let turnCount = 0;

      const result = await thread.runStreamed(input, {
        signal: abortController.signal,
      });

      for await (const event of result.events) {
        if (abortController.signal.aborted) break;

        switch (event.type) {
          case 'thread.started':
            threadId = event.thread_id;
            break;

          case 'turn.started':
            turnCount++;
            // Enforce maxTurns locally (Codex SDK has no built-in limit)
            if (options.maxTurns && turnCount > options.maxTurns) {
              logger.warn(`maxTurns (${options.maxTurns}) exceeded, aborting`);
              abortController.abort();
            }
            break;

          case 'item.started':
          case 'item.updated': {
            const item = event.item;
            if (item.type === 'agent_message') {
              onStream({ type: 'text', content: (item as any).content ?? '' });
            } else if (item.type === 'reasoning') {
              // Reasoning items are intentionally ignored (spec decision)
              break;
            } else if (
              item.type === 'command_execution' ||
              item.type === 'file_change' ||
              item.type === 'mcp_tool_call' ||
              item.type === 'web_search'
            ) {
              if (event.type === 'item.started') {
                onStream({
                  type: 'tool_use',
                  content: itemToolName(item),
                  toolName: itemToolName(item),
                  toolLabel: formatItemLabel(item),
                });
              }
            }
            break;
          }

          case 'item.completed': {
            const item = event.item;
            if (item.type === 'command_execution') {
              const output = (item as any).output ?? '';
              const exitCode = (item as any).exit_code;
              const summary = exitCode != null && exitCode !== 0
                ? `Exit ${exitCode}: ${output.slice(0, 200)}`
                : output.slice(0, 200);
              onStream({ type: 'tool_result', content: summary });
            } else if (item.type === 'file_change') {
              const changes = (item as any).changes as Array<{ path: string; type: string }> | undefined;
              const summary = changes
                ? changes.map((c: any) => `${c.type}: ${c.path}`).join(', ')
                : 'File changes applied';
              onStream({ type: 'tool_result', content: summary });
            } else if (item.type === 'mcp_tool_call') {
              const result = (item as any).result ?? (item as any).error ?? '';
              onStream({ type: 'tool_result', content: String(result).slice(0, 200) });
            }
            break;
          }

          case 'turn.completed': {
            const durationMs = Date.now() - startTime;
            const usage = (event as any).usage;
            const inputTokens = usage?.input_tokens ?? 0;
            const outputTokens = usage?.output_tokens ?? 0;
            const costUsd = estimateCost(this.model, inputTokens, outputTokens);

            onStream({
              type: 'result',
              content: '',
              sessionId: threadId ?? undefined,
              costUsd,
              durationMs,
              numTurns: turnCount,
            });
            break;
          }

          case 'turn.failed': {
            const error = (event as any).error;
            throw new Error(`Codex turn failed: ${error?.message ?? JSON.stringify(error)}`);
          }

          case 'thread.error': {
            const error = (event as any).error;
            throw new Error(`Codex thread error: ${error?.message ?? JSON.stringify(error)}`);
          }
        }
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      if (abortController.signal.aborted || /abort/i.test(msg)) {
        logger.info('Codex query aborted');
        throw err;
      }
      logger.error('Codex query error:', msg);
      throw err;
    } finally {
      this.busyAbortController = null;

      // Clean up temp image files
      for (const f of tmpFiles) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    }
  }
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd /home/vmadmin/feishu-codex && npx tsc --noEmit src/codex/bridge.ts
```

Note: This may show errors because other files still import from `claude/bridge.ts`. That's expected — we fix them in subsequent tasks. The goal here is to verify bridge.ts itself has no internal type errors (may need `--skipLibCheck` or isolating the check). If tsc errors relate to imports from other files, that's OK.

- [ ] **Step 3: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add src/codex/bridge.ts
git commit -m "feat: create CodexBridge with Codex SDK integration"
```

---

### Task 4b: Add unit tests for CodexBridge pure functions

**Files:**
- Create: `src/codex/__tests__/bridge.test.ts`

The bridge exports a class, but its internal pure functions (`estimateCost`, `mapPermissionMode`, `formatItemLabel`, `itemToolName`) need to be tested. To enable this, export them as named exports from bridge.ts.

- [ ] **Step 1: Export pure functions from bridge.ts**

Add these exports at the bottom of `src/codex/bridge.ts` (before the `CodexBridge` class or after the function definitions):

```typescript
// Exported for testing
export { estimateCost, mapPermissionMode, formatItemLabel, itemToolName };
```

- [ ] **Step 2: Write tests**

Create `src/codex/__tests__/bridge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { estimateCost, mapPermissionMode } from '../bridge.js';

describe('estimateCost', () => {
  it('estimates cost for codex-mini', () => {
    const cost = estimateCost('codex-mini', 1000, 500);
    // input: 1000 * 0.0015/1000 = 0.0015, output: 500 * 0.006/1000 = 0.003
    expect(cost).toBeCloseTo(0.0045, 4);
  });

  it('estimates cost for o4-mini', () => {
    const cost = estimateCost('o4-mini', 1000, 500);
    // input: 1000 * 0.0011/1000 = 0.0011, output: 500 * 0.0044/1000 = 0.0022
    expect(cost).toBeCloseTo(0.0033, 4);
  });

  it('uses default pricing for unknown model', () => {
    const cost = estimateCost('unknown-model', 1000, 500);
    // input: 1000 * 0.002/1000 = 0.002, output: 500 * 0.008/1000 = 0.004
    expect(cost).toBeCloseTo(0.006, 4);
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCost('codex-mini', 0, 0)).toBe(0);
  });
});

describe('mapPermissionMode', () => {
  it('maps bypassPermissions', () => {
    const result = mapPermissionMode('bypassPermissions');
    expect(result.approvalPolicy).toBe('never');
    expect(result.sandboxMode).toBe('danger-full-access');
  });

  it('maps acceptEdits', () => {
    const result = mapPermissionMode('acceptEdits');
    expect(result.approvalPolicy).toBe('on-failure');
    expect(result.sandboxMode).toBe('workspace-write');
  });

  it('maps default', () => {
    const result = mapPermissionMode('default');
    expect(result.approvalPolicy).toBe('on-request');
    expect(result.sandboxMode).toBe('read-only');
  });

  it('defaults to bypassPermissions for undefined', () => {
    const result = mapPermissionMode(undefined);
    expect(result.approvalPolicy).toBe('never');
    expect(result.sandboxMode).toBe('danger-full-access');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /home/vmadmin/feishu-codex && npx vitest run src/codex/__tests__/bridge.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add src/codex/bridge.ts src/codex/__tests__/bridge.test.ts
git commit -m "test: add unit tests for CodexBridge pure functions"
```

---

## Chunk 3: Adapt Supporting Files

### Task 5: Update card.ts — remove question form builders

**Files:**
- Modify: `src/feishu/card.ts`
- Modify: `src/feishu/__tests__/card.test.ts`

- [ ] **Step 1: Update card.ts**

Remove these functions from `src/feishu/card.ts`:
- `buildQuestionFormElements()` (lines 147-200)
- `buildProcessingStreamingCard()` (lines 108-131)

Remove the `AskQuestion`-related imports if any.

In `buildDoneStreamingCard()`, change the cost display to prefix with `~`:

```typescript
// Change this line in buildDoneStreamingCard:
content: `*🔧 ${stats.tools} | ⏱️ ${stats.elapsed}s | 💰 ~$${stats.cost.toFixed(4)} | 🔄 ${stats.turns} turns*`
```

Similarly in `buildDoneCard()`:

```typescript
content: `🔧 ${stats.tools} | ⏱️ ${stats.elapsed}s | 💰 ~$${stats.cost.toFixed(4)} | 🔄 ${stats.turns} turns`
```

- [ ] **Step 2: Update card.test.ts**

Remove any tests for `buildQuestionFormElements` and `buildProcessingStreamingCard`. Update cost-related assertions to expect `~$` prefix.

- [ ] **Step 3: Run card tests**

```bash
cd /home/vmadmin/feishu-codex && npx vitest run src/feishu/__tests__/card.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add src/feishu/card.ts src/feishu/__tests__/card.test.ts
git commit -m "feat: remove question form builders, add estimated cost prefix"
```

---

### Task 6: Update bot.ts — remove question-related methods

**Files:**
- Modify: `src/feishu/bot.ts`

- [ ] **Step 1: Update bot.ts**

Remove these methods from the `FeishuBot` class:
- `closeCardStreaming()` (lines 324-341)
- `appendCardElements()` (lines 347-367)
- `reopenCardStreaming()` (lines 297-318)

Remove the `setCardActionHandler()` method and `onCardAction` property.

In the `start()` method, remove the `cardActionHandler` function (lines 67-85) and the `'card.action.trigger': cardActionHandler` registration (line 133) from the event dispatcher. The resulting dispatcher registration should look like:

```typescript
const dispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data: any) => {
    // ... existing message handling logic unchanged ...
  },
} as any);
```

Remove the `CardActionHandler` type export and the `CardActionEvent` export interface.

Keep these methods untouched:
- `sendText()`, `sendCard()`, `updateCard()`
- `sendStreamingCard()`, `updateCardElement()`, `updateStreamingCard()`
- `downloadImage()`, `hasCardkitState()`, `getCardId()`, `cleanupCardkitState()`

- [ ] **Step 2: Verify compilation**

```bash
cd /home/vmadmin/feishu-codex && npx tsc --noEmit src/feishu/bot.ts
```

May fail due to downstream imports — that's OK at this stage.

- [ ] **Step 3: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add src/feishu/bot.ts
git commit -m "feat: remove question/form methods from FeishuBot"
```

---

### Task 7: Update session.ts — remove allowed_tools + rename sessionId→threadId

**Files:**
- Modify: `src/core/session.ts`
- Modify: `src/core/__tests__/session.test.ts`

- [ ] **Step 1: Update session.ts**

Two changes:

1. In `addProject()` method, remove `allowed_tools` from the options type:

```typescript
addProject(name: string, path: string, options?: { description?: string; permission_mode?: string; max_turns?: number }) {
```

2. Rename session-related methods and comments to reflect thread semantics (the database column `session_id` stays unchanged since it's just a string field, but the public API should use "thread" terminology):

```typescript
// Rename getCurrentSessionId → getCurrentThreadId
getCurrentThreadId(): string | null {
  if (!this.activeProjectName) return null;
  const session = this.db.getActiveSession(this.activeProjectName);
  return session?.session_id ?? null;  // DB field stays session_id
}

// Rename saveCurrentSession → saveCurrentThread
saveCurrentThread(threadId: string, summary: string | null) {
  if (!this.activeProjectName) throw new Error('No active project');
  this.db.saveSession(this.activeProjectName, threadId, summary);
}
```

Keep `resetCurrentSession()`, `getSessionHistory()`, `resumeSession()` names unchanged — they refer to the database session concept (a history entry), not the Claude/Codex thread.

- [ ] **Step 2: Update session.test.ts**

Remove any references to `allowed_tools` in test assertions. Update method name references from `getCurrentSessionId` to `getCurrentThreadId` and `saveCurrentSession` to `saveCurrentThread`.

- [ ] **Step 3: Run tests**

```bash
cd /home/vmadmin/feishu-codex && npx vitest run src/core/__tests__/session.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add src/core/session.ts src/core/__tests__/session.test.ts
git commit -m "refactor: remove allowed_tools, rename sessionId to threadId in SessionManager"
```

---

### Task 8: Update router.ts — the main adaptation

**Files:**
- Modify: `src/core/router.ts`

This is the largest adaptation after the bridge rewrite. Key changes:

1. Replace imports
2. Remove all QuestionManager references
3. Remove `ask_questions` event handling
4. Remove `handleCardAction()` method
5. Remove `allowedTools` and `enableQuestions` from bridge.execute() call
6. Remove `card.action.trigger` references
7. Update `/config` help text (no `allowed_tools`)

- [ ] **Step 1: Update imports**

Replace the top imports block entirely:

```typescript
// src/core/router.ts
import { existsSync } from 'fs';
import { parse } from './command.js';
import { SessionManager } from './session.js';
import { CodexBridge, type StreamEvent } from '../codex/bridge.js';
import { FeishuBot, type MessageHandler } from '../feishu/bot.js';
import { buildStreamingCard, buildDoneStreamingCard, buildErrorStreamingCard, buildAbortedStreamingCard, buildRunningCard, buildDoneCard, buildErrorCard, buildAbortedCard, ELEMENT_IDS } from '../feishu/card.js';
import { logger } from '../utils/logger.js';
```

Removed: `QuestionManager` import, `CardActionEvent` type import, `buildProcessingStreamingCard`, `buildQuestionFormElements`.

- [ ] **Step 2: Update MessageRouter class**

Replace `ClaudeCodeBridge` with `CodexBridge`. Remove `questionMgr` property, `setQuestionManager()` call, and `setCardActionHandler()` registration:

```typescript
export class MessageRouter {
  private sessions: SessionManager;
  private bridge: CodexBridge;
  private bot: FeishuBot;

  constructor(sessions: SessionManager, bridge: CodexBridge, bot: FeishuBot) {
    this.sessions = sessions;
    this.bridge = bridge;
    this.bot = bot;
    // Removed: QuestionManager setup
    // Removed: bot.setCardActionHandler()
  }
  // ... handle(), handleCommand(), all cmd*() methods: unchanged
  // ... handlePostMessage(): unchanged
}
```

- [ ] **Step 3: Update handlePrompt() — session lookup and bridge.execute() call**

Update the session lookup variable name and bridge call:

```typescript
// Replace this line:
const resumeSessionId = this.sessions.getCurrentSessionId();

// With:
const resumeThreadId = this.sessions.getCurrentThreadId();
```

Replace the bridge.execute() call options:

```typescript
// Replace:
await this.bridge.execute(
  text,
  {
    cwd: project.path,
    resume: resumeSessionId ?? undefined,
    allowedTools: project.allowed_tools ? project.allowed_tools.split(',') : undefined,
    permissionMode: project.permission_mode,
    maxTurns: project.max_turns,
    enableQuestions: useCardkit,
    attachments,
  },
  (event: StreamEvent) => { ... }
);

// With:
await this.bridge.execute(
  text,
  {
    cwd: project.path,
    resume: resumeThreadId ?? undefined,
    permissionMode: project.permission_mode,
    maxTurns: project.max_turns,
    attachments,
  },
  (event: StreamEvent) => { ... }
);
```

Also update the `result` event handler inside the onStream callback — replace `this.sessions.saveCurrentSession()` with `this.sessions.saveCurrentThread()`:

```typescript
// In the result event handler, replace:
try { this.sessions.saveCurrentSession(event.sessionId, summary); } catch (e) { ... }

// With:
try { this.sessions.saveCurrentThread(event.sessionId!, summary); } catch (e) { ... }
```

- [ ] **Step 4: Remove ask_questions event handling from onStream callback**

Delete the entire `else if (event.type === 'ask_questions' && useCardkit)` block (approximately lines 436-459 in the original).

- [ ] **Step 5: Remove handleCardAction() method**

Delete the entire `handleCardAction()` method (lines 559-599 in the original).

- [ ] **Step 6: Update /config help text**

In `cmdConfig()`, update the usage message:

```typescript
await this.bot.sendText(chatId, 'Usage: /config <key> <value>\nKeys: permission_mode, max_turns, description');
```

- [ ] **Step 7: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add src/core/router.ts
git commit -m "feat: adapt router for CodexBridge, remove question handling"
```

---

### Task 9: Update index.ts — entry point

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update index.ts**

```typescript
import { loadConfig } from './utils/config.js';
import { setLogLevel, logger } from './utils/logger.js';
import { Database } from './db/database.js';
import { SessionManager } from './core/session.js';
import { CodexBridge } from './codex/bridge.js';
import { FeishuBot } from './feishu/bot.js';
import { MessageRouter } from './core/router.js';

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection (process kept alive):', reason);
});

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel as any);

  logger.info('Starting Feishu Codex Bridge...');

  // Init database
  const db = new Database(config.dbPath);
  logger.info(`Database initialized at ${config.dbPath}`);

  // Init components
  const session = new SessionManager(db);
  const bridge = new CodexBridge();
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
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down...');

    bridge.abort();

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
```

- [ ] **Step 2: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add src/index.ts
git commit -m "feat: update entry point for CodexBridge"
```

---

### Task 10: Update ecosystem.config.cjs

**Files:**
- Modify: `ecosystem.config.cjs`

- [ ] **Step 1: Update the PM2 config**

If it exists, update the `name` field from any claude reference to `feishu-codex`. Read the file first and adjust accordingly.

- [ ] **Step 2: Commit**

```bash
cd /home/vmadmin/feishu-codex
git add ecosystem.config.cjs
git commit -m "chore: update PM2 config name to feishu-codex"
```

---

## Chunk 4: Verification & Final Cleanup

### Task 11: Full compilation check

**Files:** All

- [ ] **Step 1: Run TypeScript compiler**

```bash
cd /home/vmadmin/feishu-codex && npx tsc --noEmit
```

Expected: No errors. If there are errors, fix them — likely stale imports or type mismatches.

- [ ] **Step 2: Fix any compilation errors**

Address each error. Common issues:
- Stale imports referencing deleted files
- `Project.allowed_tools` references in router or session
- `FeishuBot` missing method references
- `CardActionEvent` / `CardActionHandler` type exports

- [ ] **Step 3: Commit fixes**

```bash
cd /home/vmadmin/feishu-codex
git add -A
git commit -m "fix: resolve compilation errors"
```

---

### Task 12: Run all tests

**Files:** All test files

- [ ] **Step 1: Run full test suite**

```bash
cd /home/vmadmin/feishu-codex && npx vitest run
```

Expected: All tests pass. If not, fix failing tests.

- [ ] **Step 2: Fix any failing tests**

Common issues:
- Tests importing from deleted `question-manager.ts`
- Tests referencing `allowed_tools`
- Tests referencing removed card builders

- [ ] **Step 3: Commit fixes**

```bash
cd /home/vmadmin/feishu-codex
git add -A
git commit -m "fix: all tests passing"
```

---

### Task 13: Smoke test — verify app starts

- [ ] **Step 1: Create a minimal .env for startup test**

```bash
cd /home/vmadmin/feishu-codex
cp .env.example .env
# Edit .env with real FEISHU_APP_ID, FEISHU_APP_SECRET, OPENAI_API_KEY
# Or just verify the app initializes and fails gracefully with missing creds
```

- [ ] **Step 2: Try starting the dev server**

```bash
cd /home/vmadmin/feishu-codex && timeout 5 npx tsx src/index.ts 2>&1 || true
```

Expected: Either starts successfully (if .env is valid) or fails with a clear "Missing required env vars" error. Should NOT crash with import errors or undefined references.

- [ ] **Step 3: Final commit**

```bash
cd /home/vmadmin/feishu-codex
git add -A
git commit -m "chore: feishu-codex v0.1.0 ready"
```
