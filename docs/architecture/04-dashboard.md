# Dashboard 架构与实现

> Phase C: Dashboard Bootstrap + Google Auth + 基础架构 ✅ COMPLETED

## 1. 技术选型

基于 Basalt 模板规范和 pew 参考实现，Dashboard 采用 **Gen 2 架构**：

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| **Framework** | Next.js | ^16.x | App Router, RSC, Turbopack |
| **Runtime** | Bun | ≥1.0 | Package manager + script runner |
| **Styling** | Tailwind CSS | ^4.x | CSS-first, @theme inline tokens |
| **Components** | Radix UI | ^1.x | Headless primitives |
| **Icons** | Lucide React | ^0.5x | 1.5px stroke, tree-shakable |
| **Charts** | Recharts | ^3.x | 用于后续统计页面 |
| **Auth** | NextAuth v5 | ^5.0.0-beta | Google OAuth, JWT strategy |
| **Deploy** | Railway | — | 独立部署，不绑定 Worker |

### 与 Worker 的关系

```
┌─────────────────────────────────────┐
│       Dashboard (Railway)           │
│    Next.js + Google OAuth           │
│    DASHBOARD_SERVICE_TOKEN          │
└───────────────┬─────────────────────┘
                │ HTTPS (server-side only)
                │ Authorization: Bearer <DASHBOARD_SERVICE_TOKEN>
                ▼
┌─────────────────────────────────────┐
│       CF Worker (API layer)         │
│       D1 database access            │
└─────────────────────────────────────┘
```

- Dashboard 通过 `DASHBOARD_SERVICE_TOKEN` 调用 Worker API
- 浏览器永远不直接访问 Worker（无 CORS 暴露）
- Google OAuth 仅在 Dashboard 层处理，Worker 不知道用户身份

## 2. 目录结构

```
packages/dashboard/
├── public/
│   ├── logo-24.png          # Sidebar logo (24×24)
│   ├── logo-80.png          # Login page (80×80)
│   └── logo-192.png         # Login page 2x Retina (192×192)
├── src/
│   ├── app/
│   │   ├── (dashboard)/     # Route group: authenticated pages
│   │   │   ├── layout.tsx   # AppShell wrapper
│   │   │   ├── overview/    # 首页
│   │   │   ├── hosts/       # Host 列表
│   │   │   ├── agents/      # Agent 列表
│   │   │   ├── data-sources/# Data Source 列表
│   │   │   └── settings/    # 设置页
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── overview/route.ts      # BFF: GET overview stats
│   │   │   ├── hosts/route.ts         # BFF: GET /hosts
│   │   │   ├── agents/route.ts        # BFF: GET /agents
│   │   │   └── data-sources/route.ts  # BFF: GET /data-sources
│   │   ├── login/
│   │   │   └── page.tsx     # B-1 Badge Login
│   │   ├── globals.css      # Basalt design tokens
│   │   ├── icon.png         # Favicon (32×32)
│   │   ├── apple-icon.png   # Apple touch (180×180)
│   │   ├── favicon.ico      # ICO (16+32)
│   │   ├── opengraph-image.png
│   │   └── layout.tsx       # Root layout
│   ├── components/
│   │   ├── layout/
│   │   │   ├── app-shell.tsx
│   │   │   ├── sidebar.tsx
│   │   │   ├── sidebar-context.tsx
│   │   │   ├── breadcrumbs.tsx
│   │   │   └── theme-toggle.tsx
│   │   ├── ui/              # shadcn/ui primitives
│   │   │   ├── avatar.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── skeleton.tsx
│   │   │   └── tooltip.tsx
│   │   └── auth-provider.tsx
│   ├── hooks/
│   │   └── use-mobile.ts
│   ├── lib/
│   │   ├── worker-api.ts    # Server-only Worker API client
│   │   ├── navigation.ts    # Pure data, no React
│   │   ├── utils.ts         # cn() helper
│   │   └── version.ts       # APP_VERSION from env
│   ├── viewmodels/          # Client-side state (calls BFF, not Worker)
│   │   └── (future)
│   └── auth.ts              # NextAuth configuration
├── scripts/
│   └── resize-logos.py      # Logo asset generator
├── logo.png                 # Source logo (2048×2048)
├── .env.local.example
├── next.config.ts
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── vitest.config.ts
```

