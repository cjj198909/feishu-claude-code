# feishu-codex Design Spec

> Feishu bot bridging to OpenAI Codex Agent, adapted from feishu-claude-code.

## Context

feishu-claude-code is a TypeScript project that connects Feishu IM to Claude Code via the `@anthropic-ai/claude-agent-sdk`. The user wants an equivalent project — `feishu-codex` — that connects Feishu to OpenAI Codex via `@openai/codex-sdk`.

**Approach chosen:** Copy feishu-claude-code and replace the AI engine layer (Claude SDK → Codex SDK) while keeping the Feishu integration, command system, session management, and database layer intact.

**Project path:** `/home/vmadmin/feishu-codex`

## Architecture

"Swap the engine, keep the chassis." The Feishu layer is untouched; only the AI bridge layer is rewritten.

```
┌──────────────────────────────────────────────────┐
│               feishu-codex                        │
│                                                    │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐  │
│  │FeishuBot │◄──│  Router  │──►│ CodexBridge  │  │
│  │(unchanged)│   │(minor)   │   │ (rewrite)    │  │
│  └──────────┘   └──────────┘   └──────────────┘  │
│       │              │               │             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐      │
│  │ Card.ts  │   │ Session  │   │ Database │      │
│  │(minor)   │   │(tweak)   │   │ (tweak)  │      │
│  └──────────┘   └──────────┘   └──────────┘      │
└──────────────────────────────────────────────────┘
```

## File Change Matrix

| File | Change Level | Description |
|------|-------------|-------------|
| `src/codex/bridge.ts` | Rewrite | New file. Replaces `claude/bridge.ts` with Codex SDK calls |
| `src/core/router.ts` | Minor | Remove `ask_questions` handling, adapt bridge call signature |
| `src/core/session.ts` | Tweak | `sessionId` → `threadId` naming |
| `src/feishu/card.ts` | Minor | Remove `buildQuestionFormElements()` |
| `src/feishu/bot.ts` | Tweak | Remove question-form-related methods (`appendCardElements`, `closeCardStreaming`, `reopenCardStreaming`) |
| `src/db/database.ts` | Tweak | Remove `allowed_tools` column; `session_id` semantics → Codex thread ID |
| `src/utils/config.ts` | Tweak | `ANTHROPIC_*` → `OPENAI_*` env vars, add `OPENAI_MODEL` |
| `src/core/command.ts` | Unchanged | Command parser is generic |
| `src/utils/logger.ts` | Unchanged | Logger is generic |
| `src/core/question-manager.ts` | Delete | Codex SDK has no `canUseTool` hook for AskUserQuestion interception |
| `src/index.ts` | Tweak | Replace component names |

## Removed Features

- `QuestionManager` and all interactive form/question logic
- `canUseTool` hook (Codex SDK does not expose tool-level hooks)
- Claude plugin discovery (`discoverPlugins()`, `settingSources`)
- `allowedTools` configuration (Codex uses `sandboxMode` instead)

## CodexBridge Design (Core Rewrite)

### StreamEvent Interface (retained, minus ask_questions)

```typescript
type StreamEvent = {
  type: 'text' | 'tool_use' | 'tool_result' | 'result',
  content: string,
  toolName?: string,
  toolLabel?: string,
  sessionId?: string,      // Codex threadId
  costUsd?: number,        // Estimated from token counts
  durationMs?: number,
  numTurns?: number,
}
```

### Event Mapping: Codex ThreadEvent → StreamEvent

| Codex ThreadEvent | StreamEvent |
|-------------------|-------------|
| `thread.started` | Internal — record threadId, do not emit |
| `turn.started` | Internal state, do not emit |
| `item.started` (AgentMessageItem) | `type: 'text'`, `content: item.content` |
| `item.updated` (AgentMessageItem) | `type: 'text'`, `content: item.content` (incremental) |
| `item.started` (CommandExecutionItem) | `type: 'tool_use'`, `toolName: 'Bash'`, `toolLabel: 'Bash(cmd...)'` |
| `item.completed` (CommandExecutionItem) | `type: 'tool_result'`, `content: item.output` |
| `item.started` (FileChangeItem) | `type: 'tool_use'`, `toolName: 'FileChange'`, `toolLabel: 'FileChange(path)'` |
| `item.completed` (FileChangeItem) | `type: 'tool_result'`, `content: changes summary` |
| `item.started` (McpToolCallItem) | `type: 'tool_use'`, `toolName: item.tool` |
| `item.completed` (McpToolCallItem) | `type: 'tool_result'`, `content: result` |
| `item.started` (ReasoningItem) | Ignored (or optionally displayed as text) |
| `turn.completed` | `type: 'result'`, `sessionId: threadId`, cost/duration/turns |
| `turn.failed` | Throw exception, router catches and shows error card |

