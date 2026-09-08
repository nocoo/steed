<p align="center">
  <img src="assets/brand/icon-rounded.png" alt="Steed" width="128" height="128" />
</p>

<h1 align="center">Steed</h1>

<p align="center">集中查看多台主机上的 Agent、工具资源和它们的关系。</p>

<p align="center">
  <a href="https://steed.hexly.ai">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Steed 是面向自主 Agent 的资产管理工具。主机上的 CLI 和 Host Service 上报资源快照，Web 控制台汇总主机、Agent、数据源及其绑定关系，方便核对运行状态、资源归属和业务分类。

当前范围是资产盘点、状态查看和手动管理关系。Agent 需要先注册，扫描结果按配置的检测方式更新；Agent 与数据源的绑定由使用者确认。状态来自定期快照，默认每十分钟更新一次。

## 功能

- 查看主机在线状态、最后心跳，以及 Agent 的运行状态和版本。
- 扫描配置中的 CLI 工具，采集版本和鉴权状态观察值；默认包含 Wrangler、Railway、GitHub CLI 和 Vercel CLI。
- 编辑 Agent 的昵称、职责和业务分类，维护数据源的备注、标签与分类。业务分类预设为 Work、Life、Learning。
- 为同一主机上的 Agent 和数据源建立绑定，在关系图中按主机、业务分类或未绑定资源筛选。
- 通过 CLI 手动扫描、上报快照、查看状态，或在前台运行 Host Service 持续上报。

目前的数据源自动扫描覆盖 CLI 工具，MCP 扫描尚未实现。部分工具的鉴权状态通过配置文件是否存在判断，不能据此确定远端凭据仍然有效。

## 使用

### Web 控制台

[站点](https://steed.hexly.ai) 使用 Cloudflare Access 控制访问，需要获准的身份。进入后可查看 Overview、Hosts、Agents、Data Sources 和 Map。自行部署时，需要配置自己的 Access 应用、D1 数据库和服务凭据；当前入口说明见[开发与部署记录](docs/08-readme-refresh.md)。

### 主机 CLI

从源码运行 CLI。先完成下文的依赖安装，再查看命令帮助：

```bash
bun run packages/cli/src/bin/steed.ts --help
```

管理员通过 Worker 的 `POST /api/v1/hosts/register` 注册主机并获取 Host API key 后，使用 `init --url <部署地址> --key <Host API key>` 初始化。配置保存在 `~/.steed/config.json`，本地扫描与服务状态保存在 `~/.steed/state.json`。

初始化后的常用命令：

```bash
# 按实际运行时和路径注册 Agent
bun run packages/cli/src/bin/steed.ts register --match-key "openclaw:/path/to/agent"

bun run packages/cli/src/bin/steed.ts scan          # 扫描到本地状态
bun run packages/cli/src/bin/steed.ts scan --json   # 输出 JSON
bun run packages/cli/src/bin/steed.ts report        # 扫描并上报
bun run packages/cli/src/bin/steed.ts status        # 查看本机记录的状态
bun run packages/cli/src/bin/steed.ts service start # 前台运行，Ctrl+C 停止
```

注册时可指定进程、配置文件或自定义命令作为检测方式；参数见 `register --help`。源码中的 `login` 仍依赖旧版 Dashboard 的 `/api/auth/cli`，当前 Web 入口未提供这个流程，因此这里使用 Host API key 初始化。

## 开发

需要 Bun 和 Node.js 22.12+；Node 用于运行 Vite / Wrangler 等工具。所有示例从仓库根目录开始。

```bash
git clone https://github.com/nocoo/steed.git
cd steed
bun install --frozen-lockfile
bun run build
```

先初始化 Web Worker 使用的本地数据库。迁移文件在 API 包中，状态目录需要与 Web Worker 一致：

```bash
cd packages/worker
bunx wrangler d1 migrations apply DB --local \
  --persist-to ../../apps/web/.wrangler/state/web
cd ../..
```

在两个终端分别运行：

```bash
# 终端一：完整 Web Worker，默认端口 8787
bun run --cwd apps/web dev:worker
```

```bash
# 终端二：Vite 前端，默认 http://localhost:5173
bun run dev
```

Vite 将 `/api` 转发给本地 Web Worker。`dev` 环境已配置仅对 localhost 生效的 Access 开发模式和本地服务 token。根目录的 `bun run dev:worker` 只启动底层 API Worker；完整控制台使用上面的 `apps/web` 命令。

`bun run build` 构建 Web 静态资源；`bun run --cwd packages/cli build` 构建 CLI；`bun run typecheck` 和 `bun run lint` 检查类型与代码风格。

```text
apps/web/           当前 React 页面、Web Worker 和 Access 校验
packages/api/       浏览器 API 客户端与服务端处理函数
packages/worker/    Hono API、D1 数据访问和迁移
packages/cli/       CLI、资源扫描与 Host Service
packages/shared/    共享类型与工具
apps/web_legacy/    保留的旧版 Next.js 实现
```

当前生产部署构建 `apps/web`，使用其 `production` 环境发布到 Cloudflare Workers。早期文档中的 Next.js / Railway 架构对应旧版实现。

## 测试

从仓库根目录运行：

| 测试层 | 命令 |
| --- | --- |
| 全部单元与组件测试 | `bun run test` |
| Web 组件与视图模型测试 | `bun run --cwd apps/web test` |
| API HTTP 集成测试 | `bun run test:e2e` |

`bun run test` 同时生成覆盖率报告；`bun run test:watch` 进入监听模式。Web 测试使用 jsdom 和 React Testing Library。HTTP 测试会启动本地 Wrangler，在独立的 D1 状态目录中应用迁移，使用端口 8787；运行前先停止占用该端口的开发服务。

当前没有已配置的浏览器端到端测试命令。`test:e2e` 覆盖底层 API 的真实 HTTP 请求，浏览器完整操作链路仍需手动验证。

## 技术栈

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)
![D1](https://img.shields.io/badge/D1-F38020)
![React Flow](https://img.shields.io/badge/React_Flow-1A192B)
![Cloudflare Access](https://img.shields.io/badge/Cloudflare_Access-F38020)

| 部分 | 实现 |
| --- | --- |
| Web 界面 | React、React Router、Vite、Tailwind CSS、Radix UI |
| 关系图 | React Flow |
| 服务与存储 | Cloudflare Workers、Hono、D1；浏览器入口使用 Cloudflare Access |
| CLI 与主机服务 | TypeScript、Bun、Commander |
| 验证 | Vitest、React Testing Library、jsdom、TypeScript、ESLint |

依赖以各 [workspace 的 package.json](package.json) 和 [bun.lock](bun.lock) 为准。

## 文档

- [文档索引](docs/README.md)
- [当前入口、实现边界与 README 依据](docs/08-readme-refresh.md)
- [Vite Web 与 Cloudflare Access 迁移记录](docs/features/07-phase-f-vite-web-cf-access.md)
- [Host Service 设计](docs/features/03-phase-c1-host-service.md)
- [CLI 设计](docs/features/04-phase-c2-cli.md)
- [关系图设计](docs/features/06-phase-e-lane-map.md)

## 许可证

[MIT](LICENSE) © 2026 Zheng Li
