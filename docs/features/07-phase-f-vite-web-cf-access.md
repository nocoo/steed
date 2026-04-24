# Phase F: Vite Web on CF Worker + CF Access

> Status: ✅ COMPLETED v4
>
> 本阶段目标：把 Dashboard 从 Next.js + Railway + Google OAuth 全面切换为 **Vite SPA + Cloudflare Worker (Static Assets) + Cloudflare Access**，并把当前散落在 dashboard 中的服务端 API 与客户端调用代码抽出为独立 `packages/api`。
>
> **重要前提（用户决策 2026-04-24）：**
>
> 1. 不顾及向后兼容、不做渐进迁移。新 web **完全重写**，不复用旧 dashboard 的服务端 route handlers。
> 2. 旧 `packages/dashboard` 整体改名为 `apps/web_legacy`，保留代码作参考，但不再迭代、不再部署、不在 CI 默认链路里跑。
> 3. CF Access 替换 Google OAuth：完全移除 `next-auth`、`@auth/*`、`ADMIN_EMAILS` 相关代码与环境变量。
>
> **v2/v3/v4 修订要点：**
>
> - v2：编号 06→07；增 A2-bis 让根门禁覆盖新代码；packages/api 拆 client/server tsconfig；登录页 0；layout 改造细化；§5.3 入口示例修编译错。
> - v3：§4.6 layout 改造按真实 `(auth-provider.tsx:3 / (dashboard)/layout.tsx:21 / app-shell.tsx:4 / sidebar-context.tsx:1 / sidebar.tsx:3,34,158)` 重写；§9 凭证模型改为 cookie + 边缘注入 JWT 的责任边界。
> - **v4（本轮）**：放弃 `tsc -b` 切换计划。`tsc -b` 会立刻暴露 packages/shared/worker/cli 的存量类型问题（shared `crypto` 缺 lib、worker hono v4 status 类型、~30 处 `body is of type unknown`、migrations.test 缺 node types、MockAgent.extra 不存在……），这些不属于 Phase F 范围，硬拉进来会让本期膨胀失控。改用更稳的 §7.1 / §8.2 方案：根 typecheck 仍是 `tsc --noEmit`，但 root `tsconfig.json` 把 references 拆掉、改用 `include` 列出所有要查的 src 路径（含新 `packages/api` 与 `apps/web`，排除 `apps/web_legacy`），由根 tsconfig 的 lib/types 一次性满足全部需要。原 A2-bis 拆为 A2-bis-1（root 配置改造）+ A2-bis-2（pre-commit/CI 同步）。
>
> ---

## 1. 范围与非目标

### 1.1 In-scope

- 仓库目录调整为 `apps/` + `packages/` 两层（保持 Bun workspaces，不引入 Turborepo）。
- 新建 `packages/api`：含
  - **client**：浏览器/Node 通用的 fetch 包装与类型，供 `apps/web` 直接调用。
  - **server handlers**：framework-agnostic 的请求处理函数 `(req: Request, ctx) => Promise<Response>`，供新 `apps/web` 的 CF Worker 入口直接挂载。
  - 两个 subpath export：`@steed/api/client`（DOM lib）与 `@steed/api/server`（WebWorker lib），见 §3.7。
- 新建 `apps/web`：Vite + React 19 + React Router v7 + Tailwind v4 + 复用 shadcn/Radix 组件。
- 新 `apps/web` 完整恢复 legacy 的 **7 个业务页面**（不含登录页 — 详见 §4.4）。
- CF Worker 入口同时承担：静态资源服务（assets binding）+ `/api/*` 转发到 `packages/api/server`。
- CF Access JWT 校验集成：team `nocoo`，aud `a920d3430b1e5a636590cd5d4f04dc657f89f9939c76a6870140015c0381d9b3`。
- 旧 `packages/dashboard` → `apps/web_legacy`，从 root `bun test` / hooks / CI 默认链路移除。
- **根脚本/配置/CI/hooks 一并改造**为"默认覆盖 packages/* + apps/web、默认排除 apps/web_legacy"。该改造是 Stage A 的必做 commit（A2-bis），晚于它的 Stage B/C/D/E 才能让"原子提交受门禁约束"这条承诺成立。

### 1.2 Out-of-scope（本阶段不做）

- 不改 `packages/worker`（仍是 D1 API 网关，路由、auth、schema 全部不动）。
- 不改 `packages/cli`、`packages/shared`。
- 不调整 D1 schema、不改 wrangler 数据库绑定。
- 不上 Turborepo / Nx / pnpm。
- 不写新业务功能。功能等价 = legacy 当前已有页面行为完全恢复。
- 不删除 `apps/web_legacy` 代码。仅停止部署与 CI 跑测；后续阶段单独评估删除。
- 不动 `packages/cli` 的 OAuth login 流（CLI 仍依赖旧 dashboard 的 `/api/auth/cli` 端点）—— 见 §11 R1。

---

## 2. 仓库目录最终形态

### 2.1 现状

```
steed/
├── packages/
│   ├── cli/
│   ├── dashboard/        # Next.js, Railway, Google OAuth
│   ├── shared/
│   └── worker/
└── (root configs)
```

### 2.2 目标形态

