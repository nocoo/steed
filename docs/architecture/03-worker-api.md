# 03 — Worker API 草案

## 设计原则

- RESTful 风格，JSON 请求/响应
- 所有端点以 `/api/v1` 为前缀
- 认证通过 `Authorization: Bearer <token>` 头
- 三种角色：`dashboard`（Dashboard Server，持有内部 Service Token）、`host`（Host Service / Agent CLI，持有 Host API Key）、`public`（无需认证）
- **两层认证原则**：Google OAuth 登录只发生在 Dashboard 端；Worker 不直接处理 Google 身份认证，仅识别内部 Service Token 和 Host API Key
- 错误响应统一格式：`{ "error": { "code": "string", "message": "string" } }`
- 时间字段统一使用 ISO 8601 格式

## 认证与权限

| 角色 | 凭证 | 权限范围 |
|------|------|---------|
| `dashboard` | `DASHBOARD_SERVICE_TOKEN`（环境变量，Dashboard Server 持有） | 全部读写（代表已通过 Google OAuth 的管理员） |
| `host` | Host API Key（注册时生成，数据库存哈希） | 限该 Host 下的快照上报 + Agent 附加元数据 |
| `public` | 无 | 仅健康检查 |

> **认证架构说明**：用户通过 Google Account（白名单）登录 Dashboard；Dashboard 验证身份后，以内部 `DASHBOARD_SERVICE_TOKEN` 代理调用 Worker。Worker 不感知 Google 身份，只校验 Service Token 的合法性。该 Token 作为 CF Worker 环境变量配置，不存入 D1。