## 3. Basalt 设计系统对齐

### 3.1 三层亮度架构 (L0 → L1 → L2)

```css
:root {
  /* L0 body */
  --background: 220 14% 94%;
  /* L1 content panel (AppShell island) */
  --card: 220 14% 97%;
  /* L2 inner cards */
  --secondary: 0 0% 100%;
}

.dark {
  --background: 0 0% 9%;
  --card: 0 0% 10.6%;
  --secondary: 0 0% 12.2%;
}
```

### 3.2 核心 Radius Tokens

```css
@theme inline {
  --radius-card: 14px;
  --radius-widget: 10px;
  --radius-island: 20px;
}
```

### 3.3 Sidebar 尺寸标准

- Expanded: `w-[260px]`
- Collapsed: `w-[68px]`
- Transition: `transition-all duration-300 ease-in-out`

### 3.4 AppShell 浮动岛屿模式

```tsx
// Main content floats on bg-background
<div className="flex-1 px-2 pb-2 md:px-3 md:pb-3">
  <div className="h-full rounded-[16px] md:rounded-[20px] bg-card p-3 md:p-5 overflow-y-auto">
    {children}
  </div>
</div>
```

## 4. Google OAuth 实现

### 4.1 环境变量

```bash
# .env.local.example
AUTH_SECRET=              # openssl rand -base64 32
AUTH_GOOGLE_ID=           # Google OAuth client ID
AUTH_GOOGLE_SECRET=       # Google OAuth client secret
NEXTAUTH_URL=             # https://steed.example.com

# Admin whitelist (comma-separated emails)
ADMIN_EMAILS=alice@example.com,bob@example.com

# Worker API
WORKER_API_URL=           # https://steed-worker.example.workers.dev
DASHBOARD_SERVICE_TOKEN=  # Shared secret with Worker
```

### 4.2 auth.ts 配置

```typescript
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile }) {
      // Whitelist check: only allowed emails can sign in
      const email = profile?.email?.toLowerCase();
      if (!email || !ADMIN_EMAILS.includes(email)) {
        return false; // Reject
      }
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
```

### 4.3 Route Handler

```typescript
// src/app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

### 4.4 AuthProvider

```tsx
// src/components/auth-provider.tsx
"use client";
import { SessionProvider } from "next-auth/react";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

### 4.5 Login Page (B-1 Badge Style)

参考 pew 的 badge-style 登录页：
- 竖版工牌 `w-72` (288px), `rounded-2xl`
- 顶部 `bg-primary` 条带 + 条码装饰
- 中心 logo (96px 容器，192px 2x Retina 图片)
- Google Sign-in 按钮
- 底部安全指示器

## 5. 数据流架构 (BFF 模式)

### 5.1 安全边界