```
steed/
├── apps/
│   ├── web/              # 新：Vite SPA + CF Worker entry
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── router.tsx
│   │   │   ├── routes/
│   │   │   │   ├── _layout.tsx
│   │   │   │   ├── overview.tsx
│   │   │   │   ├── hosts.tsx
│   │   │   │   ├── agents/index.tsx
│   │   │   │   ├── agents/$id.tsx
│   │   │   │   ├── data-sources/index.tsx
│   │   │   │   ├── data-sources/$id.tsx
│   │   │   │   └── map.tsx
│   │   │   ├── components/    # 迁移：layout/* + map/* + ui/*（含改造，见 §4.6）
│   │   │   ├── viewmodels/    # 迁移：legacy 全部 viewmodels（fetch → apiClient）
│   │   │   ├── hooks/         # use-mobile.ts
│   │   │   └── lib/           # utils, navigation, version
│   │   ├── worker/
│   │   │   ├── index.ts       # CF Worker 入口
│   │   │   └── access-jwt.ts  # CF Access JWT 验签
│   │   ├── public/            # 复用 legacy logo/favicon
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── wrangler.toml
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── package.json
│   └── web_legacy/        # 由 packages/dashboard 整体迁入
│       └── (原内容不变；不再受默认门禁约束)
├── packages/
│   ├── api/              # 新：client + server handlers
│   │   ├── src/
│   │   │   ├── client/
│   │   │   │   ├── index.ts        # 桶状导出（含 createApiClient + types）
│   │   │   │   ├── http.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── bindings.ts
│   │   │   │   ├── data-sources.ts
│   │   │   │   ├── hosts.ts
│   │   │   │   ├── lanes.ts
│   │   │   │   ├── map.ts
│   │   │   │   └── overview.ts
│   │   │   ├── server/
│   │   │   │   ├── index.ts        # createApiRouter
│   │   │   │   ├── router.ts
│   │   │   │   ├── context.ts
│   │   │   │   ├── errors.ts
│   │   │   │   ├── worker-fetch.ts
│   │   │   │   └── handlers/
│   │   │   │       ├── agents.ts
│   │   │   │       ├── bindings.ts
│   │   │   │       ├── data-sources.ts
│   │   │   │       ├── hosts.ts
│   │   │   │       ├── lanes.ts
│   │   │   │       ├── map.ts
│   │   │   │       └── overview.ts
│   │   │   └── shared/             # client 与 server 都用的纯逻辑
│   │   │       ├── schemas/index.ts
│   │   │       └── lane-map.ts
│   │   ├── tsconfig.json           # 单文件，继承根 tsconfig（v4 取消 client/server 拆分）
│   │   ├── vitest.config.ts
│   │   └── package.json            # exports: ./client, ./server, ./shared
│   ├── cli/              # 不动
│   ├── shared/           # 不动
│   └── worker/           # 不动
├── docs/
├── scripts/
├── package.json          # workspaces: ["apps/*", "packages/*"]
├── tsconfig.json
├── vitest.workspace.ts   # 默认覆盖 packages/* + apps/web
└── ...
```

### 2.3 命名约定

- `apps/*`：可独立部署的产物。本阶段只装 `web` 与 `web_legacy`。
- `packages/*`：被 apps/其他 packages 依赖的库代码。`cli` 是终端入口但留在 packages 以减少改动面。

---

## 3. `packages/api` 设计

### 3.1 公共 surface（subpath exports）

`packages/api/package.json`：

```jsonc
{
  "name": "@steed/api",
  "type": "module",
  "exports": {
    "./client": { "types": "./src/client/index.ts", "import": "./src/client/index.ts" },
    "./server": { "types": "./src/server/index.ts", "import": "./src/server/index.ts" },
    "./shared": { "types": "./src/shared/index.ts", "import": "./src/shared/index.ts" }
  }
}
```

> **subpath 边界由 exports 字段在运行时强制**：消费者必须明确 `@steed/api/client` 或 `@steed/api/server`，不会一次性把两端都拉进同一个 bundle（Vite 走 client、Wrangler 走 server）。类型层不再拆 tsconfig（详见 §3.7）。

### 3.2 Client：`@steed/api/client`

```ts
// 仅依赖标准 fetch / Headers / Request / Response（DOM 或 Workers 都有）
interface ApiClientOptions {
  baseUrl: string;              // "" (same-origin) | "https://web.example.com"
  fetch?: typeof globalThis.fetch;
  headers?: () => HeadersInit;
}

export interface ApiClient {
  agents: {
    list(query?: AgentListQuery): Promise<AgentListResponse>;
    get(id: string): Promise<Agent>;
    update(id: string, body: UpdateAgentRequest): Promise<Agent>;
    listBindings(id: string): Promise<Binding[]>;
  };
  bindings: {
    list(query?: BindingListQuery): Promise<Binding[]>;
    create(body: CreateBindingRequest): Promise<Binding>;
    delete(agentId: string, dataSourceId: string): Promise<void>;
  };
  dataSources: {
    list(query?: DataSourceListQuery): Promise<DataSourceListResponse>;
    get(id: string): Promise<DataSourceWithLanes>;
    update(id: string, body: UpdateDataSourceRequest): Promise<DataSourceWithLanes>;
    setLanes(id: string, body: SetLanesRequest): Promise<SetLanesResponse>;
  };
  hosts: { list(): Promise<HostWithStatus[]>; };
  lanes: { list(): Promise<Lane[]>; };
  map: { get(): Promise<MapPayload>; };
  overview: { get(): Promise<Overview>; };
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) { ... }
}

export function createApiClient(opts: ApiClientOptions): ApiClient { ... }
```

错误：HTTP 非 2xx → 抛 `ApiHttpError { status, body, message }`。viewmodels 层捕获并按 status 决定 toast/重试/导航。

### 3.3 Server handlers：`@steed/api/server`

```ts
export interface ApiEnv {
  WORKER_API_URL: string;
  DASHBOARD_SERVICE_TOKEN: string;
}

export interface AuthedUser {
  email: string;
  sub: string;
}

export interface ApiContext {
  env: ApiEnv;
  user: AuthedUser | null;
  workerClient: WorkerClient;
}

export interface ApiRouter {
  fetch(req: Request, env: ApiEnv, user: AuthedUser | null): Promise<Response>;
}

export function createApiRouter(): ApiRouter;
```

CF Worker 入口里：

```ts
if (url.pathname.startsWith("/api/")) {
  return router.fetch(req, env, user);
}
```

