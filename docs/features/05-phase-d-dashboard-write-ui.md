# Phase D: Dashboard 写操作 UI

> 把 Phase B 已实现的写后端能力（Agent / Data Source / Binding / Lanes）暴露为 Dashboard 上的可视化操作。

## Overview

Phase B 已交付的 Worker 写端点目前在 Dashboard 完全没有入口。本期完成"读 → 整理 → 绑定"闭环：

1. **Agent 详情页** — 展示 + 编辑 `nickname` / `role` / `lane_id`
2. **Data Source 详情页** — 展示 + 编辑 `metadata`，多选 `lane_ids`（Work / Life / Learning）
3. **Bindings 管理** — 在 Agent 详情页里添加 / 移除 Agent ↔ Data Source 绑定

完成后，哥可以在 Dashboard 内独立完成所有"分类 + 绑定"操作，CLI 与 Host Service 不再是修改业务元数据的必经之路。

## 关键决策

| 维度 | 选择 | 理由 |
|------|------|------|
| 表单库 | `react-hook-form` + `zod` + shadcn `form.tsx` | 与 shadcn 官方约定一致；zod schema 可从 `@steed/shared` 的 `Update*Request` 派生 |
| Lane 选择器 | 自研 `LaneChips`（Toggle Chip 三选） | Lane 固定 3 个（Work / Life / Learning），无需 combobox |
| Toast | `sonner` | App Router 友好，单包简洁 |
| 保存策略 | refetch-after-save | v1 不做 optimistic UI，简化错误处理 |
| 列表→详情 | `<Link>` 包整行 | 无需修改 navigation.ts |
| 校验来源 | shared 类型 → zod | 单一事实源，避免 schema 漂移 |

## 后端依赖（已就绪）

| Worker 端点 | 来源 | 用途 |
|-------------|------|------|
| `GET /api/v1/agents/:id` | Phase B1 | Agent 详情 |
| `PATCH /api/v1/agents/:id` | Phase B1 | 编辑 nickname / role / lane_id / metadata |
| `GET /api/v1/data-sources/:id` | Phase B2 | Data Source 详情（含 lane_ids） |
| `PATCH /api/v1/data-sources/:id` | Phase B2 | 编辑 metadata |
| `PUT /api/v1/data-sources/:id/lanes` | Phase B2 | 全量替换 lane_ids |
| `GET /api/v1/lanes` | Phase B2 | 三个 Lane 列表（仅做兜底，前端 LANE_IDS 常量优先） |
| `GET /api/v1/bindings` | Phase B2 | 按 agent_id / data_source_id 过滤绑定 |
| `POST /api/v1/bindings` | Phase B2 | 创建绑定 |
| `DELETE /api/v1/bindings/:agent_id/:data_source_id` | Phase B2 | 删除绑定 |

本期 **不修改** Worker / D1 / Shared schema。

## 前端架构

```
┌─────────────────────────────────────────────────────────┐
│  app/(dashboard)/agents/[id]/page.tsx                   │
│  app/(dashboard)/data-sources/[id]/page.tsx             │
│  └── react-hook-form + zod + LaneChips + Sonner         │
└─────────────────────────────┬───────────────────────────┘
                              │ fetch /api/...
┌─────────────────────────────┴───────────────────────────┐
│  app/api/agents/[id]            GET / PATCH             │
│  app/api/data-sources/[id]      GET / PATCH             │
│  app/api/data-sources/[id]/lanes PUT                    │
│  app/api/bindings               GET / POST              │
│  app/api/bindings/[a]/[d]       DELETE                  │
└─────────────────────────────┬───────────────────────────┘
                              │ workerApi.* (server-only)
                              ▼
                        CF Worker → D1
```

ViewModel 模式延续 Phase C：`useState<{data, loading, error}>` + `useCallback` action + `useEffect` 拉取。

## API Design (BFF Layer)

### GET /api/agents/[id]

直接透传 Worker `GET /api/v1/agents/:id`。

**Response 200:** Full `AgentResponse`（见 Phase B1 文档）。

**Errors:** 401 / 404 / 500。

### PATCH /api/agents/[id]

透传 Worker `PATCH /api/v1/agents/:id`。

