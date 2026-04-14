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
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
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
  metadata        TEXT DEFAULT '{}',  -- 人工：JSON，扩展元数据（notes, tags 等）
  extra           TEXT DEFAULT '{}',  -- Agent CLI 补充的附加信息（JSON）
  runtime_app     TEXT,               -- 扫描：宿主程序
  runtime_version TEXT,               -- 扫描：版本
  status          TEXT NOT NULL DEFAULT 'stopped'
                  CHECK (status IN ('running', 'stopped', 'missing')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
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
  metadata    TEXT DEFAULT '{}',       -- 人工：JSON，扩展元数据（notes, tags 等）
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
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

> **跨 Host 限制**：v1 禁止跨 Host 绑定。Agent 只能绑定同一 Host 下的 Data Source。该约束由 Worker API 层校验（SQLite 不便表达跨表条件 CHECK）。

```sql
CREATE TABLE agent_data_source_bindings (
  agent_id       TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

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
     - 存在 → UPDATE runtime_app, runtime_version, status=快照上报的 status, last_seen_at
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
- Agent 和 Data Source 均有 `metadata` TEXT (JSON) 列，用于人工扩展元数据（notes, tags 等）
- Agent 额外有 `extra` TEXT (JSON) 列，用于 Agent CLI 补充附加信息
- 绑定关系禁止跨 Host，由 Worker API 层校验
- 快照中 Agent 的 `status` 由 Host Service 实际采集上报（running / stopped），Worker 原样写入；缺失时由 Worker 标记 `missing`
- 时间字段统一使用 `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` 确保 ISO 8601 格式

## 实现步骤（原子化提交计划）

### 前置：Monorepo 基础设施 + 6DQ 门禁

> 以下步骤在 Worker 实现之前完成，为整个项目建立质量基线。

**Commit 1: 初始化 Bun workspace monorepo**

```
创建 package.json (workspace root)
创建 packages/worker/package.json
创建 packages/shared/package.json
创建 packages/dashboard/package.json
创建 packages/cli/package.json
bun install 验证 workspace 联通
```

**Commit 2: 配置 G1 — TypeScript strict + ESLint strict**

```
packages/shared/tsconfig.json — strict: true, noUncheckedIndexedAccess: true
packages/worker/tsconfig.json — extends shared, 适配 CF Worker
根目录 eslint.config.ts — tseslint.configs.strict + --max-warnings=0
根目录 .editorconfig
验证：tsc --noEmit 通过，eslint 零警告
```

**Commit 3: 配置 L1 — vitest + 覆盖率门控**

```
根目录 vitest.workspace.ts — monorepo 多包配置
packages/shared/vitest.config.ts
packages/worker/vitest.config.ts
scripts/check-coverage.ts — 覆盖率 ≥ 90% 门控脚本
创建第一个占位测试确保 vitest 跑通
验证：bun run test 通过，覆盖率检查通过
```

**Commit 4: 配置 Husky pre-commit hook (G1 + L1)**

```
bun add -d husky
bunx husky init
.husky/pre-commit — 并行执行：
  G1: tsc --noEmit && eslint --max-warnings=0
  L1: vitest run && check-coverage
验证：git commit 触发 hook，全部通过
```

### Worker D1 Migration 实现

**Commit 5: 创建 D1 migration — lanes + hosts 表**

```
packages/worker/migrations/0001_create_lanes_and_hosts.sql
包含 lanes 预置数据 INSERT
包含 hosts 表
测试：vitest 验证 SQL 语法正确性（解析验证）
```

**Commit 6: 创建 D1 migration — agents 表**

```
packages/worker/migrations/0002_create_agents.sql
包含 UNIQUE (host_id, match_key) 约束
包含 CHECK 约束和索引
测试：vitest 验证 SQL 语法 + 约束行为
```

**Commit 7: 创建 D1 migration — data_sources 表**

```
packages/worker/migrations/0003_create_data_sources.sql
包含 UNIQUE (host_id, type, name) 约束
包含 CHECK 约束和索引
测试：vitest 验证 SQL 语法 + 约束行为
```

**Commit 8: 创建 D1 migration — 关系表**

```
packages/worker/migrations/0004_create_relations.sql
包含 data_source_lanes 和 agent_data_source_bindings
包含 ON DELETE CASCADE
测试：vitest 验证级联删除行为
```

**Commit 9: shared 包 — 共享类型定义**

```
packages/shared/src/types/host.ts
packages/shared/src/types/agent.ts
packages/shared/src/types/data-source.ts
packages/shared/src/types/lane.ts
packages/shared/src/types/binding.ts
packages/shared/src/types/snapshot.ts — 快照上报 payload 类型
packages/shared/src/index.ts — barrel export
测试：类型编译验证
```

### 6DQ 质量维度规划

本项目 6DQ 维度映射：

| 维度 | 工具 | 运行时机 | 目标 |
|------|------|---------|------|
| L1 | vitest + check-coverage ≥ 90% | pre-commit | 单元测试 |
| L2 | 自定义 run-e2e.ts，真 HTTP 调用 Worker | pre-push | 100% API 端点覆盖 |
| L3 | Playwright | 按需 | Dashboard 核心流程 |
| G1 | tsc --noEmit (strict) + ESLint strict --max-warnings=0 | pre-commit | 静态分析 |
| G2 | osv-scanner + gitleaks | pre-push | 安全扫描 |
| D1 | steed-db-test 独立 D1 实例 + _test_marker 三重验证 | pre-push (L2) | 测试隔离 |

Hooks 映射：
- pre-commit (<30s): G1 ‖ L1
- pre-push (<3min): L2 ‖ G2（L2 连接 steed-db-test 隔离实例）
- 按需: L3

## Phase A 验收标准

Phase A（Worker + D1 MVP 闭环）完成后，以下场景必须全部通过：

1. **Host 注册与持久化**：POST /hosts/register 创建 Host，返回明文 API Key；数据库仅存哈希；GET /hosts 和 GET /hosts/:id 返回正确数据
2. **快照上报认证**：使用 Host API Key 成功调用 POST /snapshot；无效 Key 返回 401
3. **Agent 快照更新**：已注册 Agent 按 `(host_id, match_key)` 匹配更新 runtime_app / runtime_version / status / last_seen_at；未注册 Agent 被忽略，不自动创建（测试通过夹具直接 seed D1 准备已注册 Agent）
4. **Data Source 快照更新**：已有 Data Source 按 `(host_id, type, name)` 匹配更新；新发现 Data Source 自动创建，status='active'
5. **缺失标记**：该 Host 下本次快照中未出现的已注册 Agent → status='missing'；未出现的 Data Source → status='missing'；后续快照中重新出现 → 恢复正常状态
6. **Host 在线状态**：GET /hosts 返回动态计算的 online/offline 状态（last_seen_at 15 分钟阈值）
7. **全局总览聚合**：GET /overview 返回 hosts / agents / data_sources 的正确统计数值
8. **L2 E2E 跑通**：pre-push hook 触发 E2E 测试，覆盖 health / hosts/register / snapshot / hosts / overview 五个端点

## Phase B 验收标准

Phase B 分为 B1（Agent 管理）和 B2（Data Source + Binding 管理）两个子阶段。

### Phase B1 验收标准

1. **Agent 注册**：POST /agents 支持 dashboard 和 host 角色；host 角色自动绑定当前 Host，忽略 body.host_id；重复 `(host_id, match_key)` 返回 409
2. **Agent 列表**：GET /agents 支持 host_id / lane_id / status 筛选及游标分页
3. **Agent 详情**：GET /agents/:id 返回完整 Agent 对象（含 metadata / extra JSON）
4. **Agent 元数据更新**：PATCH /agents/:id 支持 nickname / role / lane_id / metadata 更新；metadata 采用 shallow merge；非法 lane_id 返回 400
5. **L2 E2E 跑通**：E2E 测试覆盖 Agent 完整生命周期（注册 → 列表 → 详情 → 更新）

### Phase B2 验收标准

1. **Data Source 列表与详情**：GET /data-sources 支持 host_id / lane_id / status 筛选；GET /data-sources/:id 返回完整对象
2. **Data Source 元数据更新**：PATCH /data-sources/:id 支持 metadata shallow merge
3. **Data Source Lane 归属**：PUT /data-sources/:id/lanes 全量替换 data_source_lanes 记录；非法 lane_id 返回 400
4. **Binding CRUD**：POST /bindings 创建绑定；GET /bindings 列出绑定（支持 agent_id / data_source_id 筛选）；DELETE /bindings/:agent_id/:data_source_id 删除绑定
5. **跨 Host 校验**：绑定创建时校验 Agent 和 Data Source 属于同一 Host，否则返回 403
6. **L2 E2E 跑通**：E2E 测试覆盖 Data Source 管理 + Binding 完整生命周期
