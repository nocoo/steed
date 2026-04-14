# 01 — 系统架构总览

## 部署架构

```
┌─────────────────────────────────────┐
│        Dashboard (Railway)          │
│        Next.js — Web UI +           │
│        元数据管理                     │
└───────────────┬─────────────────────┘
                │ HTTPS (Server-side)
┌───────────────┴─────────────────────┐
│        CF Worker (API 层)           │
│        唯一数据库入口                 │
│        连接 D1                      │
└───────────────┬─────────────────────┘
                │ HTTPS
    ┌───────────┼───────────┐
    ▼           ▼           ▼
  Host A      Host B      Host C
 (Service     (Service     (Service
  + CLI)       + CLI)       + CLI)
```

### 设计要点

- Dashboard 部署在 Railway，**不直接连接数据库**
- CF Worker 是单一 API 网关，所有读写都经过 Worker
- D1 是唯一持久化存储
- 各 Host 上的 Host Service 通过 HTTPS 定时向 Worker 上报心跳快照

## Monorepo 结构

```
steed/
├── packages/
│   ├── dashboard/     # Next.js Web UI — Railway 部署
│   ├── worker/        # Cloudflare Worker + D1 — CF 部署
│   ├── cli/           # CLI + Host Service — 安装在各 Host
│   └── shared/        # 共享类型、常量、工具函数
├── docs/
├── CLAUDE.md
└── package.json       # Bun workspace root
```

## 技术选型

| 层 | 技术 | 说明 |
|----|------|------|
| 包管理 | Bun | Bun workspaces 管理 monorepo |
| 语言 | TypeScript | 全栈统一 |
| Dashboard | Next.js | 部署在 Railway |
| API | Cloudflare Workers | 轻量边缘计算 |
| 数据库 | Cloudflare D1 | SQLite 兼容，Worker 原生连接 |
| CLI + Host Service | TypeScript + Bun | 安装在各 Agent Host |

## 认证方案

| 场景 | 方式 | 说明 |
|------|------|------|
| Host Service → Worker | API Key | 每台 Host 注册时获取独立 Key |
| Agent CLI → Worker | Host API Key | 复用所在 Host 的 Key，权限限定为该 Host 下的 Agent 附加元数据写入 |
| Browser → Dashboard | 用户登录态 | 浏览器通过 Dashboard 的登录机制认证 |
| Dashboard Server → Worker | API Key | 服务端持有管理级 API Key |

所有来自 Dashboard 的 Worker 调用由 Next.js 服务端发起。Host Service 和 Agent CLI 使用同一 Host API Key 直连 Worker，但 Agent CLI 的权限范围仅限该 Host 下已注册 Agent 的附加元数据提交。

## 核心数据流

### 上报模型

v1 采用**心跳式快照模型**。Host Service 每 10 分钟向 Worker 上报一次当前 Host、Agent、Data Source 的全量资源快照，Worker 做幂等 upsert。暂不引入事件流和历史版本管理。

**缺失语义**：每次上报为全量快照。若某个 Agent 或 Data Source 在本次快照中未出现，Worker 将其 `status` 标记为 `missing`。记录本身不删除（保留用户填写的人工元数据），Dashboard 以 `missing` 状态区别展示。当后续快照中重新出现时，恢复为正常状态。

CLI 用于手动触发扫描、注册和补充操作。

### 上报通道

v1 默认以 Host 级资源快照为主通道。若某些 Agent 需要补充更细粒度的信息，可通过 Agent 侧 CLI 向 Worker 提交附加元数据；该能力属于增强能力，不影响主快照模型。

### 上报流程

```
Host Service (每 10 分钟)
    │
    ├─ 1. 扫描本机 Agent（runtime_app、runtime_version、运行状态）
    ├─ 2. 扫描本机 Data Source（版本、认证状态）— 只上报实际发现到的资源
    │
    └─ 3. HTTPS POST → CF Worker → D1（幂等 upsert）
```

### 查询与元数据管理流程

