# Feishu Claude Code Bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

一个轻量级的 Node.js 服务，连接飞书 IM 与 Claude Code Agent SDK，实现在飞书中直接使用 Claude 进行代码辅助、项目管理和自动化任务。

## ✨ 特性

### 核心功能
- 🤖 **零中间层**：飞书消息直传 Claude Code，无额外 LLM 处理
- 📁 **多项目管理**：一个飞书 Bot，通过命令切换多个项目工作目录
- 💾 **会话持久化**：每个项目独立维护 Claude Code 会话上下文，切换不丢失历史
- 🔄 **流式输出**：实时展示 Claude Code 的执行过程和工具调用
- 🖼️ **多模态支持**：支持发送图片让 Claude 分析（截图、架构图等）
- 📊 **费用追踪**：实时统计 API 使用成本和执行时长

### 技术特性
- ✅ WebSocket 长连接（无需公网 IP）
- ✅ 消息去重和幂等性保护
- ✅ 忙碌锁机制（同时只执行一个任务）
- ✅ 任务中止支持（`/stop` 命令）
- ✅ 完整的 TypeScript 类型安全
- ✅ 33 个单元测试覆盖

## 📸 效果预览

```
用户: /add frontend /home/user/my-project
Bot:  ✅ 已添加项目 frontend → /home/user/my-project

用户: /use frontend
Bot:  🔀 已切换到项目 frontend

用户: 帮我分析一下 src/App.tsx 的代码结构
Bot:  [流式卡片实时更新]
      🔧 Read src/App.tsx
      🔧 Glob src/**/*.tsx
      ✏️  分析结果：
          - 使用 React 18 + TypeScript
          - 采用函数组件 + Hooks 模式
          - 路由配置在...

      ⏱️ 12s | 💰 $0.02 | 🔧 2 tools
```

## 🚀 快速开始

### 前置要求

- **Node.js** >= 20.0.0
- **飞书企业账号**（需创建应用）
- **Anthropic API Key**（Claude API 访问权限）

### 1. 安装依赖

```bash
git clone https://github.com/cjj198909/feishu-claude-code.git
cd feishu-claude-code
npm install
```

### 2. 配置环境变量

复制配置模板：
```bash
cp .env.example .env
```

编辑 `.env` 文件：
```bash
# 飞书应用凭据（从飞书开发者后台获取）
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxx

# Claude API（从 Anthropic 控制台获取）
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxx

# 可选：第三方兼容 API
# ANTHROPIC_BASE_URL=https://api.provider.com/anthropic
# ANTHROPIC_AUTH_TOKEN=your-key

# 可选配置
DEFAULT_PERMISSION_MODE=bypassPermissions  # 推荐保持默认
LOG_LEVEL=info
DB_PATH=./data/bridge.db
```

### 3. 配置飞书应用