内部使用极简 method+path matcher（不引入 hono/itty-router 等框架，~80 行手写）：

```ts
type Handler = (req: Request, ctx: ApiContext, params: Record<string, string>) => Promise<Response>;
type Route = { method: string; pattern: URLPattern; handler: Handler };
```

`URLPattern` 在 Workers / Node 20+ / Bun 都已原生支持。

### 3.4 Server handlers 列表（与 legacy 1:1）

| Method | Path | Handler |
|---|---|---|
| GET | `/api/overview` | overview.get |
| GET | `/api/hosts` | hosts.list |
| GET | `/api/agents` | agents.list |
| GET | `/api/agents/:id` | agents.get |
| PATCH | `/api/agents/:id` | agents.update |
| GET | `/api/data-sources` | dataSources.list |
| GET | `/api/data-sources/:id` | dataSources.get |
| PATCH | `/api/data-sources/:id` | dataSources.update |
| PUT | `/api/data-sources/:id/lanes` | dataSources.setLanes |
| GET | `/api/lanes` | lanes.list |
| GET | `/api/bindings` | bindings.list |
| POST | `/api/bindings` | bindings.create |
| DELETE | `/api/bindings/:agentId/:dataSourceId` | bindings.delete |
| GET | `/api/map` | map.get |

**不迁移**：`/api/auth/[...nextauth]` 与 `/api/auth/cli`（Google OAuth 链路全部移除）。CLI OAuth 链路处置见 §11 R1。

### 3.5 Worker 上游调用（worker-fetch）

完全等价于 legacy `lib/worker-api.ts` 的 `workerFetch`：

- 不再 `import "server-only"`（Next.js 专用宏）。
- env 不走 `process.env`，而走 `ApiContext.env`。
- 错误类型：`WorkerApiError { status, message }`，由 `errors.ts` 统一映射成 `Response`。

### 3.6 测试

- `packages/api` 自带 vitest，覆盖率 ≥ 90%（与全局阈值一致）。
- Client 测试：mock `fetch`，断言 URL/method/headers/body 与解析结果。
- Server 测试：mock `WorkerClient`，对每个 handler 断言 200/4xx/5xx 路径。
- 不依赖真实 Worker，速度快；L2 真 HTTP 由后续阶段补（不在本阶段）。

### 3.7 TypeScript 配置（v4 简化）

- `packages/api` 不再拆 `tsconfig.client.json` / `tsconfig.server.json`。**只有一份 `tsconfig.json`**，继承根 tsconfig（已包含 DOM + WebWorker lib）。
- `src/shared/**`（schemas + lane-map）保持纯 TS（无 DOM、无 Workers globals），两端复用。
- `src/client/**` 用 `fetch` / `URL` / `HeadersInit`；不依赖 `process` / `Bun` 命名空间。
- `src/server/**` 用 `Request` / `Response` / `URLPattern` / `crypto.subtle`；不依赖 `window` / `document`。
- 物理隔离由 **`package.json#exports` 三个 subpath** 保证（消费端 `@steed/api/client` 永远不会拉到 server 模块），不需要类型层再拆一份。
- 如未来出现 client 代码意外引入 Workers-only API 之类的越界，再单独按需拆 tsconfig，不属于 Phase F 必做。

---

## 4. `apps/web` 设计

### 4.1 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| Build | Vite | ^7.x |
| Framework | React | ^19 |
| Router | React Router | ^7.x（library mode，纯 SPA，不开 SSR） |
| Styling | Tailwind CSS | ^4 |
| Components | Radix + shadcn | 基于 legacy `components/ui` 改造（见 §4.6） |
| Form | react-hook-form + zod | 同 legacy |
| Charts/Graph | recharts + reactflow | 同 legacy |
| Icons | lucide-react | 同 legacy |
| Toast | sonner | 同 legacy |
| Test | vitest + @testing-library/react + jsdom | 同 legacy |

**为什么 React Router v7 而不是 TanStack Router**：legacy viewmodels 全是 `useState`+`useEffect`+`fetch` 的极简 MVVM，不依赖 loader/action；React Router 7 的 library mode 与现有代码改动最小，类型安全够用。

### 4.2 路由表（共 7 个业务路由，无登录页）

| Path | Route file | 对应 legacy |
|---|---|---|
| `/` | `routes/_layout.tsx` → redirect `/overview` | `app/page.tsx` |
| `/overview` | `routes/overview.tsx` | `(dashboard)/overview/page.tsx` |
| `/hosts` | `routes/hosts.tsx` | `(dashboard)/hosts/page.tsx` |
| `/agents` | `routes/agents/index.tsx` | `(dashboard)/agents/page.tsx` |
| `/agents/:id` | `routes/agents/$id.tsx` | `(dashboard)/agents/[id]/page.tsx` |
| `/data-sources` | `routes/data-sources/index.tsx` | `(dashboard)/data-sources/page.tsx` |
| `/data-sources/:id` | `routes/data-sources/$id.tsx` | `(dashboard)/data-sources/[id]/page.tsx` |
| `/map` | `routes/map.tsx` | `(dashboard)/map/page.tsx` |

### 4.3 ViewModel 层

直接迁移 legacy `src/viewmodels/*` → `apps/web/src/viewmodels/`，调整：

- `fetch("/api/...")` → `apiClient.<resource>.<method>(...)`，`apiClient` 通过 React Context 注入。
- 删除 `"use client"` 指令。
- 类型从 `@steed/shared` 与 `@steed/api/client` 混合导入。

### 4.4 Auth 状态（明确"0 个登录页"）

- CF Access 在到达 Worker 前完成身份校验。**未授权用户被 Cloudflare 拦截到 Access 团队登录页**（属于 Cloudflare 侧 UI），不会进入新 web。
- 新 web **不渲染任何 `/login` 路由**；legacy 的 `app/login/*` 不迁移。
- 新 web **不持有用户身份信息**：不读 cookie、不显示 email、不显示登出按钮（详见 §4.6）。