```
Browser → Dashboard (Next.js)
    │
    ├─ 1. Dashboard Server → HTTPS GET → CF Worker → D1（查询）
    ├─ 2. 按 Lane 分组展示 Agent 和 Data Source
    │      （Agent 为单 Lane 归属，Data Source 支持多 Lane 归属，
    │       同一 Data Source 可出现在多个 Lane 分组中）
    └─ 3. 人工分类、绑定关系、维护备注 → Dashboard Server → HTTPS PUT → CF Worker → D1
```

## 实体关系

```
Host (机器)
 ├── Agent (自主 Agent 实体)
 │    ├── belongs to → Lane (单选)
 │    ├── bound to → Data Source (手工绑定)
 │    ├── matched via → match_key (stable identifier)
 │    └── scanned: runtime_app, runtime_version, status
 └── Data Source (CLI / MCP 服务)
      ├── belongs to → Lane (多选，手工归属)
      ├── bound by → Agent (手工绑定，可多个)
      └── scanned: version, auth_status, status, last_seen_at
```

### 关键约束

- 一个 Host 属于一个用户（当前单用户系统）
- 一个 Host 上可有多个 Agent
- 一个 Host 上可有多个 Data Source
- Agent 归属一个 Lane，由用户在 Dashboard 手动标记
- Data Source 可归属多个 Lane，由用户在 Dashboard 手动标记
- Agent ↔ Data Source 的绑定关系由用户在 Dashboard 手动维护，独立于 Lane 归属
- Agent 的身份以用户确认/注册的管理对象为准，扫描结果补充运行环境和状态

## 核心字段模型

以下为 v1 最小字段建议，后续迭代可扩展。

### Host

| 字段 | 说明 |
|------|------|
| `id` | 唯一标识 |
| `name` | 机器名称 |
| `api_key` | 该 Host 的上报凭证 |
| `last_seen_at` | 最近一次心跳时间 |

### Agent

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | 系统 | 唯一标识 |
| `host_id` | 系统 | 所属 Host |
| `match_key` | 注册 | 扫描匹配用的稳定标识（注册时确定，扫描时携带回传） |
| `nickname` | 人工 | 用户定义的显示名称 |
| `role` | 人工 | 用户填写的职责/角色 |
| `lane_id` | 人工 | 归属的业务线 |
| `runtime_app` | 扫描 | 运行所依附的 Agent 系统/宿主程序 |
| `runtime_version` | 扫描 | 版本信息 |
| `status` | 扫描 | 运行状态（running / stopped / missing） |
| `last_seen_at` | 扫描 | 最近一次被扫描到的时间 |

### Data Source

> **唯一性约束**：同一 Host 下 `(type, name)` 必须唯一，Worker 以此作为幂等 upsert 的匹配键。v1 产品约束：不支持同一 Host 上同名 Data Source 的多实例（多账号、多配置、多个同类 MCP 实例）。若后续需支持多实例，需将匹配键扩展为 `(type, name, profile)` 或类似结构。

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | 系统 | 唯一标识 |
| `host_id` | 系统 | 所属 Host |
| `type` | 扫描 | 类型（personal_cli / third_party_cli / mcp） |
| `name` | 扫描 | 名称（如 nmem、wrangler）。与 type 联合构成匹配键 |
| `version` | 扫描 | 版本信息 |
| `auth_status` | 扫描 | 认证状态（authenticated / unauthenticated / unknown） |
| `status` | 扫描 | 当前状态（active / missing），缺失语义同 Agent |
| `last_seen_at` | 扫描 | 最近一次被扫描到的时间 |

### Data Source Lane（多对多）

| 字段 | 说明 |
|------|------|
| `data_source_id` | Data Source 标识 |
| `lane_id` | Lane 标识 |

### Agent ↔ Data Source Binding（多对多）

| 字段 | 说明 |
|------|------|
| `agent_id` | Agent 标识 |
| `data_source_id` | Data Source 标识 |