**Request:** `UpdateAgentRequest`（`nickname?`、`role?`、`lane_id?`、`metadata?`）。

**Response 200:** Full updated `AgentResponse`。

**Errors:** 400 / 401 / 404 / 500。

### GET /api/data-sources/[id]

透传 Worker `GET /api/v1/data-sources/:id`。

**Response 200:** `DataSourceWithLanes`（含 `lane_ids: LaneId[]`）。

### PATCH /api/data-sources/[id]

透传 Worker `PATCH /api/v1/data-sources/:id`。

**Request:** `UpdateDataSourceRequest`（`metadata?` shallow merge）。

### PUT /api/data-sources/[id]/lanes

透传 Worker `PUT /api/v1/data-sources/:id/lanes`。

**Request:** `SetLanesRequest` — `{ lane_ids: LaneId[] }`，全量替换。

**Response 200:** `SetLanesResponse` — `{ data_source_id, lane_ids }`。

### GET /api/bindings

透传 Worker `GET /api/v1/bindings`，支持 `?agent_id=` 或 `?data_source_id=` 过滤。

### POST /api/bindings

透传 Worker `POST /api/v1/bindings`。

**Request:** `CreateBindingRequest` — `{ agent_id, data_source_id }`。

### DELETE /api/bindings/[agent_id]/[data_source_id]

透传 Worker `DELETE /api/v1/bindings/:agent_id/:data_source_id`。

## UI 设计要点

### Agent 详情页（`/agents/[id]`）

布局自上而下：

1. **Header Card** — Host name、`match_key`、状态 Badge、`runtime_app/version`、时间戳
2. **Editable Fields Card**（react-hook-form）：
   - `nickname` — Input
   - `role` — Textarea
   - `lane_id` — `LaneChips`（单选模式，可清空）
   - 底部 "Save" 按钮 → submit → toast → refetch
3. **Bindings Card**（D-8 加入）：
   - 当前绑定列表（type/name + 解绑按钮）
   - "Add data source" 按钮 → Dialog（候选 = 该 Host 全部 DS − 已绑定）→ 单选 Confirm → POST → refetch

### Data Source 详情页（`/data-sources/[id]`）

1. **Header Card** — Host、type/name、version、auth_status、status、时间戳
2. **Lanes Card** — `LaneChips`（多选）+ "Save lanes" 按钮 → PUT → toast → refetch
3. **Metadata Card** — react-hook-form：
   - `metadata.notes` — Textarea
   - `metadata.tags` — Input（comma-separated，提交前 split + trim）
   - "Save metadata" 按钮 → PATCH → toast → refetch

两个表单独立提交，互不影响。

### LaneChips 组件

```ts
interface LaneChipsProps {
  value: LaneId | LaneId[] | null;
  mode: "single" | "multi";
  onChange: (next: LaneId | LaneId[] | null) => void;
  disabled?: boolean;
}
```

数据源 = `LANE_IDS` 常量（来自 `@steed/shared`）。点击切换：
- single：再点选中项 → null（清空）
- multi：toggle in/out

## Implementation

### Commit Plan

#### D-0：文档先行（本提交）

```
docs/features/05-phase-d-dashboard-write-ui.md  (本文件)
docs/features/README.md                          # 加 Phase D 区块
docs/README.md                                   # 索引补充
```

#### D-1：UI 原语 + 依赖

```
packages/dashboard/package.json
  + react-hook-form
  + zod
  + @hookform/resolvers
  + sonner
  + @radix-ui/react-dialog
  + @radix-ui/react-label

packages/dashboard/src/components/ui/
  + input.tsx
  + textarea.tsx
  + label.tsx
  + form.tsx        # shadcn 标准
  + dialog.tsx
  + lane-chips.tsx  # 自研
  + sonner.tsx      # Toaster 包装

packages/dashboard/src/app/(dashboard)/layout.tsx
  + 挂 <Toaster />

packages/dashboard/src/components/ui/__tests__/
  + lane-chips.test.tsx
```

**Tests:** LaneChips 单/多选切换、清空、disabled

---

#### D-2：worker-api 扩展 + zod schema