### 4.5 测试

- 组件测试：legacy 已有的 `components/map/*` `components/ui/lane-chips` 测试随文件迁移并通过；新 web 整体覆盖率 ≥ 90%。
- viewmodel 测试：legacy `viewmodels/__tests__/*` 同迁，断言改为 mock `ApiClient`。
- 路由烟测：`<MemoryRouter>` 渲染每个 route 的占位文案。
- L3 Playwright：本阶段不上。

### 4.6 Layout / Sidebar 改造点（不是机械迁移）

Legacy 的 layout 与 next-auth/Next 导航强耦合，分散在 4 个文件，C2 必须按真实归属逐处改造而不是 `s/next/react-router/g`：

| Legacy 文件:行 | 现状代码 | 新 web 处置 |
|---|---|---|
| `components/auth-provider.tsx:3` | `import { SessionProvider } from "next-auth/react"` 包裹 children | **整个文件删除**；`AuthProvider` 在新 web 不存在 |
| `app/(dashboard)/layout.tsx:1` | `import { redirect } from "next/navigation"` + `auth()` 检查 + `redirect("/login")` | **整个 server-side guard 删除**；身份由 CF Access 在边缘把关；新 web 的 `routes/_layout.tsx` 不做 auth 判断 |
| `app/(dashboard)/layout.tsx:21` | `<AuthProvider><SidebarProvider><AppShell>...</AppShell><Toaster/></SidebarProvider></AuthProvider>` | 新 web `_layout.tsx` 改为 `<SidebarProvider><AppShell><Outlet/></AppShell><Toaster/></SidebarProvider>`，去掉 `AuthProvider` 这一层 |
| `components/layout/sidebar-context.tsx:1` | `"use client"` 指令 + `useEffect` + `localStorage` | **指令删除**（Vite 不需要）；其余逻辑不变，整体迁入 `apps/web/src/components/layout/sidebar-context.tsx` |
| `components/layout/app-shell.tsx:1-4` | `"use client"` + `import { usePathname } from "next/navigation"` | `"use client"` 删除；`usePathname` 改为 `import { useLocation } from "react-router"` 并在内部用 `useLocation().pathname` |
| `components/layout/sidebar.tsx:3` | `import { signOut, useSession } from "next-auth/react"` | **整个 import 删除**；不再使用 session |
| `components/layout/sidebar.tsx:34` | 读 `session.user.email/name/image` 渲染用户卡片 | **删除用户卡片**；改为只显示静态 logo + 应用名（CF Access 已在边缘验证身份，不在 SPA 内重复） |
| `components/layout/sidebar.tsx:158` | "Sign out" 按钮 → `signOut()` 跳 `/login` | **删除按钮**；如需登出走 Cloudflare 的 `/cdn-cgi/access/logout`，留待 R2 后续 |
| `components/layout/sidebar.tsx` | 用 `next/link`、`usePathname`、`useRouter` | 改为 `react-router`：`<Link>`、`useLocation`、`useNavigate` |
| `components/layout/sidebar.tsx` 路径常量 | hard-coded `/overview` 等 | 复用 `lib/navigation.ts`（同步迁移） |
| `components/layout/breadcrumbs.tsx`、`theme-toggle.tsx` | 同样含 `"use client"` 指令 | 删除指令；不依赖 next-auth/Next 导航的部分原样迁移 |

执行顺序：在 C2（迁 layout）这一 commit 内一次完成，不留过渡分支。

---

## 5. CF Worker 入口与 CF Access

### 5.1 部署形态

```
                          ┌──────────────────────────┐
   user (browser)  ────►  │ Cloudflare Access (Edge) │ ── 未登录 → Access 登录页
                          └──────────┬───────────────┘
                                     │ 登录后注入 Cf-Access-Jwt-Assertion
                                     ▼
                          ┌──────────────────────────┐
                          │ apps/web Worker           │
                          │  • verify Access JWT      │
                          │  • static assets (SPA)    │
                          │  • /api/* → packages/api  │
                          └──────────┬───────────────┘
                                     │ Bearer DASHBOARD_SERVICE_TOKEN
                                     ▼
                          ┌──────────────────────────┐
                          │ packages/worker (existing)│
                          └──────────────────────────┘
```

### 5.2 `apps/web/wrangler.toml`

```toml
name = "steed-web"
main = "worker/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"

[vars]
CF_ACCESS_TEAM = "nocoo"
CF_ACCESS_AUD  = "a920d3430b1e5a636590cd5d4f04dc657f89f9939c76a6870140015c0381d9b3"

# Secrets（不写文件，wrangler secret put）：
#   WORKER_API_URL
#   DASHBOARD_SERVICE_TOKEN
```

### 5.3 Worker 入口 `apps/web/worker/index.ts`（修订为可编译版）

```ts
import { createApiRouter } from "@steed/api/server";
import { verifyAccessJwt, type VerifyResult } from "./access-jwt";

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  CF_ACCESS_TEAM: string;
  CF_ACCESS_AUD: string;
  WORKER_API_URL: string;
  DASHBOARD_SERVICE_TOKEN: string;
}

const router = createApiRouter();

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // healthz: 完全跳过 Access 校验，方便 wrangler tail 调试
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    // 全局 CF Access JWT 校验
    const verifyResult: VerifyResult = await verifyAccessJwt(req, {
      team: env.CF_ACCESS_TEAM,
      aud: env.CF_ACCESS_AUD,
    });
    if (!verifyResult.ok) {
      return new Response("Unauthorized", { status: 401 });
    }

    // /api/* → packages/api server handlers
    if (url.pathname.startsWith("/api/")) {
      return router.fetch(
        req,
        {
          WORKER_API_URL: env.WORKER_API_URL,
          DASHBOARD_SERVICE_TOKEN: env.DASHBOARD_SERVICE_TOKEN,
        },
        verifyResult.user,
      );
    }

    // 其余 → 静态资源（SPA fallback 由 not_found_handling 处理）
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
```

