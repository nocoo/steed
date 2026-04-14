# 02 — D1 Schema 草案

## 设计原则

- D1 基于 SQLite，所有 SQL 必须兼容 SQLite 语法
- 主键统一使用 `TEXT` 类型的 UUID（由 Worker 生成）
- 时间字段统一使用 ISO 8601 格式的 `TEXT`
- 外键约束启用（`PRAGMA foreign_keys = ON`）
- 枚举值通过 `CHECK` 约束实现

## 表结构

### lanes

预置数据表，v1 固定三条线，不开放用户增删。

```sql
CREATE TABLE lanes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE  -- 'work' | 'life' | 'learning'
);

-- 预置数据
INSERT INTO lanes (id, name) VALUES
  ('lane_work', 'work'),
  ('lane_life', 'life'),
  ('lane_learning', 'learning');
```

### hosts

```sql
CREATE TABLE hosts (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,  -- bcrypt/sha256 哈希，不存明文
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT  -- 最近一次心跳时间，由快照上报更新
);
```

> **关于 api_key**：注册时生成明文 Key 返回给用户，数据库只存哈希。Worker 收到请求后对比哈希验证。

### agents

```sql
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,
  host_id         TEXT NOT NULL REFERENCES hosts(id),
  match_key       TEXT NOT NULL,      -- 扫描匹配用的稳定标识，注册时确定
  nickname        TEXT,               -- 人工：显示名称
  role            TEXT,               -- 人工：职责/角色描述
  lane_id         TEXT REFERENCES lanes(id),  -- 人工：业务线归属
  runtime_app     TEXT,               -- 扫描：宿主程序
  runtime_version TEXT,               -- 扫描：版本
  status          TEXT NOT NULL DEFAULT 'stopped'
                  CHECK (status IN ('running', 'stopped', 'missing')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT,               -- 扫描：最近一次被发现的时间

  UNIQUE (host_id, match_key)         -- 同一 Host 下 match_key 唯一
);

CREATE INDEX idx_agents_host_id ON agents(host_id);
CREATE INDEX idx_agents_lane_id ON agents(lane_id);
```

### data_sources

```sql
CREATE TABLE data_sources (
  id          TEXT PRIMARY KEY,
  host_id     TEXT NOT NULL REFERENCES hosts(id),
  type        TEXT NOT NULL
              CHECK (type IN ('personal_cli', 'third_party_cli', 'mcp')),
  name        TEXT NOT NULL,           -- 如 nmem、wrangler
  version     TEXT,                    -- 扫描：版本
  auth_status TEXT NOT NULL DEFAULT 'unknown'
              CHECK (auth_status IN ('authenticated', 'unauthenticated', 'unknown')),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'missing')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,                   -- 扫描：最近一次被发现的时间

  UNIQUE (host_id, type, name)         -- v1 产品约束：同 Host 下 (type, name) 唯一
);

CREATE INDEX idx_data_sources_host_id ON data_sources(host_id);
```

### data_source_lanes（多对多）

Data Source 可归属多个 Lane。

```sql
CREATE TABLE data_source_lanes (
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  lane_id        TEXT NOT NULL REFERENCES lanes(id),

  PRIMARY KEY (data_source_id, lane_id)
);
```

### agent_data_source_bindings（多对多）

Agent ↔ Data Source 的手工绑定关系，独立于 Lane 归属。

```sql
CREATE TABLE agent_data_source_bindings (
  agent_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),

  PRIMARY KEY (agent_id, data_source_id)
);
```

## 快照上报的 Worker 处理逻辑

```
收到 Host 快照 POST：
  1. 验证 api_key_hash → 确定 host_id
  2. 更新 hosts.last_seen_at
  3. 对快照中每个 Agent：
     - 以 (host_id, match_key) 查找已有记录
     - 存在 → UPDATE runtime_app, runtime_version, status='running', last_seen_at
     - 不存在 → 忽略（未注册的 Agent 不自动创建记录）
  4. 对快照中每个 Data Source：
     - 以 (host_id, type, name) 查找已有记录
     - 存在 → UPDATE version, auth_status, status='active', last_seen_at
     - 不存在 → INSERT 新记录，status='active'
  5. 对该 Host 下本次快照中未出现的 Agent：
     - UPDATE status='missing'（保留人工元数据）
  6. 对该 Host 下本次快照中未出现的 Data Source：
     - UPDATE status='missing'（保留人工元数据和 Lane 归属）
```

> **Agent 与 Data Source 的差异**：未注册的 Agent 不自动创建（身份由用户确认），而新发现的 Data Source 会自动创建（资源发现是自动化的）。

## v1 约束备忘

- Lane 表为预置数据，不提供 CRUD
- `api_key` 明文只在注册时返回一次，数据库存哈希
- Agent 记录只能通过注册（CLI `register` 或 Dashboard）创建，扫描不自动创建
- Data Source 记录可由扫描自动创建
- 不支持同一 Host 上同名 Data Source 多实例（v1 产品约束）
- 不做软删除，`missing` 状态已提供足够的缺失语义
