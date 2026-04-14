# 01 — 项目概述

## 要解决的问题

在大规模 AI Agent 时代，一个人可能在不同的机器上运营许多不同的 Agent。这些 Agent 相互之间的 Memory 和连接的数据源各不相同。同时还有很多自行开发的数据源工具，它们可能各自连接到某些机器上的某个 Agent。

要记录这些东西并获得一个全局图景，心智成本非常高。

Steed 要解决的核心问题就是：**降低在多 Agent 时代管理诸多 Agent 的心智成本**。

Steed 是一个面向单用户、多 Host 的 Agent 资产可见性与关系管理平台。v1 只负责资源盘点、状态展示、人工分类与人工绑定，不负责远程控制。

## 一期目标与非目标

### 目标

- 查看所有 Host、Agent、Data Source 的当前状态
- 人工完成 Lane 分类（给 Agent 标记业务线归属，给 Data Source 标记一个或多个业务线归属）
- 人工完成 Agent ↔ Data Source 的绑定关系
- 提供全局视图 — 所有 Host、所有 Agent、所有数据源一目了然

### 非目标

- 远程执行命令或控制 Agent
- 自动推断 Agent 与 Data Source 的真实使用关系
- 扫描 Agent 内部记忆内容
- 自动识别公共数据源（如 Memory 系统等基础设施）

## 核心概念

Steed 是一个 Hub 式的可见性与关系管理平台，从三条业务线出发，把不同机器上的 Agent 和数据源汇聚到一个 Dashboard，提供一目了然的全局视图。

### 三条业务线

- **工作线**
- **学习线**
- **生活线**

Agent 归属一个 Lane，Data Source 可归属多个 Lane，均由用户在 Dashboard 手动标记。

### 四个核心实体

#### Host

一台安装了 Steed CLI + Host Service 的机器。Host 不归属 Lane。

#### Agent

Host 上一个被纳入管理的自主 Agent 实体。Agent 包含三类信息：

**身份标识**（注册时确定）：

- `match_key` — 用于将扫描结果匹配到已注册 Agent 的稳定标识（如进程名 + 工作目录、配置文件路径等）。注册时确定，扫描时携带回传，Worker 据此回填状态

**人工维护的信息**（在 Dashboard 中填写）：

- `nickname` — 用户定义的显示名称
- `role` — 用户填写的职责/角色描述
- Lane 归属 — 每个 Agent 归属一个 Lane

**扫描获得的信息**（由 Host Service 自动采集）：

- `runtime_app` — 实际运行它的 Agent 系统或宿主程序
- `runtime_version` — 扫描得到的版本信息
- `status` — 运行状态（running / stopped / missing）

> **Agent 身份边界**：v1 中，Agent 的身份以用户在 Dashboard 中确认或注册的管理对象为准。扫描结果通过 `match_key` 匹配到已有 Agent 记录并回填运行状态，而不是单独构成新的 Agent 身份。换版本、换宿主程序不会产生新的 Agent 记录。

> **关于 Agent 的范围**：Claude Code、Codex、Cursor 等交互式开发工具在 v1 中不作为 Agent 实体纳入管理。Agent 指的是具备独立运行、任务执行能力的自主系统（OpenClaw、Hermes 等）。

#### Data Source

Host 上可被发现和上报的外部资源或接入端，包括 CLI、第三方平台 CLI、MCP 服务等。Data Source 可由用户在 Dashboard 中手工归属到一个或多个 Lane；当它被多个 Lane 共享时，应在各自分组中都可见。

> **Data Source 唯一性约束**：v1 中，同一 Host 下 `(type, name)` 必须唯一。Worker 以此作为幂等 upsert 的匹配键。这意味着 v1 不支持同一 Host 上同名 Data Source 的多实例场景（如同名 CLI 的多账号、多配置）。若后续需要支持多实例，需将匹配键扩展为 `(type, name, profile)` 或类似结构。

#### Lane

业务线标签 — Work / Life / Learning。

- Agent 归属一个 Lane
- Data Source 可归属多个 Lane
- Agent ↔ Data Source 的绑定关系独立维护，不等价于 Lane 归属