`access-jwt.ts` 类型：

```ts
export type VerifyResult =
  | { ok: true; user: { email: string; sub: string } }
  | { ok: false; reason: string };
```

### 5.4 `verifyAccessJwt` 实现要点

- 读取请求头 `Cf-Access-Jwt-Assertion`。
- 拉取（带边缘缓存）`https://nocoo.cloudflareaccess.com/cdn-cgi/access/certs` 公钥集合。
- 用 `jose`（Workers 兼容版本）验签。
- 校验 `aud === env.CF_ACCESS_AUD`、`iss === "https://nocoo.cloudflareaccess.com"`、`exp/iat`。
- 返回 `{ ok, user | reason }`。

**为什么不全靠"边缘已经拦了"**：
1. CF Access policy 配错（service token 漏配 / bypass policy）会让请求带空 JWT 直达 Worker。
2. wrangler dev 本地不经过 Access；用 `CF_ACCESS_DEV_BYPASS=true` 跳过，生产必须验签。
3. 多一层校验避免 `*.workers.dev` 直链被绕过。

### 5.5 本地开发模式

- `bun run --cwd apps/web dev`：`vite` 起前端 dev server（5173），通过 vite proxy 把 `/api/*` 转发到 wrangler dev（8787）。
- `bun run --cwd apps/web dev:worker`：`wrangler dev --local --persist-to .wrangler/state/web`，加载 `dist/` 产物。
- `CF_ACCESS_DEV_BYPASS=true` 时 `verifyAccessJwt` 直接返回 `{ ok: true, user: { email: "dev@local", sub: "dev" } }`。
- 上游 `packages/worker` 仍走 `wrangler dev` 的本地实例。

---

## 6. 页面功能恢复清单（7 个，与 §4.2 对齐）

| 页面 | Legacy 文件 | 主要交互 | 依赖 viewmodel | 测试要点 |
|---|---|---|---|---|
| Overview | `(dashboard)/overview/page.tsx` | 4 个统计卡 + 最近活动 | `useOverviewViewModel` | 数字渲染、loading skeleton |
| Hosts | `(dashboard)/hosts/page.tsx` | 列表 + status badge | `useHostsViewModel` | empty state、status 着色 |
| Agents 列表 | `(dashboard)/agents/page.tsx` | 列表 + 筛选 (host/lane/status) | `useAgentsViewModel` | filter 联动、分页 cursor |
| Agent 详情 | `(dashboard)/agents/[id]/page.tsx` | 元数据编辑 + bindings 列表 + 解绑 | `useAgentDetailViewModel` + `useAgentBindingsViewModel` | 表单校验、PATCH 失败回滚 |
| DataSources 列表 | `(dashboard)/data-sources/page.tsx` | 列表 + 筛选 | `useDataSourcesViewModel` | 同 agents |
| DataSource 详情 | `(dashboard)/data-sources/[id]/page.tsx` | 元数据 + lane 多选 + 创建 binding | `useDataSourceDetailViewModel` | lane 多选去重、binding 跨 host 校验提示 |
| Map | `(dashboard)/map/page.tsx` | reactflow 图 + 筛选 + 节点抽屉 | `useMapViewModel` + `lane-map.ts` | 节点布局、抽屉切换、筛选过滤 |

每个页面在新 web 完成后，跑 vitest（含组件 + viewmodel），并人工开 wrangler dev + vite dev 验收。

---

## 7. 原子化提交计划

> 共 **24** 个 commit（v4：A2-bis 拆为 A2-bis-1 + A2-bis-2）。  
> A2-bis-2 之后的所有 commit 都受默认门禁（`bun run typecheck` / `lint` / `test` / `check-coverage` / pre-commit）约束。  
> A1 / A2 / A3 仅触及索引/目录/包重命名，无新业务代码，按现状 G1/L1 通过即可。
>
> 提交标记：⚙️ infra / 📦 package / 🎨 ui / 🧪 test / 📝 docs。

### Stage A — 文档、目录骨架与门禁改造（5 commits）

| # | 标记 | Subject | 内容 |
|---|---|---|---|
| A1 | 📝 | `docs(phase-f): add 07 vite-web + cf-access design v4` | 本文件 + 更新 `docs/features/README.md` 与 `docs/README.md` 索引 |
| A2 | ⚙️ | `chore(repo): introduce apps/ workspace layer` | 新建 `apps/.gitkeep`；root `package.json` workspaces 加上 `"apps/*"`；root `tsconfig.json` 不变 |
| A3 | ⚙️ | `chore(repo): rename packages/dashboard → apps/web_legacy` | `git mv` + 改包名 `@steed/dashboard` → `@steed/web-legacy`；root scripts 暂时仍指向 web_legacy 以保持 `bun run dev/build/start/test` 行为不变；从 `lint-staged` / `vitest.config.ts exclude` / `.husky/pre-commit` 中把 `packages/dashboard` 路径改成 `apps/web_legacy` |
| A2-bis-1 | ⚙️ | `chore(repo): switch root typecheck to include-based tsconfig (cover packages/* + apps/web)` | 改造 root `tsconfig.json`（详见下方"A2-bis-1 tsconfig 改造"）；root `bun run typecheck` 仍是 `tsc --noEmit`，但单次执行就一次性检查 packages/shared、packages/worker、packages/cli、（即将出现的）packages/api、apps/web；显式不含 apps/web_legacy。**不引入 `tsc -b`**（见 v4 修订说明） |
| A2-bis-2 | ⚙️ | `chore(repo): make root test/coverage/lint auto-cover packages/* + apps/web, exclude web_legacy` | 改造 `vitest.workspace.ts`、`vitest.config.ts`、`package.json#scripts.test`、`.husky/pre-commit`、`.github/workflows/ci.yml`、`eslint.config.*`，详见下方"A2-bis-2 改造清单" |