```
packages/dashboard/src/lib/worker-api.ts
  + agents.get(id), agents.update(id, body)
  + dataSources.get(id), dataSources.update(id, body), dataSources.setLanes(id, body)
  + bindings.list({agent_id?, data_source_id?})
  + bindings.create(body)
  + bindings.delete(agentId, dsId)

packages/dashboard/src/lib/schemas.ts
  + agentUpdateSchema   (zod)
  + dataSourceUpdateSchema
  + setLanesSchema
  + createBindingSchema
```

**对齐原则（避免前端 OK / Worker 400）：**

表单 zod schema 必须以 Worker 现行校验行为为准，重点：

- `lane_id` / `lane_ids[*]` — 用 `z.enum(LANE_IDS)`，禁止任意字符串；single 模式允许 `null` 表示清空
- `metadata` — `z.record(z.unknown())`，必须是 plain object（`null` / array 直接拒）
- `metadata.tags` — 提交前 `split(',').map(s => s.trim()).filter(Boolean)`；空数组合法，但每个元素非空
- `nickname` / `role` — 空字符串视为"清空"语义，提交时改 `null`（Worker 接收 null 即清字段）；trim 后超过约定长度由 schema 拒
- `agent_id` / `data_source_id` — 必填字符串，最小长度 1

**Tests:** schema 边界值
- 非法 LaneId（`work-misc` 等）→ reject
- `metadata = null` / `metadata = []` → reject
- `tags = "a, ,b,"` → 解析为 `["a","b"]`
- `nickname = ""` → 转 `null` 后通过
- 缺字段 / 全空对象 → 视为 no-op（PATCH 允许，但 UI 层禁用 Save 按钮）

---

#### D-3：BFF Routes — Agent 详情 + PATCH

```
packages/dashboard/src/app/api/agents/[id]/route.ts
  + GET   → workerApi.agents.get(id)
  + PATCH → 校验 body → workerApi.agents.update(id, body)

packages/dashboard/src/app/api/__tests__/agents-detail.test.ts
  - 401 unauth
  - 200 GET
  - 404 not found 透传
  - 200 PATCH 成功
  - 400 schema 校验失败
  - 500 wrap
```

**Tests:** 6+

---

#### D-4：Agent 详情页 + ViewModel

```
packages/dashboard/src/viewmodels/use-agent-detail-viewmodel.ts
  - state: { agent, loading, error }
  - actions: save(patch) → toast → refetch
  - exports: refetch

packages/dashboard/src/app/(dashboard)/agents/[id]/page.tsx
  - Header Card + Form Card
  - react-hook-form + zod resolver + LaneChips

packages/dashboard/src/app/(dashboard)/agents/page.tsx
  - 行包 <Link href={`/agents/${id}`}>

packages/dashboard/src/viewmodels/__tests__/use-agent-detail-viewmodel.test.ts
```

**Tests:** 加载 / 错误 / save 成功 → refetch / save 失败 → toast.error

---

#### D-5：BFF Routes — Data Source 详情 + Lanes

```
packages/dashboard/src/app/api/data-sources/[id]/route.ts
  + GET, PATCH

packages/dashboard/src/app/api/data-sources/[id]/lanes/route.ts
  + PUT

packages/dashboard/src/app/api/__tests__/data-sources-detail.test.ts
packages/dashboard/src/app/api/__tests__/data-sources-lanes.test.ts
```

**Tests:** 8+

---

#### D-6：Data Source 详情页 + ViewModel

```
packages/dashboard/src/viewmodels/use-data-source-detail-viewmodel.ts
  - state: { dataSource, loading, error }
  - actions: saveMetadata(patch), saveLanes(lane_ids)

packages/dashboard/src/app/(dashboard)/data-sources/[id]/page.tsx
  - Header Card + Lanes Card + Metadata Card

packages/dashboard/src/app/(dashboard)/data-sources/page.tsx
  - 行包 <Link>

packages/dashboard/src/viewmodels/__tests__/use-data-source-detail-viewmodel.test.ts
```

**Tests:** 加载 / saveMetadata / saveLanes / 错误路径

---

#### D-7：BFF Routes — Bindings

```
packages/dashboard/src/app/api/bindings/route.ts
  + GET (filter agent_id | data_source_id)
  + POST

packages/dashboard/src/app/api/bindings/[agent_id]/[data_source_id]/route.ts
  + DELETE

packages/dashboard/src/app/api/__tests__/bindings.test.ts
```

