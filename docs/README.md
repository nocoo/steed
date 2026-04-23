# 文档目录

## 总览

| 编号 | 文档 | 说明 |
|------|------|------|
| 01 | [项目概述](./01-overview.md) | 要解决的问题、核心概念、模块定义 |
| 05 | [部署与本地 E2E 链路](./05-deployment.md) | Worker/D1 部署、Host 注册、Dashboard 本地运行 |
| 05 | [Pilot Validation](./05-pilot-validation.md) | 真实环境验证清单、Host Service 24h 试运行记录 |

## 架构

| 编号 | 文档 | 说明 |
|------|------|------|
| 01 | [系统架构总览](./architecture/01-system-overview.md) | 部署架构、技术选型、数据流、实体关系 |
| 02 | [D1 Schema 草案](./architecture/02-d1-schema.md) | 表结构、约束、快照处理逻辑 |
| 03 | [Worker API 草案](./architecture/03-worker-api.md) | 端点设计、认证、请求/响应格式 |
| 04 | [Dashboard 架构](./architecture/04-dashboard.md) | Dashboard Bootstrap、Google Auth、MVVM、6DQ |

## Features

| 编号 | 文档 | 说明 |
|------|------|------|
| 01 | [Phase B1: Agent Management](./features/01-phase-b1-agent-management.md) | Agent CRUD 端点 |
| 02 | [Phase B2: Data Source Management](./features/02-phase-b2-data-source-management.md) | Data Source + Bindings + Lanes 端点 |
| 03 | [Phase C1: Host Service](./features/03-phase-c1-host-service.md) | 常驻进程，心跳快照上报 |
| 04 | [Phase C2: CLI](./features/04-phase-c2-cli.md) | 命令行工具，手动操作 |
| 05 | [Phase D: Dashboard 写操作 UI](./features/05-phase-d-dashboard-write-ui.md) | Agent / Data Source 详情编辑 + Lane 分配 + Bindings 管理 |
| 06 | [Phase E: Lane 全景图谱](./features/06-phase-e-lane-map.md) | React Flow 三层拓扑图（已实现） |
| 07 | [Phase F: Vite Web on CF Worker + CF Access](./features/07-phase-f-vite-web-cf-access.md) | Dashboard 重写为 Vite SPA + CF Worker + CF Access；抽 packages/api |

> Features 子目录详细状态见 [features/README.md](./features/README.md)。
