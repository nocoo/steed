<p align="center">
  <img src="assets/brand/icon-rounded.png" alt="Steed" width="128" height="128" />
</p>

<h1 align="center">Steed</h1>

<p align="center">个人系统拓扑平台：一张图看清主机、服务、Agent 和供应商之间的关系。</p>

<p align="center">
  <a href="https://steed.hexly.ai">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Steed 是个人系统拓扑平台：把主机、服务、Agent、数据源和外部供应商画在同一张拓扑图里，按供应商或提供方分层，标注信任域。网页只负责浏览，图的结构通过带令牌的 Connect API 写入。

v0.4.0 起移除了早期的 Agent 资产盘点（CLI、Host Service、主机/Agent/数据源页面与相关数据表），并清空了旧的架构图和 Connect 状态；新的单一拓扑在 Phase 1 引入。迁移计划见 [Phase 0 文档](docs/18-phase0-topology-cleanup.md)。

## 功能

- Topology 页面：在 React Flow 画布上查看和编辑拓扑图（只读改造在 Phase 1 完成）。
- Connect 页面：签发、查看、轮换和吊销 Connect 令牌，令牌按图授权读或写。
- Connect API（`/api/v1`）：机器端使用 Bearer 令牌读取和修改拓扑，带修订号、幂等键、速率限制和审计记录。

## 使用

[站点](https://steed.hexly.ai) 的网页和浏览器 API 使用 Cloudflare Access 控制访问，需要获准的身份。`/api/live` 和 `/api/v1/*` 不经过 Access，由 Worker 自行校验 Connect 令牌。自行部署时，需要配置自己的 Access 应用、D1 数据库和 Connect 密钥。

## 开发

需要 Bun 和 Node.js 22.12+；Node 用于运行 Vite / Wrangler 等工具。所有示例从仓库根目录开始。

```bash
git clone https://github.com/nocoo/steed.git
cd steed
bun install --frozen-lockfile
bun run build
```

初始化 Web Worker 使用的本地数据库，迁移文件在 `apps/web/migrations`：

```bash
cd apps/web
bunx wrangler d1 migrations apply DB --local --persist-to .wrangler/state/web
cd ../..
```

在两个终端分别运行：

```bash
# 终端一：完整 Web Worker，回环端口 37035
bun run --cwd apps/web dev:worker
```

```bash
# 终端二：Vite，端口 7035，经 https://steed.dev.hexly.ai 访问
bun run dev
```

Vite 把 `/api` 代理到本地 Web Worker。通过现有 Caddy 代理访问 `https://steed.dev.hexly.ai`；启动前先查询 nmem 端口登记并检查 Caddy 映射和监听端口，Worker inspector 使用 38035。Access 开发豁免只允许回环地址和这个 HTTPS 源。本地 Connect 配置见[架构图与 Connect 文档](docs/13-architecture-diagrams-and-connect.md#local-configuration-and-future-enablement)。

`bun run build` 构建 Web 静态资源；`bun run typecheck` 和 `bun run lint` 检查类型与代码风格。

```text
apps/web/              React 页面、Web Worker、Access 校验、Connect API
apps/web/migrations/   D1 迁移
packages/api/          共享的拓扑图、Connect 与用户资料契约（zod）
```

生产部署构建 `apps/web`，使用其 `production` 环境发布到 Cloudflare Workers。

## 测试

从仓库根目录运行：

| 测试层 | 命令 |
| --- | --- |
| 全部单元与组件测试 | `bun run test` |
| Web 组件与视图模型测试 | `bun run --cwd apps/web test` |
| 拓扑图与 Connect HTTP 集成测试 | `bun run test:e2e` |

`bun run test` 同时生成覆盖率报告；`bun run test:watch` 进入监听模式。Web 测试使用 jsdom 和 React Testing Library。`test:e2e` 依次运行拓扑图和 Connect 两个 HTTP 测试，每次启动本地 Wrangler，在临时 D1 状态目录中应用迁移并使用临时回环端口。

当前没有已配置的浏览器端到端测试命令，浏览器完整操作链路仍需手动验证。

## 技术栈

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)
![D1](https://img.shields.io/badge/D1-F38020)
![React Flow](https://img.shields.io/badge/React_Flow-1A192B)
![Cloudflare Access](https://img.shields.io/badge/Cloudflare_Access-F38020)

| 部分 | 实现 |
| --- | --- |
| Web 界面 | React、React Router、Vite、Tailwind CSS、Radix UI |
| 拓扑图 | React Flow |
| 服务与存储 | Cloudflare Workers、D1；浏览器入口使用 Cloudflare Access |
| 验证 | Vitest、React Testing Library、jsdom、TypeScript、ESLint |

依赖以各 [workspace 的 package.json](package.json) 和 [bun.lock](bun.lock) 为准。

## 文档

- [文档索引](docs/README.md)
- [Phase 0：拓扑平台清理](docs/18-phase0-topology-cleanup.md)
- [架构图与 Connect](docs/13-architecture-diagrams-and-connect.md)
- [本地开发域名](docs/15-local-dev-domain.md)

## 许可证

[MIT](LICENSE) © 2026 Zheng Li
