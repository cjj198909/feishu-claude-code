# Feishu Claude Code Bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

> 在飞书中与 Claude Code 对话，像在终端里一样写代码。

一个轻量级 Node.js 服务，将飞书 IM 与 [Claude Code Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) 打通——消息直传 Claude Code，零中间层、零 Prompt 工程，保留完整的工具调用能力。个人或小团队即可在飞书群聊中完成代码审查、Bug 修复、功能开发等日常编码工作。

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 🤖 **零中间层** | 飞书消息直传 Claude Code Agent SDK，保留完整 Agentic 能力 |
| 📁 **多项目管理** | 一个 Bot 管理多个项目目录，`/use` 一键切换 |
| 💾 **会话持久化** | 每个项目独立会话上下文，`/resume` 恢复历史对话 |
| 🔄 **流式卡片** | 实时展示思考过程和工具调用，基于 Cardkit JSON 2.0 逐元素更新 |
| 🖼️ **多模态** | 直接发送截图、架构图，Claude 自动识别分析 |
| 🧩 **交互式表单** | Claude 提问时自动弹出飞书表单，支持单选/多选/自由输入 |
| 🔌 **插件支持** | 自动发现并加载 `~/.claude/plugins/cache` 下的 Claude Code 插件 |
| 📊 **费用追踪** | `/cost` 实时查看 API 用量，按日/周/月/项目维度统计 |

### 技术亮点

- ✅ WebSocket 长连接 — 无需公网 IP、无需 Webhook
- ✅ 忙碌锁 — 同一时刻只执行一个任务，避免资源争抢
- ✅ 消息去重 — 自动处理飞书重试，不会重复执行
- ✅ 优雅停机 — `SIGINT`/`SIGTERM` 时中止进行中任务，等待卡片最终更新
- ✅ 33 个单元测试覆盖核心逻辑

## 📸 效果预览

```
👤 /add frontend ~/projects/my-app
🤖 ✅ 已添加项目 frontend → ~/projects/my-app

👤 /use frontend
🤖 🔀 已切换到项目 frontend

👤 帮我看看这个项目的技术栈和目录结构
🤖 ┌─ 正在执行... ──────────────────────┐
   │                                     │
   │  🔧 Read(package.json)              │
   │  📂 Glob(src/**/*.{ts,tsx})         │
   │  🔧 Read(tsconfig.json)            │
   │                                     │
   │  这是一个 React 18 + TypeScript 项目  │
   │  ├── src/components/  — UI 组件     │
   │  ├── src/hooks/       — 自定义 Hooks│
   │  ├── src/api/         — API 层      │
   │  └── src/utils/       — 工具函数    │
   │  使用 Vite 构建，Tailwind CSS 样式... │
   │                                     │
   │  ⏱️ 8s · 💰 $0.03 · 🔧 3 tools     │
   └─ ✅ 完成 ─────────────────────────────┘

👤 [发送一张 UI 截图]
🤖 这是一个登录页面，我来帮你分析一下布局和改进建议...
```

## 🚀 快速开始

### 前置要求

- **Node.js** >= 20.0.0
- **飞书企业账号**（需创建自建应用）
- **Anthropic API Key** 或兼容的第三方 API

### 1. 克隆并安装

```bash
git clone https://github.com/cjj198909/feishu-claude-code.git
cd feishu-claude-code
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
# ── 必填 ──────────────────────────────────
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx       # 飞书开发者后台获取
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxx

# 二选一：官方 API 或第三方兼容 API
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx   # Anthropic 控制台获取
# ANTHROPIC_BASE_URL=https://your-proxy  # 第三方 API 地址
# ANTHROPIC_AUTH_TOKEN=your-key          # 第三方鉴权 Token

# ── 可选（以下为默认值）─────────────────────
# DEFAULT_PERMISSION_MODE=bypassPermissions
# DEFAULT_ALLOWED_TOOLS=Read,Write,Edit,Bash,Glob,Grep
# DEFAULT_MAX_TURNS=100
# LOG_LEVEL=info
# DB_PATH=./data/bridge.db
```

