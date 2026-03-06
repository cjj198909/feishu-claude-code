# 飞书 × Claude Code 轻量桥接 — 项目计划

## 1. 项目概述

### 目标
构建一个轻量级 Node.js 服务，作为飞书 IM 和 Claude Code 之间的桥接层。用户在飞书中发消息，直接由 Claude Code Agent 处理并返回结果。支持多项目切换、会话恢复、流式输出。

### 核心原则
- **零中间 AI 层**：飞书消息直传 Claude Code，不经过额外的 LLM 处理
- **一个飞书 Bot，多个项目**：通过命令切换工作目录，无需创建多个飞书应用
- **会话持久化**：每个项目维持独立的 Claude Code 会话上下文，切换不丢失历史
- **流式输出**：实时展示 Claude Code 的思考过程和工具调用

### 技术栈
| 组件 | 选型 | 说明 |
|---|---|---|
| 运行时 | Node.js 20+ (TypeScript) | |
| Claude Code 集成 | `@anthropic-ai/claude-agent-sdk` | 官方 TypeScript SDK，programmatic API |
| 飞书接入 | `@larksuiteoapi/node-sdk` | 官方 SDK，WebSocket 长连接模式 |
| 数据存储 | SQLite (better-sqlite3) | 存储项目配置、会话映射、消息日志 |
| 进程管理 | PM2 | 生产环境守护进程 |

---

## 2. 架构设计

```
┌─────────────────────────────────────────────────────┐
│                    飞书 (WebSocket)                    │
│              用户发消息 / 接收流式回复                   │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Feishu Bridge Server                     │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ 消息路由器   │  │ 会话管理器    │  │ 命令解析器  │ │
│  │ MessageRouter│  │SessionManager│  │CommandParser│ │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘ │
│         └────────────────┼─────────────────┘        │
│                          │                           │
│  ┌───────────────────────▼───────────────────────┐  │
│  │           Claude Agent SDK Wrapper             │  │
│  │  - query() 调用，流式获取结果                    │  │
│  │  - cwd 按项目切换                               │  │
│  │  - sessionId 恢复上下文                         │  │
│  └───────────────────────┬───────────────────────┘  │
│                          │                           │
│  ┌───────────────────────▼───────────────────────┐  │
│  │              SQLite 存储层                      │  │
│  │  - projects: 项目名 → 路径映射                  │  │
│  │  - sessions: 用户×项目 → sessionId 映射         │  │
│  │  - logs: 消息日志（可选）                       │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 3. 数据模型

### 3.1 projects 表
```sql
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,        -- 项目短名，如 "frontend"
  path TEXT NOT NULL,               -- 绝对路径，如 "/home/gordon/frontend"
  description TEXT,                 -- 可选描述
  allowed_tools TEXT DEFAULT 'Read,Write,Edit,Bash,Glob,Grep',
  max_turns INTEGER,                -- 可选执行轮次上限
  max_budget_usd REAL,              -- 可选花费上限
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2 sessions 表
```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,            -- 飞书 open_id
  project_name TEXT NOT NULL,       -- 关联项目
  session_id TEXT,                  -- Claude Code 的 session UUID
  is_active BOOLEAN DEFAULT 0,     -- 当前是否为该用户的激活项目
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, project_name)
);
```