访问 [飞书开放平台](https://open.feishu.cn/app) 创建应用：

1. **创建企业自建应用**
2. **添加应用能力**：
   - ✅ 机器人
3. **权限配置**（权限管理）：
   - ✅ `im:message` - 获取与发送单聊、群组消息
   - ✅ `im:message.group_at_msg` - 接收群聊中 @机器人消息事件
   - ✅ `im:message.p2p_msg` - 接收单聊消息事件
   - ✅ `im:resource` - 获取与上传图片、文件等资源
4. **事件订阅**（事件与回调）：
   - ✅ 启用 WebSocket 模式（推荐，无需公网 IP）
   - ✅ 订阅事件：
     - `im.message.receive_v1` - 接收消息
5. **发布版本**：
   - 创建版本 → 申请发布 → 通过后可用

### 4. 启动服务

**开发模式**（带热重载）：
```bash
npm run dev
```

**生产模式**：
```bash
npm run build
npm start
```

**使用 PM2**（推荐生产环境）：
```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # 设置开机自启
```

### 5. 在飞书中使用

1. **添加机器人到群聊或单聊**
2. **发送第一条命令**：
   ```
   /add myproject /path/to/your/project
   /use myproject
   帮我看看这个项目的结构
   ```

## 📚 命令列表

### 项目管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `/add <name> <path>` | 添加新项目 | `/add frontend /home/user/frontend` |
| `/remove <name>` | 删除项目 | `/remove frontend` |
| `/use <name>` | 切换当前项目 | `/use backend` |
| `/list` | 列出所有项目 | `/list` |
| `/config <key> <value>` | 修改项目配置 | `/config permission_mode default` |

### 会话管理

| 命令 | 说明 | 示例 |
|------|------|------|
| `/status` | 查看当前状态 | `/status` |
| `/reset` | 重置当前会话 | `/reset` |
| `/history` | 查看历史会话列表 | `/history` |
| `/resume <id>` | 恢复指定会话 | `/resume 3` |

### 任务控制

| 命令 | 说明 | 示例 |
|------|------|------|
| `/stop` | 中止当前任务 | `/stop` |
| `/cost` | 查看费用统计 | `/cost` |
| `/help` | 查看帮助信息 | `/help` |

### 配置选项

| 配置项 | 可选值 | 说明 |
|--------|--------|------|
| `permission_mode` | `bypassPermissions`, `acceptEdits`, `default` | 权限模式（推荐 `bypassPermissions`） |
| `allowed_tools` | `Read,Write,Edit,Bash,Glob,Grep` | 允许的工具列表 |
| `max_turns` | 数字（如 `50`） | 最大执行轮次 |
| `description` | 任意文本 | 项目描述 |

## 🎯 使用场景

### 1. 代码审查
```
发送代码截图或文件路径
Claude 自动分析并提供改进建议
```

### 2. Bug 修复
```
描述问题现象
Claude 读取相关代码，定位问题并修复
自动生成 git commit
```

### 3. 功能开发
```
描述需求："添加用户登录功能"
Claude 设计架构、生成代码、编写测试
实时查看执行过程
```

### 4. 项目文档
```
"帮我生成这个项目的 API 文档"
Claude 扫描代码，生成 Markdown 文档
```

### 5. 多项目切换
```
/use frontend   → 处理前端项目
/use backend    → 切换到后端项目
/use docs       → 编写文档
```

## 🏗️ 架构设计

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
│  │MessageRouter│  │SessionManager│  │CommandParser│ │
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
│  │  - sessions: 项目 → sessionId 映射              │  │
│  │  - usage_stats: 费用和使用统计                  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 技术栈

| 组件 | 技术选型 | 版本 |
|------|---------|------|
| 运行时 | Node.js + TypeScript | 20+ |
| Claude 集成 | @anthropic-ai/claude-agent-sdk | ^0.2.70 |
| 飞书集成 | @larksuiteoapi/node-sdk | ^1.59.0 |
| 数据存储 | better-sqlite3 | ^12.6.2 |
| 进程管理 | PM2 | latest |

### 项目结构

```
feishu-claude-bridge/
├── src/
│   ├── index.ts              # 入口文件
│   ├── feishu/               # 飞书集成
│   │   ├── bot.ts            # WebSocket 连接 & 消息收发
│   │   ├── card.ts           # 消息卡片模板
│   │   └── image.ts          # 图片下载处理
│   ├── claude/               # Claude Code 集成
│   │   └── bridge.ts         # Agent SDK 封装
│   ├── core/                 # 核心业务逻辑
│   │   ├── command.ts        # 命令解析器
│   │   ├── session.ts        # 会话管理器
│   │   └── router.ts         # 消息路由器
│   ├── db/                   # 数据库
│   │   └── database.ts       # SQLite 初始化 & CRUD
│   └── utils/                # 工具函数
│       ├── logger.ts         # 日志系统
│       └── config.ts         # 配置加载
├── data/                     # 数据文件（自动生成）
│   └── bridge.db             # SQLite 数据库
├── .env                      # 环境变量（需创建）
├── package.json
├── tsconfig.json
└── ecosystem.config.cjs      # PM2 配置
```

## 🔒 安全配置

### 权限模式说明

项目默认使用 `bypassPermissions` 模式（适合自动化场景）。如需更严格的控制：

**只读助手**（仅查询，不修改）：
```bash
/config allowed_tools Read,Glob,Grep
```

**禁用危险工具**：
```typescript
// 编辑 src/claude/bridge.ts
const queryOptions: Options = {
  // ...
  disallowedTools: ['Bash'],  // 禁用命令执行
};
```

**审计日志**：
```typescript
// 使用 PreToolUse Hook 记录所有工具调用
hooks: {
  PreToolUse: [{
    matcher: null,  // 匹配所有工具
    hooks: [async (input) => {
      logger.info('Tool execution', { tool: input });
      return { continue_: true };
    }]
  }]
}
```

### 访问控制

限制允许使用的飞书用户（可选）：
```bash
# .env
ALLOWED_USER_IDS=ou_xxx,ou_yyy
```

### 沙箱部署（推荐生产环境）

```bash
docker run \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  --network none \
  --user 1000:1000 \
  -v /path/to/workspace:/workspace:rw \
  feishu-claude-bridge
```

## 🐛 故障排查

### 1. 飞书连接失败

**症状**：启动后无法接收消息

**检查**：
```bash
# 验证 App ID 和 Secret
echo $FEISHU_APP_ID
echo $FEISHU_APP_SECRET

# 查看日志
pm2 logs feishu-claude-bridge
```

**解决**：
- 确认飞书应用已发布并通过审核
- 检查权限是否正确配置
- 确认 WebSocket 模式已启用

### 2. Claude API 报错

**症状**：执行任务时返回 401/403 错误

**检查**：
```bash
# 验证 API Key
echo $ANTHROPIC_API_KEY

# 测试 API 连接
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01"
```

**解决**：
- 确认 API Key 有效且未过期
- 检查账户余额是否充足
- 如使用第三方 API，检查 `ANTHROPIC_BASE_URL` 配置

### 3. 数据库错误

**症状**：无法保存项目或会话

**检查**：
```bash
# 检查数据库文件权限
ls -la data/bridge.db

# 查看数据库内容
sqlite3 data/bridge.db "SELECT * FROM projects;"
```

**解决**：
```bash
# 重建数据库
rm data/bridge.db
npm run dev  # 自动重新创建
```

### 4. 任务卡住不响应

**症状**：发送消息后无反馈

**检查**：
- 查看忙碌锁状态：`/status`
- 检查上一个任务是否完成

**解决**：
```bash
# 中止当前任务
/stop

# 或重启服务
pm2 restart feishu-claude-bridge
```

## 📊 性能优化

### 卡片更新频率

飞书卡片更新有频率限制（约 5 次/秒）。当前已做节流处理（800ms 间隔）。

### 数据库性能

SQLite 配置已优化：
- WAL 模式（并发读写）
- 内存缓存
- 同步模式 NORMAL

### 消息去重

自动处理飞书重试机制，避免重复执行任务。

## 🔄 更新日志

### v0.1.0-mvp (2026-03-06)

**核心功能**：
- ✅ 飞书 WebSocket 集成
- ✅ Claude Agent SDK 集成
- ✅ 多项目管理
- ✅ 会话持久化
- ✅ 命令系统（12+ 命令）
- ✅ 图片支持
- ✅ 流式卡片更新
- ✅ 消息去重
- ✅ 忙碌锁机制
- ✅ 费用追踪

**已知限制**：
- 单用户模式（无多租户隔离）
- WebSocket 模式（暂无 HTTP Webhook）
- 无交互式权限卡片（设计选择，适合自动化）

## 🤝 贡献指南

欢迎贡献代码、报告问题或提出建议！

### 开发流程

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 提交 Pull Request

### 运行测试

```bash
npm test              # 运行所有测试
npm run test:watch    # 监视模式
```

### 代码规范

- 使用 TypeScript strict 模式
- 遵循现有代码风格
- 添加单元测试覆盖新功能
- 更新文档

## 📄 许可证

[MIT License](LICENSE)

## 🙏 致谢

- [Anthropic Claude](https://www.anthropic.com/) - 提供强大的 AI 能力
- [飞书开放平台](https://open.feishu.cn/) - 企业协作平台
- [Claude Agent SDK](https://github.com/anthropics/anthropic-sdk-typescript) - 官方 SDK

## 📞 支持

- **问题反馈**：[GitHub Issues](https://github.com/cjj198909/feishu-claude-code/issues)
- **功能建议**：[GitHub Discussions](https://github.com/cjj198909/feishu-claude-code/discussions)

---

⚡ Built with ❤️ using [Claude Code Agent SDK](https://www.anthropic.com/claude-code)
