# Phase E — Lane 全景图谱（Lane Map）

## 目标

Phase D 完成后，Dashboard 已有 Overview / Hosts / Agents / Data Sources 平铺列表，但用户无法看清三层实体之间的拓扑关系。本期新增 `/map` 页，用 React Flow 把 Hosts → Agents → DataSources 三层关系画出来，按 Lane 分色，支持筛选与节点详情跳转。

详细设计参考根任务 prompt（Phase E）。

## 关键决策

| 维度 | 选择 |
|------|------|
| 库 | `reactflow@^11` |
| 路由 | `/map`（独立菜单项 Map，Network 图标），Overview 不动 |
| 数据获取 | 单一 BFF `/api/map` 内部并发调用 5 个 list（`Promise.all`） |
| Layout | 自研三列分层算法，纯函数 |
| 状态 | useState + useMemo（与现有 ViewModel 模式一致） |
| 主题 | Tailwind + lane 调色：work=blue / life=green / learning=amber / unassigned=slate |
| SSR | `lane-map.tsx` 用 `dynamic(..., { ssr: false })` 避免 hydration |
| 测试策略 | 纯函数 100% 覆盖；React Flow 节点用 RTL 渲染 + role 断言 |

## 数据模型

`/api/map` 返回：
```ts
{
  hosts: HostWithStatus[],
  agents: AgentListItem[],
  data_sources: DataSourceWithLanes[],
  bindings: Binding[],
  lanes: Lane[],
}
```

> 注：DataSource list API 默认返回 `DataSourceListItem[]`（无 `lane_ids`）。本期 BFF 在并发拉取后，对每个 DS 顺序调一次 `dataSources.get(id)` 拿到 `lane_ids`（v1 节点量级 < 200，可接受）。后续优化方向：让 Worker `data-sources` list 直接带 `lane_ids`。

## 文件清单

**新增：**
- `packages/dashboard/src/app/api/map/route.ts` + `__tests__/map.test.ts`
- `packages/dashboard/src/lib/map-data.ts` + 单测
- `packages/dashboard/src/components/map/layout.ts` + 单测
- `packages/dashboard/src/components/map/lane-map.tsx`
- `packages/dashboard/src/components/map/nodes/{host,agent,data-source}-node.tsx`
- `packages/dashboard/src/components/map/{map-filters,map-legend,node-drawer}.tsx`
- `packages/dashboard/src/viewmodels/use-map-viewmodel.ts` + 单测
- `packages/dashboard/src/app/(dashboard)/map/page.tsx`

**修改：**
- `packages/dashboard/package.json` — 添加 `reactflow`
- `packages/dashboard/src/lib/navigation.ts` — 新增 Map 菜单项

## 原子 Commit 计划

| # | Commit | 描述 | Tests |
|---|--------|------|-------|
| E-0 | `docs(e-0): add Phase E lane-map plan` | 本文档 + 索引 | — |
| E-1 | `feat(dashboard): add E-1 reactflow dep + /api/map BFF` | 依赖 + 聚合端点 | ≥ 4 |
| E-2 | `feat(dashboard): add E-2 map-data + layout pure functions` | 数据转换 + 布局算法 | ≥ 8 |
| E-3 | `feat(dashboard): add E-3 React Flow nodes + container` | 节点组件 + lane-map 容器 | ≥ 6 |
| E-4 | `feat(dashboard): add E-4 map ViewModel + page + nav` | 页面骨架 + 菜单项 | ≥ 4 |
| E-5 | `feat(dashboard): add E-5 map filters + drawer + legend` | 交互层 | ≥ 6 |
| E-6 | `docs(phase-e): mark E-6 quality gates done` | 质量门禁 + 部署 | — |

## 验证

1. 本地 `bun run --cwd packages/dashboard dev` → `/map` 显示三列拓扑
2. `bun run typecheck && bun run lint && bun run test && bun run check-coverage`
3. 部署到 Railway，访问 `steed.hexly.ai/map`

## Out of Scope

- 修改 Worker / D1 / Shared schema
- 拖拽改 lane / WebSocket 实时刷新 / 节点位置持久化
- 大规模性能（> 500 节点）优化
- 移动端适配

## Progress

| Step | Status |
|------|--------|
| E-0 文档 | 📝 进行中 |
| E-1 BFF | ⏳ |
| E-2 纯函数 | ⏳ |
| E-3 节点组件 | ⏳ |
| E-4 ViewModel + 页面 | ⏳ |
| E-5 交互 | ⏳ |
| E-6 质量门禁 | ⏳ |