### 3.3 message_logs 表（可选）
```sql
CREATE TABLE message_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  direction TEXT NOT NULL,          -- 'in' | 'out'
  content TEXT NOT NULL,
  tool_calls TEXT,                  -- JSON，记录 tool call 详情
  cost_usd REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. 命令系统

所有以 `/` 开头的消息视为命令，其余为普通 prompt 转发给 Claude Code。

| 命令 | 说明 | 示例 |
|---|---|---|
| `/add <name> <path>` | 添加项目 | `/add frontend /home/gordon/frontend` |
| `/remove <name>` | 删除项目 | `/remove frontend` |
| `/use <name>` | 切换当前项目 | `/use backend` |
| `/list` | 列出所有项目 | `/list` |
| `/status` | 当前会话状态 | `/status` |
| `/reset` | 重置当前项目会话 | `/reset` |
| `/stop` | 中止当前正在执行的任务 | `/stop` |
| `/history` | 查看当前项目的历史会话列表 | `/history` |
| `/resume <sessionId>` | 恢复指定历史会话 | `/resume abc-123` |
| `/config <key> <value>` | 修改项目配置 | `/config frontend max_turns 50` |
| `/help` | 帮助信息 | `/help` |

---

## 5. 核心模块设计

### 5.1 CommandParser（命令解析器）

```typescript
interface ParsedCommand {
  type: 'command';
  name: string;          // add, remove, use, list, etc.
  args: string[];
}

interface ParsedPrompt {
  type: 'prompt';
  text: string;
}

function parse(input: string): ParsedCommand | ParsedPrompt;
```

### 5.2 SessionManager（会话管理器）

职责：
- 维护 user → active project 映射
- 管理 (user, project) → Claude Code sessionId 映射
- 持久化到 SQLite

```typescript
interface SessionManager {
  // 项目管理
  addProject(name: string, path: string, options?: ProjectOptions): void;
  removeProject(name: string): void;
  listProjects(): Project[];

  // 会话切换
  switchProject(userId: string, projectName: string): void;
  getActiveProject(userId: string): Project | null;

  // Claude Code 会话
  getSessionId(userId: string, projectName: string): string | null;
  saveSessionId(userId: string, projectName: string, sessionId: string): void;
  resetSession(userId: string, projectName: string): void;
}
```

### 5.3 ClaudeCodeBridge（Claude Code 桥接层）

核心模块，封装 Claude Agent SDK 调用。

```typescript
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';

interface ClaudeCodeBridge {
  /**
   * 执行一次 prompt，流式返回结果
   * @param prompt - 用户输入
   * @param options - 包含 cwd, sessionId, allowedTools 等
   * @param onStream - 流式回调，每收到一条消息就调用
   * @returns 最终结果和新的 sessionId
   */
  execute(
    prompt: string,
    options: {
      cwd: string;
      resume?: string;           // 恢复已有会话
      allowedTools?: string[];
      maxTurns?: number;
      maxBudgetUsd?: number;
      permissionMode?: 'default' | 'bypassPermissions' | 'acceptEdits';
      abortController?: AbortController;
    },
    onStream: (event: StreamEvent) => void
  ): Promise<ExecutionResult>;

  /**
   * 中止当前正在执行的任务
   */
  abort(userId: string): void;
}

interface StreamEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'done';
  content: string;
  toolName?: string;
}

interface ExecutionResult {
  sessionId: string;      // 用于后续恢复
  result: string;         // 最终文本结果
  costUsd?: number;
  toolCalls: ToolCallLog[];
}
```

**SDK 调用示例：**

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

async function execute(prompt: string, options: ExecuteOptions, onStream: StreamCallback) {
  const queryOptions: Options = {
    cwd: options.cwd,
    allowedTools: options.allowedTools ?? ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    permissionMode: options.permissionMode ?? 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    resume: options.resume,       // 传入 sessionId 恢复会话
  };

  let sessionId = '';
  let resultText = '';

  for await (const message of query({ prompt, options: queryOptions })) {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if ('text' in block) {
          onStream({ type: 'text', content: block.text });
          resultText = block.text;
        } else if ('name' in block) {
          onStream({ type: 'tool_use', content: `调用工具: ${block.name}`, toolName: block.name });
        }
      }
    } else if (message.type === 'result') {
      sessionId = message.session_id;  // 保存 sessionId 供下次恢复
      onStream({ type: 'done', content: resultText });
    }
  }

  return { sessionId, result: resultText };
}
```

### 5.4 FeishuBot（飞书消息收发）