**核心原则：浏览器永远不直接访问 Worker，`DASHBOARD_SERVICE_TOKEN` 永远不暴露到客户端。**

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                         │
│  React Components → useXxxViewModel() → fetch("/api/xxx")       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS (same-origin)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Dashboard Server (Next.js)                    │
│  /app/api/* Route Handlers (BFF layer)                          │
│  ├─ Verify session (NextAuth)                                   │
│  ├─ Call Worker API via lib/worker-api.ts                       │
│  └─ Return sanitized response                                   │
│                                                                 │
│  lib/worker-api.ts (server-only)                                │
│  ├─ DASHBOARD_SERVICE_TOKEN from process.env                    │
│  └─ fetch(WORKER_API_URL + path, { headers: { Authorization } })│
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS (server-to-server)
                            │ Authorization: Bearer <DASHBOARD_SERVICE_TOKEN>
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CF Worker (API layer)                      │
│                      D1 database access                         │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Server-Only Worker API Client

```typescript
// src/lib/worker-api.ts
import "server-only"; // Next.js will error if imported from client

const WORKER_API_URL = process.env.WORKER_API_URL!;
const DASHBOARD_SERVICE_TOKEN = process.env.DASHBOARD_SERVICE_TOKEN!;

async function workerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WORKER_API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${DASHBOARD_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(error.error?.message ?? `Worker API error: ${res.status}`);
  }

  return res.json();
}

export const workerApi = {
  overview: {
    get: () => workerFetch<OverviewResponse>("/api/v1/overview"),
  },
  hosts: {
    // GET /hosts returns HostWithStatus[] directly (no pagination wrapper)
    list: () => workerFetch<HostWithStatus[]>("/api/v1/hosts"),
    get: (id: string) => workerFetch<HostWithStatus>(`/api/v1/hosts/${id}`),
  },
  agents: {
    // GET /agents returns { data, next_cursor } pagination wrapper
    list: (params?: { host_id?: string; status?: string; limit?: number; cursor?: string }) =>
      workerFetch<{ data: AgentListItem[]; next_cursor: string | null }>(
        `/api/v1/agents?${new URLSearchParams(params as Record<string, string>)}`
      ),
  },
  dataSources: {
    // GET /data-sources returns { data, next_cursor } pagination wrapper
    list: (params?: { host_id?: string; limit?: number; cursor?: string }) =>
      workerFetch<{ data: DataSourceListItem[]; next_cursor: string | null }>(
        `/api/v1/data-sources?${new URLSearchParams(params as Record<string, string>)}`
      ),
  },
  lanes: {
    // GET /lanes returns { data } wrapper (no pagination)
    list: () => workerFetch<{ data: Lane[] }>("/api/v1/lanes"),
  },
};
```

### 5.3 BFF Route Handlers

```typescript
// src/app/api/hosts/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // GET /hosts returns HostWithStatus[] directly
    const hosts = await workerApi.hosts.list();
    return NextResponse.json(hosts);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
```

### 5.4 Client ViewModel (调用 BFF，不直接调用 Worker)

```typescript
// src/viewmodels/useHostsViewModel.ts
"use client";
import { useState, useEffect } from "react";
import type { HostWithStatus } from "@steed/shared";

interface HostsViewModelState {
  hosts: HostWithStatus[];
  loading: boolean;
  error: string | null;
}

export function useHostsViewModel() {
  const [state, setState] = useState<HostsViewModelState>({
    hosts: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    // 调用 Dashboard 自己的 BFF API，不是 Worker
    // BFF 返回 HostWithStatus[] 直接数组
    fetch("/api/hosts")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch hosts");
        return res.json();
      })
      .then((hosts: HostWithStatus[]) => setState({ hosts, loading: false, error: null }))
      .catch((err) => setState({ hosts: [], loading: false, error: err.message }));
  }, []);

  return state;
}
```

### 5.5 层级总结

| 层级 | 位置 | 运行环境 | 可访问 Token |
|------|------|---------|-------------|
| View | `src/app/(dashboard)/*/page.tsx` | Client (browser) | ❌ |
| ViewModel | `src/viewmodels/*.ts` | Client (browser) | ❌ |
| BFF | `src/app/api/*/route.ts` | Server (Next.js) | ✅ |
| Worker Client | `src/lib/worker-api.ts` | Server (Next.js) | ✅ |

## 6. 6DQ 质量框架

### 6.1 测试门禁

| Dimension | Tool | Gate | Target |
|-----------|------|------|--------|
| L1 Unit | Vitest + coverage ≥ 90% | pre-commit | ViewModel + utils |
| L2 Integration | (Dashboard 端暂无 E2E) | — | — |
| L3 System | Playwright | on-demand | Login flow, 核心页面 |
| G1 Static | tsc strict + ESLint --max-warnings=0 | pre-commit | Zero warnings |

### 6.2 pre-commit Hook

与 Worker 侧保持一致的稳定写法，分别收集退出码并输出失败原因：

```bash
#!/bin/sh
# Pre-commit hook: G1 + L1 in parallel (<30s target)