## 端点总览

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/v1/health` | public | 健康检查 |
| POST | `/api/v1/hosts/register` | dashboard | 注册新 Host，返回 API Key |
| GET | `/api/v1/hosts` | dashboard | 列出所有 Host |
| GET | `/api/v1/hosts/:id` | dashboard | 获取单个 Host 详情 |
| POST | `/api/v1/snapshot` | host | 上报 Host 资源快照（心跳） |
| GET | `/api/v1/agents` | dashboard | 列出所有 Agent（支持 host/lane 筛选） |
| GET | `/api/v1/agents/:id` | dashboard | 获取单个 Agent 详情 |
| POST | `/api/v1/agents` | dashboard, host | 注册新 Agent |
| PATCH | `/api/v1/agents/:id` | dashboard | 更新 Agent 人工元数据 |
| POST | `/api/v1/agents/:id/metadata` | host | Agent CLI 补充附加元数据 |
| GET | `/api/v1/data-sources` | dashboard | 列出所有 Data Source（支持 host/lane 筛选） |
| GET | `/api/v1/data-sources/:id` | dashboard | 获取单个 Data Source 详情 |
| PATCH | `/api/v1/data-sources/:id` | dashboard | 更新 Data Source 人工元数据 |
| PUT | `/api/v1/data-sources/:id/lanes` | dashboard | 设置 Data Source 的 Lane 归属（多选） |
| GET | `/api/v1/bindings` | dashboard | 列出所有 Agent ↔ Data Source 绑定 |
| POST | `/api/v1/bindings` | dashboard | 创建绑定 |
| DELETE | `/api/v1/bindings/:agent_id/:data_source_id` | dashboard | 删除绑定 |
| GET | `/api/v1/lanes` | dashboard | 列出所有 Lane |
| GET | `/api/v1/overview` | dashboard | 全局总览（Dashboard 首页用） |

## 端点详细设计

### GET /api/v1/health

无需认证。返回 Worker 状态。

**响应 200**：

```json
{
  "status": "ok",
  "timestamp": "2026-04-14T12:00:00Z"
}
```

---

### POST /api/v1/hosts/register

注册新 Host。仅 dashboard 角色。

**请求**：

```json
{
  "name": "us-vps-01"
}
```

**响应 201**：

```json
{
  "id": "host_xxxxx",
  "name": "us-vps-01",
  "api_key": "sk_host_xxxxxxxxxxxxxxxx"
}
```

> `api_key` 明文只返回这一次，数据库存哈希。

---

### POST /api/v1/snapshot

Host Service 心跳上报。每 10 分钟一次全量快照。

**认证**：host 角色（Host API Key）

**请求**：

```json
{
  "agents": [
    {
      "match_key": "openclaw:/home/agent/workspace",
      "runtime_app": "openclaw",
      "runtime_version": "0.3.2",
      "status": "running"
    }
  ],
  "data_sources": [
    {
      "type": "personal_cli",
      "name": "nmem",
      "version": "1.2.0",
      "auth_status": "authenticated"
    },
    {
      "type": "third_party_cli",
      "name": "wrangler",
      "version": "3.50.0",
      "auth_status": "authenticated"
    }
  ]
}
```

**Worker 处理逻辑**：

1. 从 API Key 确定 `host_id`，更新 `hosts.last_seen_at`
2. 对每个 Agent：以 `(host_id, match_key)` 匹配 → 存在则更新扫描字段，status 取快照上报值（running / stopped）；不存在则忽略（未注册不自动创建）
3. 对每个 Data Source：以 `(host_id, type, name)` 匹配 → 存在则更新；不存在则 INSERT
4. 该 Host 下本次未出现的 Agent → status='missing'
5. 该 Host 下本次未出现的 Data Source → status='missing'

**响应 200**：

```json
{
  "host_id": "host_xxxxx",
  "agents_updated": 1,
  "agents_missing": 0,
  "data_sources_updated": 2,
  "data_sources_created": 0,
  "data_sources_missing": 0
}
```

---

### POST /api/v1/agents

注册新 Agent。dashboard 或 host 角色。

- **host 角色**：忽略请求体中的 `host_id`，直接使用认证上下文中的 `host_id`（防止越权）
- **dashboard 角色**：使用请求体中的 `host_id`（必填）

**请求**：

```json
{
  "host_id": "host_xxxxx",
  "match_key": "openclaw:/home/agent/workspace",
  "nickname": "小白",
  "role": "代码审查和自动修复"
}
```

**响应 201**：

```json
{
  "id": "agent_xxxxx",
  "host_id": "host_xxxxx",
  "match_key": "openclaw:/home/agent/workspace",
  "nickname": "小白",
  "role": "代码审查和自动修复",
  "status": "stopped"
}
```

---

### PATCH /api/v1/agents/:id

更新 Agent 人工元数据。仅 dashboard 角色。

**请求**（部分更新）：

`nickname`、`role`、`lane_id` 为直接字段更新；`metadata` 写入 `agents.metadata` JSON 列（shallow merge）。

```json
{
  "nickname": "小白 v2",
  "role": "全栈开发助手",
  "lane_id": "lane_work",
  "metadata": {
    "notes": "主力开发 Agent",
    "tags": ["dev", "primary"]
  }
}
```

**响应 200**：完整 Agent 对象。

---

### POST /api/v1/agents/:id/metadata

Agent CLI 补充附加元数据。host 角色，限该 Host 下已注册 Agent。

**请求**：

```json
{
  "extra": {
    "memory_count": 42,
    "last_task": "review PR #128"
  }
}
```

**响应 200**：

```json
{
  "id": "agent_xxxxx",
  "extra_updated": true
}
```

> v1 作为扩展能力预留。写入 `agents.extra` JSON 列，传入的对象与已有 JSON 做 shallow merge，不影响主快照模型。

---

### PATCH /api/v1/data-sources/:id

更新 Data Source 人工元数据。仅 dashboard 角色。

写入 `data_sources.metadata` JSON 列。传入的 `metadata` 对象与已有 JSON 做 shallow merge。

**请求**：

```json
{
  "metadata": {
    "notes": "主力记忆系统",
    "tags": ["core", "memory"]
  }
}
```

---

### PUT /api/v1/data-sources/:id/lanes

设置 Data Source 的 Lane 归属。全量替换。仅 dashboard 角色。

**请求**：

```json
{
  "lane_ids": ["lane_work", "lane_learning"]
}
```

**响应 200**：

```json
{
  "data_source_id": "ds_xxxxx",
  "lane_ids": ["lane_work", "lane_learning"]
}
```

---

### POST /api/v1/bindings

创建 Agent ↔ Data Source 绑定。仅 dashboard 角色。

> **跨 Host 限制**：Worker 校验 Agent 和 Data Source 必须属于同一 Host，否则返回 `403 forbidden`。

**请求**：

```json
{
  "agent_id": "agent_xxxxx",
  "data_source_id": "ds_xxxxx"
}
```

**响应 201**：

```json
{
  "agent_id": "agent_xxxxx",
  "data_source_id": "ds_xxxxx",
  "created_at": "2026-04-14T12:00:00Z"
}
```

---

### DELETE /api/v1/bindings/:agent_id/:data_source_id

删除绑定。仅 dashboard 角色。

**响应 204**：无内容。

---

### GET /api/v1/overview

全局总览，Dashboard 首页用。仅 dashboard 角色。

**响应 200**：

```json
{
  "hosts": {
    "total": 3,
    "online": 2,
    "offline": 1
  },
  "agents": {
    "total": 5,
    "running": 3,
    "stopped": 1,
    "missing": 1,
    "by_lane": {
      "work": 2,
      "life": 1,
      "learning": 1,
      "unassigned": 1
    }
  },
  "data_sources": {
    "total": 8,
    "active": 7,
    "missing": 1
  }
}
```

## 筛选与分页约定

列表端点统一支持以下查询参数：

| 参数 | 说明 | 示例 |
|------|------|------|
| `host_id` | 按 Host 筛选 | `?host_id=host_xxxxx` |
| `lane_id` | 按 Lane 筛选 | `?lane_id=lane_work` |
| `status` | 按状态筛选 | `?status=running` |
| `limit` | 每页数量，默认 50，最大 200 | `?limit=20` |
| `cursor` | 游标分页 | `?cursor=xxxxx` |

## 错误码约定

| HTTP 状态 | code | 场景 |
|-----------|------|------|
| 400 | `invalid_request` | 请求体格式错误 |
| 401 | `unauthorized` | 缺少或无效的 API Key |
| 403 | `forbidden` | 权限不足（如 host 角色访问其他 Host 的数据） |
| 404 | `not_found` | 资源不存在 |
| 409 | `conflict` | 唯一约束冲突（如重复 match_key） |
| 500 | `internal_error` | 服务端错误 |

## Host 在线/离线判定

Worker 根据 `hosts.last_seen_at` 判定 Host 在线状态：

- `last_seen_at` 在最近 15 分钟内 → `online`（心跳周期 10 分钟 + 5 分钟容差）
- 超过 15 分钟 → `offline`

该判定为查询时动态计算，不持久化。

## 实现步骤（原子化提交计划）

> 前置条件：Monorepo 基础设施 + 6DQ 门禁 + D1 migration 已完成（见 02-d1-schema.md）。

### Dashboard 端认证（前置设计，实现在 Dashboard 包）

> Worker 实现不依赖以下步骤，但需理解认证架构全貌。

Dashboard 采用 Google OAuth 白名单单用户认证：

1. **Google OAuth**：Next.js 集成 Google OAuth，登录后获取 Google 用户信息
2. **白名单校验**：将 Google Account ID / Email 与环境变量中的白名单比对，不匹配则拒绝
3. **会话管理**：通过 Next.js session（cookie）维护登录态
4. **代理调用**：Dashboard Server 端持有 `DASHBOARD_SERVICE_TOKEN`，所有对 Worker 的调用附加 `Authorization: Bearer <DASHBOARD_SERVICE_TOKEN>`

> D1 不存储管理员账号信息。白名单配置在 Dashboard 的环境变量中（如 `ALLOWED_GOOGLE_EMAILS`）。

### Worker 路由框架

**Commit 10: Worker 骨架 + Hono 路由框架**

```
packages/worker/src/index.ts — Hono app 入口
packages/worker/src/env.ts — D1 binding 类型定义
packages/worker/wrangler.toml — D1 binding 配置
packages/worker/src/middleware/auth.ts — API Key 认证中间件骨架
packages/worker/src/lib/response.ts — 统一响应/错误格式工具
测试：vitest 验证 Hono app 初始化 + 健康检查端点
```

**Commit 11: 认证中间件实现**

```
packages/worker/src/middleware/auth.ts — 完整实现：
  - 从 Authorization header 提取 Bearer token
  - 优先匹配 DASHBOARD_SERVICE_TOKEN 环境变量 → 角色 dashboard
  - 否则校验 Host API Key 与 hosts.api_key_hash 是否匹配 → 确定 host_id，角色 host
  - 均不匹配 → 401 unauthorized
  - 注入角色和 host_id（若 host）到请求上下文