```typescript
interface FeishuBot {
  /**
   * 启动 WebSocket 长连接，监听消息事件
   */
  start(): Promise<void>;

  /**
   * 发送文本消息（支持 Markdown）
   */
  sendText(chatId: string, text: string): Promise<void>;

  /**
   * 更新消息卡片（用于流式输出）
   * 飞书支持更新已发送的消息，可以实现"打字机"效果
   */
  updateCard(messageId: string, content: CardContent): Promise<void>;

  /**
   * 发送交互式卡片（展示 tool calls、状态等）
   */
  sendCard(chatId: string, card: CardContent): Promise<void>;
}
```

---

## 6. 流式输出方案

飞书不支持 SSE，但支持**消息更新**。方案：

1. Claude Code 开始执行时，先发送一张**消息卡片**（状态：执行中 🔄）
2. 每隔 500ms-1s，批量收集新内容，**更新同一张卡片**
3. 执行完成后，最终更新卡片（状态：完成 ✅）
4. 如果输出过长，拆分为多张卡片

### 卡片结构设计

```
┌─────────────────────────────────────┐
│ 🔄 执行中 | 项目: frontend          │
├─────────────────────────────────────┤
│                                     │
│ 🔧 Read src/App.tsx                 │
│ 🔧 Edit src/App.tsx                 │
│ ✏️  添加了登录组件路由              │
│                                     │
│ 正在分析代码结构...                  │
│                                     │
├─────────────────────────────────────┤
│ ⏱️ 15s | 💰 $0.03 | 🔧 3 tools     │
└─────────────────────────────────────┘
```

---

## 7. 用户交互流程

### 7.1 首次使用
```
用户: /add myapp /home/gordon/myapp
Bot:  ✅ 已添加项目 myapp → /home/gordon/myapp

用户: /use myapp
Bot:  🔀 已切换到项目 myapp

用户: 帮我看看项目结构
Bot:  [Claude Code 执行并流式返回结果]
```

### 7.2 多项目切换
```
用户: /use backend
Bot:  🔀 已切换到 backend（上次会话 2h 前，可恢复上下文）

用户: 最近的 API 改了哪些？
Bot:  [Claude Code 在 backend 目录下工作，恢复之前的会话上下文]
```

### 7.3 会话恢复
```
用户: /history
Bot:  📋 frontend 的历史会话:
      1. abc-123 (2h 前) - 添加登录页面
      2. def-456 (昨天) - 修复路由 bug

用户: /resume abc-123
Bot:  🔄 已恢复会话 abc-123（添加登录页面）
```

---

## 8. 配置文件

### 8.1 .env

```bash
# 飞书应用凭据
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxx

# Claude Code 认证
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
# 或使用第三方兼容 API:
# ANTHROPIC_BASE_URL=https://api.provider.com/anthropic
# ANTHROPIC_AUTH_TOKEN=your-key

# 可选配置
DEFAULT_PERMISSION_MODE=bypassPermissions    # 或 acceptEdits, default
DEFAULT_ALLOWED_TOOLS=Read,Write,Edit,Bash,Glob,Grep
LOG_LEVEL=info
DB_PATH=./data/bridge.db

# 访问控制（可选）
ALLOWED_USER_IDS=ou_xxx,ou_yyy              # 限制允许使用的飞书用户
```

### 8.2 项目目录结构

```
feishu-claude-bridge/
├── src/
│   ├── index.ts              # 入口，启动飞书 bot + 初始化
│   ├── feishu/
│   │   ├── bot.ts            # 飞书 WebSocket 连接 & 消息收发
│   │   ├── card.ts           # 飞书消息卡片模板
│   │   └── types.ts
│   ├── claude/
│   │   ├── bridge.ts         # Claude Agent SDK 封装
│   │   ├── stream.ts         # 流式输出处理
│   │   └── types.ts
│   ├── core/
│   │   ├── command.ts         # 命令解析器
│   │   ├── session.ts         # 会话管理器
│   │   ├── router.ts          # 消息路由（命令 vs prompt）
│   │   └── access.ts          # 用户访问控制
│   ├── db/
│   │   ├── database.ts        # SQLite 初始化 & 迁移
│   │   ├── projects.ts        # 项目 CRUD
│   │   └── sessions.ts        # 会话 CRUD
│   └── utils/
│       ├── logger.ts
│       └── config.ts          # 环境变量加载
├── data/                      # SQLite 数据文件（gitignore）
├── .env
├── package.json
├── tsconfig.json
├── ecosystem.config.cjs       # PM2 配置
└── README.md
```