### CodexBridge Class Structure

```typescript
class CodexBridge {
  private codex: Codex;
  private busyAbortController: AbortController | null = null;

  constructor() {
    this.codex = new Codex({
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    });
  }

  get isBusy(): boolean { return !!this.busyAbortController; }
  abort(): void { this.busyAbortController?.abort(); this.busyAbortController = null; }

  async execute(
    prompt: string,
    options: {
      cwd: string,
      resume?: string,           // threadId
      maxTurns?: number,
      permissionMode?: string,
      attachments?: Buffer[],    // images
    },
    onStream: (event: StreamEvent) => void
  ): Promise<void>;
}
```

### Permission Mode Mapping

| `permission_mode` | Claude SDK | Codex SDK |
|-------------------|-----------|-----------|
| `bypassPermissions` | `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions` | `approvalPolicy: 'never'` + `sandboxMode: 'danger-full-access'` |
| `acceptEdits` | `permissionMode: 'acceptEdits'` | `approvalPolicy: 'on-failure'` + `sandboxMode: 'workspace-write'` |
| `default` | `permissionMode: 'default'` | `approvalPolicy: 'on-request'` + `sandboxMode: 'read-only'` |

### Multimodal Image Handling

Codex SDK accepts images via `{ type: 'local_image', path: string }` (file paths only, no base64). The bridge writes Feishu image buffers to temporary files, passes paths to the SDK, and cleans up after execution.

### Cost Estimation

Codex SDK returns `input_tokens`, `cached_input_tokens`, and `output_tokens` (not a dollar amount). The bridge estimates cost using per-token pricing for the configured model.

## Router Changes

- Remove `ask_questions` event branch (~40 lines)
- Remove `handleCardAction()` form submission logic
- Remove `questionManager` references
- Remove `enableQuestions` and `allowedTools` from bridge call options
- Rename `resumeSessionId` → `resumeThreadId`

## Card Changes

- Remove `buildQuestionFormElements()`
- Adjust cost display in done card to show token-estimated cost (`~$x.xx`)

## Database Changes

- Remove `allowed_tools` column from `projects` table
- `sessions.session_id` semantics: Claude session UUID → Codex thread ID (no schema change)

## Config / Environment

```bash
# Required
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxx

# Optional
OPENAI_BASE_URL=               # Proxy support
OPENAI_MODEL=codex-mini        # Default model

# Project defaults
DEFAULT_PERMISSION_MODE=bypassPermissions
DEFAULT_MAX_TURNS=100

# System
LOG_LEVEL=info
DB_PATH=./data/bridge.db
```

Removed: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `DEFAULT_ALLOWED_TOOLS`.

## Dependencies

```diff
- "@anthropic-ai/claude-agent-sdk": "^0.2.70"
+ "@openai/codex-sdk": "^0.112.0"
```

All other dependencies unchanged: `@larksuiteoapi/node-sdk`, `better-sqlite3`, `dotenv`.

## Commands (All Retained)

`/add`, `/remove`, `/use`, `/list`, `/status`, `/reset`, `/stop`, `/history`, `/resume`, `/config`, `/cost`, `/help`

The `/config` command no longer supports `allowed_tools` key. All other config keys remain.

## Final Directory Structure

```
feishu-codex/
├── src/
│   ├── index.ts
│   ├── codex/
│   │   └── bridge.ts          # Rewrite
│   ├── core/
│   │   ├── command.ts         # Unchanged
│   │   ├── session.ts         # Tweak
│   │   └── router.ts          # Minor changes
│   ├── feishu/
│   │   ├── bot.ts             # Tweak
│   │   └── card.ts            # Minor changes
│   ├── db/
│   │   └── database.ts        # Tweak
│   └── utils/
│       ├── config.ts          # Tweak
│       └── logger.ts          # Unchanged
├── package.json
├── tsconfig.json
├── ecosystem.config.cjs
├── .env.example
└── README.md
```