set -e

echo "🔍 Running pre-commit checks..."

# Run G1 (typecheck + lint) and L1 (test + coverage) in parallel
bun run --cwd packages/dashboard typecheck &
pid_typecheck=$!

bun run --cwd packages/dashboard lint &
pid_lint=$!

bun run --cwd packages/dashboard test &
pid_test=$!

# Wait for all and collect exit codes
wait $pid_typecheck
exit_typecheck=$?

wait $pid_lint
exit_lint=$?

wait $pid_test
exit_test=$?

# Check coverage after tests complete
if [ $exit_test -eq 0 ]; then
  bun run --cwd packages/dashboard check-coverage
  exit_coverage=$?
else
  exit_coverage=1
fi

# Report results
echo ""
if [ $exit_typecheck -eq 0 ] && [ $exit_lint -eq 0 ] && [ $exit_test -eq 0 ] && [ $exit_coverage -eq 0 ]; then
  echo "✅ All pre-commit checks passed"
  exit 0
else
  echo "❌ Pre-commit checks failed:"
  [ $exit_typecheck -ne 0 ] && echo "   - typecheck failed"
  [ $exit_lint -ne 0 ] && echo "   - lint failed"
  [ $exit_test -ne 0 ] && echo "   - test failed"
  [ $exit_coverage -ne 0 ] && echo "   - coverage below threshold"
  exit 1