---

## 9. 安全考虑

| 风险 | 措施 |
|---|---|
| 未授权访问 | `ALLOWED_USER_IDS` 白名单，只允许指定飞书用户使用 |
| Claude Code 越权操作 | `allowedTools` 控制可用工具，`permissionMode` 控制权限等级 |
| 路径遍历 | 项目路径注册时校验，不允许 `..` 和符号链接逃逸 |
| 费用失控 | `maxBudgetUsd` 限制单次任务费用，`maxTurns` 限制执行轮次 |
| 飞书凭据泄露 | `.env` 不入 git，运行时从环境变量读取 |

---

## 10. 开发计划

### Phase 1: 最小可用（MVP）—— 预计 3-5 天
- [ ] 项目脚手架（TypeScript + ESM + SQLite）
- [ ] 飞书 WebSocket 连接，收发消息
- [ ] Claude Agent SDK 基础封装（单次 query，文本输出）
- [ ] 命令系统：`/add`, `/use`, `/list`, `/help`
- [ ] 单用户、单项目可跑通

### Phase 2: 多项目 & 会话管理 —— 预计 2-3 天
- [ ] 多项目注册和切换
- [ ] 会话持久化（sessionId 保存/恢复）
- [ ] `/reset`, `/history`, `/resume` 命令
- [ ] 用户访问控制

### Phase 3: 流式体验 —— 预计 2-3 天
- [ ] 飞书消息卡片模板
- [ ] 流式更新卡片（定时刷新）
- [ ] Tool call 实时展示
- [ ] 执行耗时 & 费用统计

### Phase 4: 生产化 —— 预计 1-2 天
- [ ] PM2 配置 & 一键启动脚本
- [ ] 错误处理 & 重连机制
- [ ] 日志系统
- [ ] `/stop` 中止功能
- [ ] README 文档

### 总计预估：8-13 天

---

## 11. 后续可扩展方向

- **Telegram 支持**：加一个 Telegram adapter，复用核心逻辑
- **多用户隔离**：不同用户的项目列表互相隔离
- **项目模板**：预设常用项目配置（Web 前端、Python 后端等）
- **Agent 子任务派发**：一个项目的 Agent 调用另一个项目的 Agent
- **MCP Server 集成**：为项目配置自定义 MCP Server（数据库、API 等）
- **Web Dashboard**：可视化管理项目、查看日志和费用

---

## 12. 关键依赖版本

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.x",
    "@larksuiteoapi/node-sdk": "^1.x",
    "better-sqlite3": "^11.x",
    "dotenv": "^16.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "@types/better-sqlite3": "^7.x",
    "@types/node": "^22.x"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

---

## 13. 注意事项

1. **Claude Agent SDK 命名变更**：原 `@anthropic-ai/claude-code` SDK 已更名为 `@anthropic-ai/claude-agent-sdk`，注意安装正确的包
2. **bypassPermissions 模式**：需要同时设置 `permissionMode: 'bypassPermissions'` 和 `allowDangerouslySkipPermissions: true`，Claude Code 将跳过所有权限确认，适合自动化场景但需注意安全
3. **会话恢复**：通过 SDK 的 `resume` 参数传入上次的 `sessionId` 即可恢复上下文，无需手动管理对话历史
4. **飞书 WebSocket**：使用长连接模式，无需公网 IP 和 HTTPS 证书，适合内网部署
5. **飞书卡片更新限制**：同一张卡片的更新频率有限制（约 5次/秒），流式输出需要做节流（throttle）

