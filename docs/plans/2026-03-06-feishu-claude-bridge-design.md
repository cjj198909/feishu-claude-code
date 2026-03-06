# Feishu x Claude Code Bridge - Design Document

## Overview

A lightweight Node.js service bridging Feishu IM and Claude Code Agent SDK. Personal use, single process, one task at a time with busy lock.

## Design Decisions

- **Personal use only**: no user isolation, global project list and sessions
- **Single process + busy lock**: one Claude Code task at a time; new prompts during execution get "please wait or /stop"
- **Simple streaming**: update Feishu card per turn (not per token), throttled at 800ms
- **Per-project permission mode**: each project can configure `permission_mode` and `allowed_tools`
- **Truncate long output**: card markdown capped at ~4000 chars, append truncation notice
- **Image support (MVP)**: download Feishu image to temp file, include path in prompt for Claude Code to Read
  - TODO: check if SDK `query()` supports multimodal content blocks; if yes, pass image directly

## Tech Stack

| Component | Choice |
|---|---|
| Runtime | Node.js 20+ (TypeScript ESM) |
| Claude Code | `@anthropic-ai/claude-agent-sdk` |
| Feishu | `@larksuiteoapi/node-sdk` (WSClient) |
| Database | SQLite (`better-sqlite3`) |
| Process manager | PM2 |

## Data Model

```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  path TEXT NOT NULL,
  description TEXT,
  permission_mode TEXT DEFAULT 'bypassPermissions',
  allowed_tools TEXT DEFAULT 'Read,Write,Edit,Bash,Glob,Grep',
  max_turns INTEGER DEFAULT 100,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  summary TEXT,
  is_active BOOLEAN DEFAULT 0,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_name TEXT NOT NULL,
  session_id TEXT,
  cost_usd REAL DEFAULT 0,
  duration_ms INTEGER,
  num_turns INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Command System

| Command | Description |
|---|---|
| `/add <name> <path>` | Add project |
| `/remove <name>` | Remove project |
| `/use <name>` | Switch active project |
| `/list` | List all projects |
| `/status` | Current project and session status |
| `/reset` | Start new session for current project |
| `/stop` | Abort running task |
| `/history` | List sessions for current project |
| `/resume <id>` | Resume session by DB id (not UUID) |
| `/config <key> <value>` | Modify current project config |
| `/cost` | View usage statistics |
| `/help` | Help message |

## Module Structure

```
src/
  index.ts              -- Entry point: init DB, start WSClient
  feishu/
    bot.ts              -- WSClient, send/update messages
    card.ts             -- Card template builders (running/done/error)
    image.ts            -- Download Feishu images to temp files
  claude/
    bridge.ts           -- query() wrapper, busy lock, abort
  core/
    router.ts           -- Route: command vs prompt
    command.ts          -- Parse and execute /commands
    session.ts          -- Project CRUD, session management
  db/
    database.ts         -- SQLite init and migrations
  utils/
    config.ts           -- Env var loading
    logger.ts           -- Simple logger
```

## Message Flow

```
Feishu message in
  -> router.ts: command (starts with /) or prompt?

Command -> command.ts -> execute -> reply text

Prompt ->
  1. Check active project (none -> hint /use)
  2. Check busy lock (busy -> hint wait or /stop)
  3. Get active session_id for project (may be null)
  4. If image message, download to /tmp/feishu-images/
  5. Send initial card (status: running, header: blue)
  6. Set busy lock
  7. Call query() with cwd, resume, allowedTools, permissionMode
  8. Each turn -> update card (throttle 800ms): tool calls list + latest text
  9. On complete:
     - Save new session_id
     - Record usage_stats (cost, duration, turns)
     - Release busy lock
     - Final card update (status: done, header: green)
  10. On error:
     - Release busy lock
     - Update card (status: error, header: red)
```

## Card Templates

### Running (blue header)
- Header: "Executing | Project: {name}"
- Body: tool call list + latest text output
- Note: elapsed time, tool count

### Done (green header)
- Header: "Done | Project: {name}"
- Body: final output text (truncated at ~4000 chars)
- Note: tool summary, elapsed time, cost, turn count

### Error (red header)
- Header: "Error | Project: {name}"
- Body: error message
- Note: elapsed time

## /cost Output

```
Today:  $0.15 (12 calls, 156 turns)
Week:   $0.82 (47 calls)
Month:  $3.21 (186 calls)

By project:
  frontend   $1.50 (89 calls)
  backend    $1.71 (97 calls)
```

## Error Handling

| Scenario | Handling |
|---|---|
| No active project | Text hint to /use |
| Project path doesn't exist | Reject on /add |
| Execution timeout | Rely on maxTurns |
| Prompt during busy | Busy lock hint |
| /stop | AbortController.abort(), card -> "aborted" |
| WebSocket disconnect | SDK auto-reconnect |
| Card update throttled | Ignore failure, retry next cycle |
| Session resume failure | Catch, start new session, notify user |
| Path traversal (.. in path) | Reject on /add |

## Out of Scope (YAGNI)

- Message retry queue
- Multi-user isolation
- Webhook mode
- Web dashboard
- Full message content persistence