packages/worker/src/middleware/auth.test.ts
测试：vitest 验证 dashboard token + host key + 无效 token + 缺失 header
```

### Host 管理端点

**Commit 12: POST /hosts/register + GET /hosts**

```
packages/worker/src/routes/hosts.ts
  - POST /hosts/register: 生成 UUID + API Key，存哈希，返回明文
  - GET /hosts: 列出全部 Host，含动态 online/offline 状态
packages/worker/src/routes/hosts.test.ts
测试：vitest 验证注册流程 + Key 哈希 + 列表查询 + 在线状态计算
```

**Commit 13: GET /hosts/:id**

```
packages/worker/src/routes/hosts.ts — 追加详情端点
测试：vitest 验证正常查询 + 404
```

### 快照上报端点

**Commit 14: POST /snapshot — Agent upsert 逻辑**

```
packages/worker/src/routes/snapshot.ts
  - 验证 host key → 确定 host_id
  - 更新 hosts.last_seen_at
  - Agent: 以 (host_id, match_key) 匹配 → 更新扫描字段
  - Agent: 未注册忽略
  - Agent: 未出现 → status='missing'
packages/worker/src/routes/snapshot.test.ts
测试（TDD 先写）：
  - 已注册 Agent 正常更新 (running / stopped)
  - 未注册 Agent 忽略
  - 已注册 Agent 未出现 → missing
  - 重新出现 → 恢复状态