#### A2-bis-1 tsconfig 改造

| 项 | 原 | 改造后 |
|---|---|---|
| `tsconfig.json` 顶层 | `"files": []` + `"references": [...]` | 改为 **不再使用 references**：`"files": []` 删除；新增 `"include": [...]`（列下表所有路径）；`compilerOptions` 给一组宽松到能覆盖所有子项目的设置（`target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `lib: ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]`, `types: ["node", "@cloudflare/workers-types"]`, `jsx: "react-jsx"`, `strict: true`, `noUncheckedIndexedAccess: true`, `noEmit: true`, `skipLibCheck: true`, `esModuleInterop: true`, `resolveJsonModule: true`, `isolatedModules: true`, `forceConsistentCasingInFileNames: true`），并 `paths` 配 `@steed/*` workspace 别名 |
| `tsconfig.json#include` | — | `["packages/shared/src/**/*", "packages/worker/src/**/*", "packages/cli/src/**/*", "packages/api/src/**/*", "apps/web/src/**/*"]` |
| `tsconfig.json#exclude` | — | `["**/node_modules", "**/dist", "**/*.test.ts", "**/*.test.tsx", "apps/web_legacy/**"]`（**排除 .test.\* 是关键**：worker/migrations.test.ts 等存量类型问题不在 Phase F 范围；test 文件由各包自身的 `vitest run` 在运行时编译，类型错误不会阻塞根 typecheck） |
| 各子包 `tsconfig.json` | shared/worker/cli 各自独立 | **保持不变**。`bun run --cwd packages/<name> typecheck` 仍可单独跑（如果未来需要），但根 `bun run typecheck` 不再 walk 子包配置 |

> **关键设计**：根 `tsconfig.json` 不再 `extends` 子包，也不再 `references`，而是一份"超集"配置，把所有 src 路径直接列进去。这样：
> 1. 不会触发 `tsc -b` 的 build 模式与 composite 要求，绕开存量类型债。
> 2. 单次 `tsc --noEmit` 就能验证 Phase F 关心的所有 src 代码（包含新加的 `packages/api`、`apps/web`）。
> 3. 排除 `**/*.test.*` 让根 typecheck 速度可控、不卡现有测试文件的历史问题。运行时类型错误（含 test）由 vitest 自带的 esbuild + 单包 vitest config 兜住，本来就跑得过。
> 4. `apps/web_legacy` 的 Next 类型生态完全隔离在子包内，不污染根。

#### A2-bis-2 改造清单

| 文件 | 现状 | 改造 |
|---|---|---|
| `package.json#scripts.typecheck` | `tsc --noEmit` | **不变**（已由 A2-bis-1 改 root tsconfig 实现） |
| `package.json#scripts.lint` | `eslint --max-warnings=0 .` | **不变**；改 `eslint.config.*` 增 `ignores: ["apps/web_legacy/**"]` |
| `package.json#scripts.test` | `vitest run --coverage && bun run --cwd packages/dashboard test` | 改为 `vitest run --coverage`；由 vitest workspace 统一调度 |
| `vitest.workspace.ts` | 列 `packages/shared` `packages/worker` | 改为：`["packages/shared", "packages/worker", "packages/cli", "packages/api", "apps/web"]`；显式不含 `apps/web_legacy` |
| `vitest.config.ts` | `coverage.include` 限 packages 三家；`exclude: ["packages/dashboard/**"]` | `coverage.include` 改为 `["packages/*/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"]`；`exclude` 增 `"apps/web_legacy/**"` |
| `.husky/pre-commit` | 单独再 `cd packages/dashboard && bun vitest run --coverage` | 删除 dashboard 单跑分支 |
| `.github/workflows/ci.yml` | `test-command: "bun run test && bun run --cwd packages/dashboard test"` | 改为 `test-command: "bun run test"`；`typecheck-command: "bun run typecheck"`（去掉 dashboard 单跑） |
| `scripts/check-coverage.ts` | 阈值 90/85/85/90，不变 | 不变 |

### 7.1 完整 commit 时序（v4）

```
A1       docs(phase-f): add 07 vite-web + cf-access design v4
A2       chore(repo): introduce apps/ workspace layer
A3       chore(repo): rename packages/dashboard → apps/web_legacy
A2-bis-1 chore(repo): switch root typecheck to include-based tsconfig
A2-bis-2 chore(repo): root test/coverage/lint cover packages/* + apps/web, exclude web_legacy
B1       feat(api): scaffold @steed/api package (subpath exports + smoke test)
B2       feat(api): add WorkerClient + ApiHttpError + worker-fetch
B3       feat(api): port zod schemas + lane-map from legacy (shared/)
B4       feat(api): add server router + 14 handlers (with tests)
B5       feat(api): add typed ApiClient (client/* with tests)
C1       feat(web): scaffold Vite + React 19 + Tailwind v4 app (smoke test)
C2       feat(web): port + adapt UI primitives & layout (de-next-auth, see §4.6)
C3       feat(web): add CF Worker entry + Access JWT verifier
C4       feat(web): wire vite dev proxy + dev bypass for CF Access
D1       feat(web): introduce React Router + ApiClientProvider
D2       feat(web): port viewmodels (overview/hosts/agents/data-sources/map)
E1       feat(web): restore /overview page
E2       feat(web): restore /hosts page
E3       feat(web): restore /agents list + filters
E4       feat(web): restore /agents/:id detail (form + bindings)
E5       feat(web): restore /data-sources list + filters
E6       feat(web): restore /data-sources/:id detail (lanes + bindings)
E7       feat(web): restore /map page (reactflow + filters + drawer)
F1       chore(legacy): finalize web_legacy exclusion + flip status to ✅
```