### 3. 配置飞书应用

访问 [飞书开放平台](https://open.feishu.cn/app) → 创建企业自建应用：

**① 添加应用能力**
- ✅ 机器人

**② 权限配置**（权限管理页面）
- `im:message` — 获取与发送单聊、群组消息
- `im:message.group_at_msg` — 接收群聊中 @机器人消息
- `im:message.p2p_msg` — 接收单聊消息
- `im:resource` — 获取与上传图片、文件资源

**③ 事件订阅**（事件与回调页面）
- 启用 **WebSocket 模式**（无需公网 IP）
- 订阅事件：`im.message.receive_v1`

**④ 发布**
- 创建版本 → 申请发布 → 审核通过后可用

### 4. 启动服务

```bash
# 开发模式（热重载）
npm run dev

# 生产构建
npm run build && npm start

# PM2 托管（推荐）
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

### 5. 开始使用

在飞书中与 Bot 单聊或将其加入群聊：

```
/add myproject /path/to/your/project
/use myproject
帮我看看这个项目的结构
```

## 📚 命令参考

### 项目管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `/add <名称> <路径>` | 注册项目目录 | `/add web ~/projects/web-app` |
| `/remove <名称>` | 删除项目 | `/remove web` |
| `/use <名称>` | 切换当前项目 | `/use web` |
| `/list` | 列出所有已注册项目 | `/list` |
| `/config <key> <val>` | 修改项目配置 | `/config permission_mode default` |

### 会话管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `/status` | 查看当前项目、会话、忙碌状态 | `/status` |
| `/reset` | 丢弃当前会话，开始新对话 | `/reset` |
| `/history` | 列出当前项目的历史会话 | `/history` |
| `/resume <id>` | 恢复历史会话（带上下文） | `/resume 3` |

### 任务控制

| 命令 | 说明 | 示例 |
|------|------|------|
| `/stop` | 中止当前正在执行的任务 | `/stop` |
| `/cost` | 查看费用统计（日/周/月/项目） | `/cost` |
| `/help` | 查看帮助信息 | `/help` |

### 项目配置项

通过 `/config <key> <value>` 修改：

| Key | 可选值 | 说明 |
|-----|--------|------|
| `permission_mode` | `bypassPermissions` · `acceptEdits` · `default` | 工具权限模式 |
| `allowed_tools` | 逗号分隔的工具名 | 允许使用的工具，如 `Read,Glob,Grep` |
| `max_turns` | 正整数 | 单次任务最大执行轮次 |
| `description` | 任意文本 | 项目描述（`/list` 中展示） |

## 🎯 使用场景

**代码审查** — 发送文件路径或截图，Claude 分析代码质量并给出改进建议

**Bug 修复** — 描述问题现象，Claude 读取代码定位根因、修复并提交 commit

**功能开发** — "添加用户登录功能"，Claude 设计方案、生成代码、编写测试，全程流式可见

**项目文档** — "生成这个项目的 API 文档"，Claude 扫描源码自动输出 Markdown

**多项目工作流** — `/use frontend` 处理前端 → `/use backend` 切到后端 → `/use infra` 改基础设施

## 🏗️ 架构

```
                        ┌──────────────┐
                        │   飞书用户    │
                        │  发消息/图片  │
                        └──────┬───────┘
                               │ WebSocket
                ┌──────────────▼──────────────┐
                │     FeishuBot (bot.ts)       │
                │  WebSocket · 卡片更新 · 图片  │
                └──────────────┬──────────────┘
                               │
                ┌──────────────▼──────────────┐
                │   MessageRouter (router.ts)  │
                │  命令解析 · 流式卡片编排       │
                │  QuestionManager · 表单交互   │
                └───┬──────────────────────┬───┘
                    │                      │
        ┌───────────▼───────────┐  ┌───────▼───────┐
        │  ClaudeCodeBridge     │  │ SessionManager│
        │  (bridge.ts)          │  │ (session.ts)  │
        │  Agent SDK · 忙碌锁   │  │ 项目/会话映射  │
        │  流式事件 · 插件加载   │  └───────┬───────┘
        └───────────────────────┘          │
                                   ┌───────▼───────┐
                                   │   Database     │
                                   │ (database.ts)  │
                                   │ SQLite · WAL   │
                                   └────────────────┘
```

### 技术栈

| 组件 | 技术 | 版本 |
|------|------|------|
| 运行时 | Node.js + TypeScript ESM | 20+ / 5.9 |
| Claude 集成 | @anthropic-ai/claude-agent-sdk | ^0.2.70 |
| 飞书集成 | @larksuiteoapi/node-sdk (WSClient) | ^1.59.0 |
| 数据存储 | better-sqlite3 (WAL 模式) | ^12.6.2 |
| 进程管理 | PM2 | latest |
| 测试 | Vitest | ^4.0.18 |

### 目录结构

```
src/
├── index.ts                    # 入口：组装各模块并启动
├── feishu/
│   ├── bot.ts                  # WebSocket 连接、消息/卡片收发、图片下载
│   └── card.ts                 # 流式卡片、完成/错误/中止卡片、交互表单
├── claude/
│   └── bridge.ts               # Agent SDK 封装、忙碌锁、多模态、插件发现
├── core/
│   ├── command.ts              # 命令解析器（/add /use /stop 等）
│   ├── session.ts              # 会话管理器（项目 ↔ 会话映射）
│   ├── router.ts               # 消息路由与流式卡片编排
│   └── question-manager.ts     # Claude 提问 ↔ 飞书表单交互协调
├── db/
│   └── database.ts             # SQLite 初始化与 CRUD
└── utils/
    ├── config.ts               # 环境变量加载
    └── logger.ts               # 日志（info/warn/error/debug）
```

## 🔒 安全配置

### 权限模式

默认使用 `bypassPermissions`（适合个人自动化场景）。如需更细粒度控制：

```bash
# 只读模式 — 仅查询，不修改文件
/config allowed_tools Read,Glob,Grep

# 可编辑但不可执行命令
/config allowed_tools Read,Write,Edit,Glob,Grep

# 切换为逐次确认模式
/config permission_mode default
```

### 生产部署建议

- 使用 PM2 托管，限制内存和自动重启（已内置 `ecosystem.config.cjs`）
- 考虑在 Docker 容器中运行，限制文件系统和网络权限
- 定期通过 `/cost` 监控 API 用量

## 🐛 故障排查

### 飞书连接失败

**表现**：启动后无法接收消息

```bash
# 检查凭据
echo $FEISHU_APP_ID && echo $FEISHU_APP_SECRET

# 查看日志
pm2 logs feishu-claude-bridge
```

✅ 确认应用已发布并通过审核
✅ 确认权限和事件订阅已正确配置
✅ 确认 WebSocket 模式已启用

### Claude API 报错

**表现**：执行任务时返回错误卡片

```bash
# 测试 API 连接
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01"
```

✅ 确认 API Key 有效且账户余额充足
✅ 如使用第三方 API，确认 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`

### 任务无响应

**表现**：发送消息后无反馈

```bash
/status   # 查看是否有任务占用忙碌锁
/stop     # 中止卡住的任务
```

如仍无法恢复：`pm2 restart feishu-claude-bridge`

### 数据库异常

```bash
# 检查文件权限
ls -la data/bridge.db

# 重建（自动重新创建表结构）
rm data/bridge.db && npm run dev
```

## 🤝 参与贡献

```bash
# 开发
git checkout -b feature/my-feature
npm run dev

# 测试
npm test              # 运行全部测试
npm run test:watch    # 监视模式

# 提交
git commit -m 'feat: add my feature'
git push origin feature/my-feature
# → 提交 Pull Request
```

项目使用 TypeScript strict 模式，请确保新功能附带单元测试。

## 📄 许可证

[MIT License](LICENSE)

## 🙏 致谢

- [Anthropic Claude](https://www.anthropic.com/) — AI 能力提供
- [Claude Code Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) — 官方 Agent SDK
- [飞书开放平台](https://open.feishu.cn/) — 企业 IM 集成

---

⚡ Built with [Claude Code Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk)