fi
```

## 7. 实现计划

### Phase C-1: Bootstrap (Commit 30-32)

**Commit 30: 项目初始化**
```
packages/dashboard/
├── package.json          # Next.js 16, dependencies
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── src/app/
│   ├── globals.css       # Basalt tokens
│   └── layout.tsx        # Root layout + fonts
├── src/lib/utils.ts      # cn() helper
└── logo.png + scripts/resize-logos.py
```

**Commit 31: Gen 2 Layout**
```
src/components/layout/
├── app-shell.tsx
├── sidebar.tsx
├── sidebar-context.tsx
├── breadcrumbs.tsx
└── theme-toggle.tsx
src/lib/navigation.ts
src/hooks/use-mobile.ts
```

**Commit 32: shadcn/ui Primitives**
```
src/components/ui/
├── avatar.tsx
├── badge.tsx
├── button.tsx
├── card.tsx
├── separator.tsx
├── skeleton.tsx
└── tooltip.tsx
```

### Phase C-2: Auth (Commit 33-35)

**Commit 33: NextAuth v5 配置**
```
src/auth.ts               # Google OAuth + whitelist
src/app/api/auth/[...nextauth]/route.ts
src/components/auth-provider.tsx
.env.local.example
```

**Commit 34: Login Page**
```
src/app/login/page.tsx    # B-1 badge style
```

**Commit 35: Route Protection**
```
src/app/(dashboard)/layout.tsx  # Redirect if not authed
```

### Phase C-3: Empty Shell (Commit 36-37)

**Commit 36: Overview Page (空状态)**
```
src/app/(dashboard)/overview/page.tsx
```

**Commit 37: Navigation + Sidebar Links**
```
src/lib/navigation.ts     # NAV_GROUPS 定义
src/components/layout/sidebar.tsx  # 完整导航
```

### Phase C-4: Worker API 集成 (Commit 38-44)

**Commit 38: Server-Only Worker API Client**
```
src/lib/worker-api.ts     # server-only, DASHBOARD_SERVICE_TOKEN
```

**Commit 39: BFF Route Handlers**
```
src/app/api/overview/route.ts      # GET overview stats
src/app/api/hosts/route.ts         # GET /hosts
src/app/api/agents/route.ts        # GET /agents
src/app/api/data-sources/route.ts  # GET /data-sources
src/app/api/lanes/route.ts         # GET /lanes
```

**Commit 40: Overview Page + ViewModel**
```
src/viewmodels/useOverviewViewModel.ts
src/app/(dashboard)/overview/page.tsx  # 统计卡片展示
```

**Commit 41: Hosts Page + ViewModel**
```
src/viewmodels/useHostsViewModel.ts
src/app/(dashboard)/hosts/page.tsx
```

**Commit 42: Agents Page + ViewModel**
```
src/viewmodels/useAgentsViewModel.ts
src/app/(dashboard)/agents/page.tsx
```

**Commit 43: Data Sources Page + ViewModel**
```
src/viewmodels/useDataSourcesViewModel.ts
src/app/(dashboard)/data-sources/page.tsx
```

**Commit 44: ViewModel 单元测试**
```
src/viewmodels/__tests__/useOverviewViewModel.test.ts
src/viewmodels/__tests__/useHostsViewModel.test.ts
src/viewmodels/__tests__/useAgentsViewModel.test.ts
src/viewmodels/__tests__/useDataSourcesViewModel.test.ts
```

### Phase C 完成标准

Phase C 完成后，Dashboard 应具备：
- ✅ 完整的 Gen 2 Layout (AppShell + Sidebar)
- ✅ Google OAuth 登录 + 邮箱白名单
- ✅ 四个核心页面接入真实 Worker 数据：
  - Overview (统计概览)
  - Hosts (Host 列表)
  - Agents (Agent 列表)
  - Data Sources (数据源列表)
- ✅ BFF 安全边界 (Token 不泄漏到客户端)
- ✅ ViewModel 单测 ≥90% 覆盖率

## 8. 后续 Features

完成 Phase C 后，Dashboard 已具备完整的读取链路。后续按以下顺序实现写操作和详情页：

| Phase | Feature | 说明 |
|-------|---------|------|
| D | Hosts 详情 | 单个 Host 详情页、API Key 管理 |
| E | Agents 详情 | 单个 Agent 详情、元数据编辑、Lane 分配 |
| F | Data Sources 详情 | 单个 Data Source 详情、Lane 分配 |
| G | Bindings 管理 | 创建/删除绑定关系 |

每个 Feature 遵循相同模式：
1. BFF Route Handler (server-only Worker 调用)
2. ViewModel (客户端状态管理)
3. Page (UI 渲染)
4. Unit Tests (≥90% 覆盖)
5. Atomic Commits

## 9. Logo 资产管理

遵循 B-3 规范：

```bash
# 运行脚本生成所有派生资产
python scripts/resize-logos.py
```

输出：
- `public/logo-24.png` — Sidebar
- `public/logo-80.png` — 小展示
- `public/logo-192.png` — Login 2x Retina
- `src/app/icon.png` — Favicon 32×32
- `src/app/apple-icon.png` — 180×180
- `src/app/favicon.ico` — 16+32
- `src/app/opengraph-image.png` — 1200×630

## 10. 检查清单

### Bootstrap 完成标准

- [ ] `bun install` 无错误
- [ ] `bun dev` 启动成功
- [ ] 访问 `/` 显示空 Dashboard shell
- [ ] Dark mode toggle 工作
- [ ] Sidebar collapse/expand 工作
- [ ] Mobile responsive 工作

### Auth 完成标准

- [ ] `/login` 显示 badge-style 登录页
- [ ] Google Sign-in 跳转正常
- [ ] 非白名单邮箱被拒绝
- [ ] 登录后跳转到 `/overview`
- [ ] `/overview` 未登录时重定向到 `/login`

### Worker 集成完成标准

- [ ] `lib/worker-api.ts` 使用 `server-only` 标记
- [ ] BFF route handlers 验证 session
- [ ] `/api/overview` 返回 Worker 真实数据
- [ ] `/api/hosts` 返回 Worker 真实数据
- [ ] `/api/agents` 返回 Worker 真实数据
- [ ] `/api/data-sources` 返回 Worker 真实数据
- [ ] 浏览器 Network 面板看不到对 Worker 的直接请求
- [ ] 浏览器看不到 `DASHBOARD_SERVICE_TOKEN`

### 6DQ 完成标准

- [ ] `bun run typecheck` 零错误
- [ ] `bun run lint` 零警告
- [ ] `bun run test` 覆盖率 ≥ 90%
- [ ] pre-commit hook 正常运行