合计 **24 commits**（v4 把 A2-bis 拆为两步）。A2-bis-2 之后任何 commit 都自动接受根门禁。B1 / C1 之前根 typecheck 不需要这两个新包存在（`include` 是 glob，找不到匹配文件不会报错），因此 commit 顺序不再像 v2 那样要先建 stub tsconfig。

### 7.2 提交计划要点

- 不引入 "WIP" / "fixup" 等过渡提交；每个 commit 自包含。
- A2-bis-2 之后任何 commit 不通过根 `typecheck/lint/test/check-coverage` → 在该 commit 内修，不滚下一个。
- 新 `packages/api` 与 `apps/web` 覆盖率门槛沿用根全局阈值：lines/statements ≥ 90%，functions/branches ≥ 85%。
- 根 typecheck 不查 `**/*.test.*`（A2-bis-1）。test 类型检查由各包 vitest 在 run 时自带的 esbuild 兜底，原本就跑得过；这一约束让 Phase F 不背 packages/worker 等存量类型债。如未来要把测试纳入根 typecheck，单独立项（不在本阶段）。
- B1 / C1 不再需要 stub tsconfig：根 tsconfig 的 `include` 是 glob，匹配不到文件不报错。两个 commit 各自创建子包 tsconfig（继承根或独立都可，前者更简）+ 一个最小可运行的 vitest 测试，自然进入根门禁。

---

## 8. 工程细节

### 8.1 Workspaces / 包名

- root `package.json#workspaces`: `["apps/*", "packages/*"]`
- 新包名：`@steed/api`、`@steed/web`、`@steed/web-legacy`。
- `@steed/web` `dependencies` 增 `"@steed/api": "workspace:*"`、`"@steed/shared": "workspace:*"`。
- `@steed/api` `dependencies` 增 `"@steed/shared": "workspace:*"` + `"zod": "^4"`。

### 8.2 TypeScript

- root `tsconfig.json`：单文件，`include` 列出所有 src 路径；不使用 `references`、不使用 `tsc -b`。配置内容详见 §7 A2-bis-1 表。
- root `bun run typecheck` = `tsc --noEmit`（不变）。
- 根 typecheck **不查 `**/*.test.*`**：Phase F 不修 packages/shared/worker/cli 的存量测试类型债（如 worker 的 `body is of type unknown`、migrations.test 缺 node types、MockAgent.extra 不存在等）。各包 vitest run 时由 esbuild 跑通（实测通过），因此运行不受影响。如要把测试纳入根 typecheck，单独立项。
- `apps/web/tsconfig.json` 继承 root，仅微调（`jsx: "react-jsx"` 已在 root；`include: ["src/**/*", "worker/**/*"]`、`exclude: ["**/*.test.*"]`）。
- `packages/api/tsconfig.json` 继承 root；client 与 server 不再拆物理 tsconfig 文件 —— 因为根 tsconfig 已经把 DOM 与 WebWorker lib 都加进去（lib 之间不互斥，只是把全局类型并集放进去）。subpath 隔离仍由 `package.json#exports` 在消费端保证（`@steed/api/server` 不会去 import `@steed/api/client`）。
- 各子包原有 `tsconfig.json` **保持不变**，便于将来用 `bun run --cwd packages/<name> typecheck` 单独跑（如果需要更严格的 lib 隔离）。
- `apps/web_legacy/tsconfig.json` 不变（仍是 Next 的 tsconfig），完全隔离在子包内，不进入根 include / 不被根 lint / 不被根 vitest workspace。

> v4 取消 v2 的 client/server tsconfig 物理拆分。理由：根 tsconfig 一次性提供 DOM + WebWorker lib 后，subpath import 边界由运行时（Vite 走 client、Wrangler 走 server）和 `package.json#exports` 字段保证；类型层不再需要两份 tsconfig。如未来出现"client 代码意外用了 Workers-only API"或反向情况，再单独引入子包级 tsconfig 拆分（属于改进性优化，不属于 Phase F 必做）。

### 8.3 ESLint

- 根 `eslint.config.*` 在 `ignores` 增 `apps/web_legacy/**`。
- React 规则在 `apps/web` 局部：`apps/web/eslint.config.ts` 引 `eslint-plugin-react-hooks` recommended。
- typescript-eslint `parserOptions.project` 增 `packages/api/tsconfig.json` 与 `apps/web/tsconfig.json`。

### 8.4 测试 / 覆盖率

- `vitest.workspace.ts` 显式列 `packages/shared`、`packages/worker`、`packages/cli`、`packages/api`、`apps/web`；不含 `apps/web_legacy`。
- `vitest.config.ts` `coverage.include` 改为 `["packages/*/src/**/*.{ts,tsx}", "apps/web/src/**/*.{ts,tsx}"]`，`exclude` 增 `"apps/web_legacy/**"`。
- `scripts/check-coverage.ts` 阈值不变（lines/statements 90、functions/branches 85）。
- L2 E2E：现有 `scripts/run-e2e.ts` 只测 `packages/worker`，本阶段不变。`apps/web` ↔ `packages/api` ↔ `packages/worker` 的 E2E 留给后续。

### 8.5 CI

- `.github/workflows/ci.yml`：`test-command` 简化为 `"bun run test"`；`typecheck-command` 简化为 `"bun run typecheck"`（依赖 §8.2 的 root include-based `tsc --noEmit`）；`l2-command` 不变。
- 不在 CI 跑 `wrangler deploy`；按 `CLAUDE.md`，部署是手动 `wrangler deploy`。

### 8.6 部署

- 上游 `packages/worker` 部署不变。
- `apps/web` 部署：
  1. `bun run --cwd apps/web build` → `apps/web/dist/`
  2. `bun run --cwd apps/web deploy` → `wrangler deploy`
  3. CF Dashboard → Access → 应用域名绑定 application 配 `aud=a920d3...`，team `nocoo`。

