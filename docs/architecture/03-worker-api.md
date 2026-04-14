# 03 — Worker API 草案

## 设计原则

- RESTful 风格，JSON 请求/响应
- 所有端点以 `/api/v1` 为前缀
- 认证通过 `Authorization: Bearer <api_key>` 头
- 三种角色：`admin`（Dashboard Server）、`host`（Host Service / Agent CLI）、`public`（无需认证）
- 错误响应统一格式：`{ "error": { "code": "string", "message": "string" } }`
- 时间字段统一使用 ISO 8601 格式

## 认证与权限

| 角色 | 凭证 | 权限范围 |
|------|------|---------|
| `admin` | 管理级 API Key（Dashboard Server 持有） | 全部读写 |
| `host` | Host API Key | 限该 Host 下的快照上报 + Agent 附加元数据 |
| `public` | 无 | 仅健康检查 |

## 端点总览

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| GET | `/api/v1/health` | public | 健康检查 |
| POST | `/api/v1/hosts/register` | admin | 注册新 Host，返回 API Key |
| GET | `/api/v1/hosts` | admin | 列出所有 Host |
| GET | `/api/v1/hosts/:id` | admin | 获取单个 Host 详情 |
| POST | `/api/v1/snapshot` | host | 上报 Host 资源快照（心跳） |
| GET | `/api/v1/agents` | admin | 列出所有 Agent（支持 host/lane 筛选） |
| GET | `/api/v1/agents/:id` | admin | 获取单个 Agent 详情 |
| POST | `/api/v1/agents` | admin, host | 注册新 Agent |
| PATCH | `/api/v1/agents/:id` | admin | 更新 Agent 人工元数据 |
| POST | `/api/v1/agents/:id/metadata` | host | Agent CLI 补充附加元数据 |
| GET | `/api/v1/data-sources` | admin | 列出所有 Data Source（支持 host/lane 筛选） |
| GET | `/api/v1/data-sources/:id` | admin | 获取单个 Data Source 详情 |
| PATCH | `/api/v1/data-sources/:id` | admin | 更新 Data Source 人工元数据 |
| PUT | `/api/v1/data-sources/:id/lanes` | admin | 设置 Data Source 的 Lane 归属（多选） |
| GET | `/api/v1/bindings` | admin | 列出所有 Agent ↔ Data Source 绑定 |
| POST | `/api/v1/bindings` | admin | 创建绑定 |
| DELETE | `/api/v1/bindings/:agent_id/:data_source_id` | admin | 删除绑定 |
| GET | `/api/v1/lanes` | admin | 列出所有 Lane |
| GET | `/api/v1/overview` | admin | 全局总览（Dashboard 首页用） |

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

注册新 Host。仅 admin 角色。

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
2. 对每个 Agent：以 `(host_id, match_key)` 匹配 → 存在则更新扫描字段 + status='running'；不存在则忽略（未注册不自动创建）
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

注册新 Agent。admin 或 host 角色。

host 角色只能在自己的 Host 下注册。

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

更新 Agent 人工元数据。仅 admin 角色。

**请求**（部分更新）：

```json
{
  "nickname": "小白 v2",
  "role": "全栈开发助手",
  "lane_id": "lane_work"
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

> v1 作为扩展能力预留，`extra` 字段以 JSON 存储，不影响主快照模型。

---

### PATCH /api/v1/data-sources/:id

更新 Data Source 人工元数据。仅 admin 角色。

**请求**：

```json
{
  "notes": "主力记忆系统"
}
```

---

### PUT /api/v1/data-sources/:id/lanes

设置 Data Source 的 Lane 归属。全量替换。仅 admin 角色。

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

创建 Agent ↔ Data Source 绑定。仅 admin 角色。

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

删除绑定。仅 admin 角色。

**响应 204**：无内容。

---

### GET /api/v1/overview

全局总览，Dashboard 首页用。仅 admin 角色。

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