### 关系模型

- 一个 Host 上可以有多个 Agent
- 一个 Host 上可以安装或认证多个 Data Source
- Agent 与 Data Source 的连接关系在 v1 中由用户在 Dashboard 上手工绑定，系统扫描只负责提供候选资源及其状态
- 同一个 Data Source 可能被多个 Agent 绑定

## 项目结构

本项目是一个 Bun monorepo，包含以下模块：

### 1. Dashboard（Web UI）

可视化界面，同时承担元数据维护功能：

- 展示三条业务线中 Agent 和 Data Source 的分布。其中 Agent 为单 Lane 归属，Data Source 支持多 Lane 归属，因此同一 Data Source 可出现在多个 Lane 分组中
- 全局视图 — 能看到所有 Host、所有 Agent、所有数据源
- 查看、筛选、分类、人工绑定 Agent ↔ Data Source 关系、维护备注和标签

### 2. CLI + Host Service（Agent Host 端）

安装在每台 Agent Host 上，包含两个部分：

**Host Service**（常驻进程）：

- 每 10 分钟采集并上报一次当前 Host 资源心跳快照（全量）
- 自动扫描本机 Agent（含 runtime_app、runtime_version）和 Data Source（含版本、认证状态）— 只上报实际发现到的资源
- **缺失语义**：每次上报为全量快照，若某个 Agent 或 Data Source 在本次快照中未出现，Worker 应将其标记为 `missing`（不删除记录，保留人工元数据）

**CLI**（命令式工具）：

- `scan` — 手动触发扫描
- `report` — 手动触发上报
- `register` — 注册自动扫描无法识别的自定义 Agent
- 补充上报、调试等辅助操作

### 3. 后台 Worker（API 层）

Cloudflare Worker 作为 API 网关：

- 接收各 Host 的上报数据
- 为 Dashboard 提供查询和元数据管理 API
- 连接 D1 数据库，是唯一的数据存储入口

## 数据源类型

数据源的接入形式目前主要是 CLI，未来也会支持 MCP 形式。

| 类型 | 示例 | 说明 |
|------|------|------|
| 个人开发的 CLI 项目 | nmem、zhe 等 | 自建工具，有完整 CLI 接口 |
| 第三方平台 CLI | Cloudflare（wrangler）、Railway 等 | 平台官方 CLI |
| MCP 服务 | 未来扩展 | 通过 MCP 协议对接 |

### 数据源识别方式

采用双重确认机制：

1. **PATH 探测** — 检测 CLI 是否在 PATH 中
2. **配置文件扫描** — 扫描已知 CLI 的配置文件路径（如 `~/.railway`、`~/.zhe` 等）判断安装和认证状态

识别过程同时采集 Data Source 的版本信息。

> 扫描只负责发现资源和采集状态，不负责自动建立 Agent 与 Data Source 之间的关系。该关系由用户在 Dashboard 中手动维护。

## 实施阶段

### Phase 0 — Mock 数据验证

基于 Mock 数据完成 Dashboard 的信息架构、实体展示和手工绑定交互。验收标准：Dashboard 能展示 Host / Agent / Data Source 的全局视图，支持 Lane 分类和手工绑定。

### Phase 1 — 真实上报接入

接入 Host Service 和 CLI 的真实扫描和上报能力，逐步替换 Mock 数据。验收标准：至少一台 Host 的 Host Service 能以 10 分钟心跳持续上报真实资源快照，Dashboard 展示的数据与该 Host 的实际状态基本一致。

## 预期效果

1. 在 Dashboard 上，能看到三条业务线中每个 Agent 分别在哪条线上，以及它们绑定了哪些数据源；Data Source 在其归属的所有 Lane 分组中都可见
2. 维护资源关系与状态认知，降低跨机器、跨业务线的心智成本
3. 提供全局视图 — 所有 Host、所有 Agent、所有数据源一目了然

## 未来扩展

- 扫描 Agent 内部记忆的各种情况
- 支持公共数据源的自动识别（如每台机器上都会有的 Memory 系统等基础设施）
- MCP 形式的数据源接入
- Agent 侧 CLI 补充上报更细粒度的信息