---

## 9. 数据流（端到端）

> **凭证模型**：浏览器只持有 Cloudflare Access 会话 cookie（`CF_Authorization`，由 Access 团队登录页种下，httpOnly + same-site）。前端 JS **从不读、不写、不显式附带** `Cf-Access-Jwt-Assertion` —— 该 header 由 Cloudflare 边缘在转发到 Worker 前根据 cookie 注入。Worker 看到的请求里有 header，浏览器开发者工具 Network 面板里看不到（它在边缘上才出现）。

```
Browser
  │  GET /agents?host_id=...
  │  Cookie: CF_Authorization=<opaque>
  ▼
Cloudflare Edge (Access)
  │  校验 CF_Authorization → 通过
  │  注入 Cf-Access-Jwt-Assertion: <signed JWT> 到转发请求
  │  （未通过则直接返回 Access 登录页 HTML，请求不到达 Worker）
  ▼
apps/web Worker
  │  verifyAccessJwt(req) 读 Cf-Access-Jwt-Assertion → ok, user
  │  url.pathname === "/agents" → assets.fetch(req) → SPA index.html
  ▼
Browser (SPA hydrate)
  │  React Router 渲染 /agents
  │  useAgentsViewModel → apiClient.agents.list({...})
  │  fetch("/api/agents?host_id=...")  // same-origin，浏览器自动带 CF_Authorization cookie
  ▼
Cloudflare Edge (Access)
  │  cookie 校验 → 注入 Cf-Access-Jwt-Assertion
  ▼
apps/web Worker
  │  verifyAccessJwt → ok
  │  pathname /api/* → router.fetch
  │  agents.list handler → workerClient.get("/api/v1/agents?...")
  ▼
packages/worker (D1 API)
  │  Authorization: Bearer DASHBOARD_SERVICE_TOKEN
  │  D1 query
  ▼
Response 200 JSON ──◄ 原路返回
```

**责任边界**：
- **浏览器**：仅持有 `CF_Authorization` cookie；不感知 JWT 的存在。
- **Cloudflare 边缘**：把 cookie 校验为 Access 会话 → 注入 `Cf-Access-Jwt-Assertion` header；这一步在 Worker 之外、不可绕过（前提是 DNS/Access policy 配对）。
- **apps/web Worker**：只读 `Cf-Access-Jwt-Assertion`，本地用公钥验签 + aud/iss 校验；不读 cookie。
- **packages/worker**：完全不知道 CF Access；只认 `Authorization: Bearer DASHBOARD_SERVICE_TOKEN`。

---

## 10. 验收条件

- [ ] 24 个 commit 入 main，且 `git log --oneline` 与 §7.1 表对齐。
- [ ] `bun run typecheck && bun run lint && bun run test` 全绿；coverage ≥ 阈值。覆盖率统计自动包含 `packages/api`、`apps/web`，自动不含 `apps/web_legacy`。
- [ ] `bun run --cwd apps/web build` 成功；`wrangler deploy` 部署后 `https://<域名>/overview` 经 CF Access 登录后能展示 4 个统计卡。
- [ ] 7 个业务页面在生产环境逐一手动走查，与 legacy 行为一致（截图归档至本文件末尾）。
- [ ] `apps/web_legacy` 仍可本地启动（`bun run --cwd apps/web_legacy dev`），但默认 CI/test 链路不再跑它。
- [ ] 文档状态从 📝 DESIGN v4 改为 ✅ COMPLETED。

---

## 11. 风险与待决策

### R1 — CLI OAuth 链路无替代

`packages/cli` 的 `steed login` 命令依赖 legacy `/api/auth/cli` 端点完成 Google OAuth + 取 Host API Key。把 dashboard 改名为 web_legacy 但**不部署**，CLI 该端点就拿不到。

**当前决策（保守）**：本阶段保留 `apps/web_legacy` 代码与本地运行能力；`steed login` 暂时要求用户在本地起 web_legacy。后续阶段单独设计 CLI 的 device flow / Personal Access Token，与 CF Access 解耦。

**待您确认**：是否接受此过渡安排？

### R2 — `/api/me` 端点是否需要

CF Access 在 Worker 入口已识别用户 email；要不要在 SPA 右上角显示登录用户？  
**当前决策**：不显示（YAGNI）。后续如有需要再加 1 行 handler + 1 个组件。

### R3 — Static Assets 还是 Pages

CF 三种托管方式：
- Workers Static Assets（本设计选用）—— 同一 Worker 服务 assets + fetch，单部署最简。
- Pages + Pages Functions —— 部署体验好但与 Worker secret/绑定割裂。
- Workers Sites（KV）—— 已被 Static Assets 取代，不推荐。

代价：`compatibility_date >= 2024-09-01`、`not_found_handling` 在 free plan 也支持。

### R4 — 上游 worker URL 是否同源

新 `apps/web` Worker 调用 `packages/worker` 仍走公网（`WORKER_API_URL`）。可选优化：Service Bindings 直连。  
**本设计不做**：会改 worker 部署形态，脱离 §1.2 约束。

### R5 — Access JWT 验签库

`jose` 在 Workers 上需要 `nodejs_compat`，已开。如 bundle 大于 1MB 可换 `@tsndr/cloudflare-worker-jwt`。  
**当前决策**：用 `jose`。

---

## 12. Out-of-document（不在本阶段执行）

- 删除 `apps/web_legacy`（待 R1 解决后单独 PR）。
- CLI 登录改造（PAT / device flow）。
- L3 Playwright 在新 web 上的覆盖。
- L2 E2E 链路把 `apps/web` 也纳入。
- Service Bindings 优化 worker→worker 调用。
- Observability：结构化日志/指标。
