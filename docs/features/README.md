# Features 文档目录

## 状态说明

| 状态 | 含义 |
|------|------|
| 📝 设计完成 | 文档已写完，代码未开始 |
| 🔨 代码完成 | 代码已实现，本地测试通过 |
| ✅ 已验证 | 代码 + 本地测试 + E2E 测试通过 |
| 🚀 生产验证 | 已部署到真实环境并验证 |

## Phase B: 管理能力

| 编号 | 文档 | 说明 | 状态 |
|------|------|------|------|
| 01 | [Phase B1: Agent Management](./01-phase-b1-agent-management.md) | Agent CRUD 端点 | ✅ 已验证 |
| 02 | [Phase B2: Data Source Management](./02-phase-b2-data-source-management.md) | Data Source + Bindings + Lanes 端点 | ✅ 已验证 |

## Phase C: CLI + Host Service

| 编号 | 文档 | 说明 | 状态 |
|------|------|------|------|
| 03 | [Phase C1: Host Service](./03-phase-c1-host-service.md) | 常驻进程，心跳快照上报 | ✅ 已验证 |
| 04 | [Phase C2: CLI](./04-phase-c2-cli.md) | 命令行工具，手动操作 | ✅ 已验证 |

## Phase D: Dashboard 写操作 UI

| 编号 | 文档 | 说明 | 状态 |
|------|------|------|------|
| 05 | [Phase D: Dashboard 写操作 UI](./05-phase-d-dashboard-write-ui.md) | Agent / Data Source 详情编辑 + Lane 分配 + Bindings 管理 | 📝 设计完成 |

## 未归档功能

以下功能已实现但尚未写入正式文档：

| 功能 | 说明 | 状态 |
|------|------|------|
| CLI OAuth Login | `steed login` 命令，通过浏览器 OAuth 登录 Dashboard 并自动获取 API Key | 🔨 代码完成 |