**Tests:** 6+

---

#### D-8：Agent 详情页 — Bindings 管理

**依赖的现有 BFF（不新增）：**
- 已绑定列表：`GET /api/bindings?agent_id=<id>`（D-7 提供）
- 该 Host 候选 DS：`GET /api/data-sources?host_id=<agent.host_id>`（Phase C 已提供）
- 候选 = `host_data_sources - bound_data_sources`，**过滤在 ViewModel 层做，不在 Worker 拉全量再前端 filter**

```
packages/dashboard/src/app/(dashboard)/agents/[id]/page.tsx
  + Bindings Card
  + Add Dialog (候选列表 = host_id 过滤后的 DS - 已绑定 ID 集)

packages/dashboard/src/viewmodels/use-agent-detail-viewmodel.ts
  + bindings 状态
  + hostDataSources 状态（首次打开 Add Dialog 时按需 fetch）
  + addBinding(dsId), removeBinding(dsId)
  + computed: candidateDataSources

packages/dashboard/src/viewmodels/__tests__/use-agent-detail-viewmodel.test.ts
  + bindings 用例
  + 候选过滤用例（已绑定的不出现在 Add Dialog）
```

**Tests:** add / remove / 候选过滤逻辑（hostDS - bound）

---

#### D-9：质量门禁 + E2E

```
# 在仓库根目录跑（与项目现行 scripts 对齐）：
bun run typecheck       # 根 tsc --noEmit
bun run lint            # 根 eslint --max-warnings=0 .
bun run test            # 根 vitest run --coverage + dashboard 子包测试
bun run check-coverage  # 覆盖率 ≥ 90%

scripts/run-e2e.ts
  + dashboard 写路径（沿用现有真 HTTP E2E 入口）：
    register agent → PATCH nickname → 验证
    set DS lanes → 验证
    POST binding → DELETE → 验证

bun run test:e2e        # 触发 scripts/run-e2e.ts

pre-commit / pre-push 全绿
wrangler deploy（按 CLAUDE.md "deploy first" 原则）
```

## Verification

### 本地

```bash
bun run --cwd packages/dashboard dev
# 浏览器登录后：
#   /agents/<id>   → 改 nickname / lane → toast 成功 → 列表回看一致
#   /data-sources/<id> → 切换 lane chips、改 notes/tags → 各自 toast → 一致
#   Agent 详情页 → 添加 binding → 解绑 → 再加 → toast 全成功
```

### 自动化

```bash
# 仓库根目录
bun run typecheck
bun run lint
bun run test           # 根 vitest + dashboard 子包；coverage 由 check-coverage 把关
bun run check-coverage # ≥ 90%
bun run test:e2e       # scripts/run-e2e.ts 真 HTTP，含 dashboard 写路径
```

### Pilot

部署 Worker（已就绪）+ Dashboard 后，到 `https://steed.hexly.ai`：
- 把 `hermes:main` agent 标到 `work` lane → D1 验证 `lane_id`
- 给 `claude` data source 加 `learning` lane → D1 验证 `data_source_lanes`
- 把 `hermes:main` 绑定到 `claude` → D1 验证 `bindings`

## Out of Scope

- 修改 Worker / D1 / Shared schema
- Agent 注册 UI（CLI 已能 `register`）
- Hosts 详情页 / API Key rotation
- 多用户 / 权限分级
- 实时刷新 / WebSocket
- Optimistic UI

## Progress

| Commit | Status |
|--------|--------|
| D-0: 文档先行 | ✅ Done |
| D-1: UI 原语 + 依赖 | ✅ Done |
| D-2: worker-api + zod schema | ✅ Done |
| D-3: BFF Agent 详情 + PATCH | ✅ Done |
| D-4: Agent 详情页 + ViewModel | ✅ Done |
| D-5: BFF Data Source 详情 + Lanes | ✅ Done |
| D-6: Data Source 详情页 + ViewModel | ✅ Done |
| D-7: BFF Bindings | ✅ Done |
| D-8: Bindings 管理 UI | 📝 Planned |
| D-9: 质量门禁 + E2E | 📝 Planned |