```

**Commit 15: POST /snapshot — Data Source upsert 逻辑**

```
packages/worker/src/routes/snapshot.ts — 追加 Data Source 处理
  - 以 (host_id, type, name) 匹配
  - 存在 → UPDATE
  - 不存在 → INSERT
  - 未出现 → status='missing'
packages/worker/src/routes/snapshot.test.ts — 追加
测试（TDD 先写）：
  - 已有 Data Source 更新
  - 新发现 Data Source 自动创建
  - Data Source 消失 → missing
  - 重新发现 → active
```

### Agent CRUD 端点

**Commit 16: POST /agents + GET /agents**

```
packages/worker/src/routes/agents.ts
  - POST: 注册新 Agent (dashboard + host 角色)
    host 角色：忽略请求体中的 host_id，直接使用认证上下文中的 host_id
    dashboard 角色：使用请求体中的 host_id（必填）
  - GET: 列表，支持 host_id / lane_id / status 筛选 + 游标分页
测试：vitest 验证注册 + match_key 唯一冲突 409 + 列表筛选 + host 角色 host_id 覆盖
```

**Commit 17: GET /agents/:id + PATCH /agents/:id**

```
packages/worker/src/routes/agents.ts — 追加
  - GET: 详情
  - PATCH: 更新人工元数据 (nickname, role, lane_id, metadata shallow merge)
测试：vitest 验证详情 + 404 + 元数据更新 + metadata merge
```

**Commit 18: POST /agents/:id/metadata**

```
packages/worker/src/routes/agents.ts — 追加 Agent CLI 附加元数据端点
  - host 角色，校验 Agent 属于该 Host
  - extra JSON shallow merge
测试：vitest 验证写入 + 权限校验
```

### Data Source CRUD 端点

**Commit 19: GET /data-sources + GET /data-sources/:id**

```
packages/worker/src/routes/data-sources.ts
  - GET 列表：支持 host_id / lane_id / status 筛选 + 游标分页
  - GET 详情
测试：vitest 验证列表 + 筛选 + 详情 + 404
```

**Commit 20: PATCH /data-sources/:id + PUT /data-sources/:id/lanes**

```
packages/worker/src/routes/data-sources.ts — 追加
  - PATCH: metadata JSON shallow merge
  - PUT lanes: 全量替换 data_source_lanes
测试：vitest 验证 metadata merge + lanes 替换（增删改）
```

### 绑定关系端点

**Commit 21: bindings CRUD**

```
packages/worker/src/routes/bindings.ts
  - GET: 列出全部绑定
  - POST: 创建绑定（含跨 Host 校验 → 403）
  - DELETE: 删除绑定
测试（TDD 先写）：
  - 正常绑定创建
  - 跨 Host 绑定 → 403
  - 重复绑定 → 409
  - 删除 + 204
```

### 全局总览端点

**Commit 22: GET /overview + GET /lanes**

```
packages/worker/src/routes/overview.ts
  - 聚合查询：hosts total/online/offline, agents by status/lane, data_sources by status
packages/worker/src/routes/lanes.ts
  - 返回预置 Lane 列表
测试：vitest 验证聚合数值正确性
```

### L2 集成测试基础

**Commit 23: L2 E2E 测试框架 + Husky pre-push hook**

```
packages/worker/test/e2e/run-e2e.ts — 自动启停 wrangler dev + 真 HTTP
packages/worker/test/e2e/setup.ts — 测试库初始化 + 隔离验证 (steed-db-test)：
  1. DROP 所有已有表（reset 清空）
  2. 按序执行全部 migrations（0001~0004）
  3. 校验 lanes seed 数据存在（3 条预置行）
  4. 写入 _test_marker 行，验证确实连接的是 steed-db-test 而非生产库
.husky/pre-push — 并行执行：
  L2: bun run test:e2e
  G2: osv-scanner + gitleaks
wrangler.toml [env.test] — 绑定 steed-db-test
验证：pre-push hook 触发，L2 跑通至少 health check E2E
```
