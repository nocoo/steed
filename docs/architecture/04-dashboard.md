# Dashboard 架构与实现

> Phase C: Dashboard Bootstrap + Google Auth + 基础架构

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
│   │   │   └── auth/[...nextauth]/route.ts
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
│   │   ├── api.ts           # Worker API client
│   │   ├── navigation.ts    # Pure data, no React
│   │   ├── utils.ts         # cn() helper
│   │   └── version.ts       # APP_VERSION from env
│   ├── viewmodels/          # MVVM pattern
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

## 5. MVVM 架构

### 5.1 层级划分

```
┌─────────────────────────────────────┐
│               View                  │
│  React Components (pages, widgets)  │
├─────────────────────────────────────┤
│            ViewModel                │
│  useXxxViewModel() hooks            │
│  State management + business logic  │
├─────────────────────────────────────┤
│              Model                  │
│  lib/api.ts (Worker API client)     │
│  Type definitions (@steed/shared)   │
└─────────────────────────────────────┘
```

### 5.2 ViewModel 示例

```typescript
// src/viewmodels/useHostsViewModel.ts
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { Host } from "@steed/shared";

interface HostsViewModelState {
  hosts: Host[];
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
    api.hosts.list()
      .then((hosts) => setState({ hosts, loading: false, error: null }))
      .catch((err) => setState({ hosts: [], loading: false, error: err.message }));
  }, []);

  return state;
}
```

### 5.3 测试策略

| 层级 | 测试类型 | 覆盖目标 |
|------|---------|---------|
| ViewModel | Unit (Vitest) | 业务逻辑、状态转换 |
| Components | Unit (Testing Library) | 渲染、交互 |
| Integration | E2E (Playwright) | 关键用户流程 |

## 6. 6DQ 质量框架

### 6.1 测试门禁

| Dimension | Tool | Gate | Target |
|-----------|------|------|--------|
| L1 Unit | Vitest + coverage ≥ 90% | pre-commit | ViewModel + utils |
| L2 Integration | (Dashboard 端暂无 E2E) | — | — |
| L3 System | Playwright | on-demand | Login flow, 核心页面 |
| G1 Static | tsc strict + ESLint --max-warnings=0 | pre-commit | Zero warnings |

### 6.2 pre-commit Hook

```bash
#!/bin/sh
set -e
echo "🔍 Running pre-commit checks..."
bun run --cwd packages/dashboard typecheck &
bun run --cwd packages/dashboard lint &
bun run --cwd packages/dashboard test &
wait
echo "✅ All pre-commit checks passed"
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

### Phase C-4: Worker API 集成 (Commit 38-40)

**Commit 38: API Client**
```
src/lib/api.ts            # fetch wrapper + DASHBOARD_SERVICE_TOKEN
```

**Commit 39: Hosts ViewModel + Page**
```
src/viewmodels/useHostsViewModel.ts
src/app/(dashboard)/hosts/page.tsx
```

**Commit 40: ViewModel 单元测试**
```
src/viewmodels/__tests__/useHostsViewModel.test.ts
```

## 8. 后续 Features

完成 Phase C 基础架构后，按以下顺序实现功能：

| Phase | Feature | 说明 |
|-------|---------|------|
| D | Hosts 管理 | 列表、详情、API Key 管理 |
| E | Agents 管理 | 列表、详情、元数据编辑、Lane 分配 |
| F | Data Sources 管理 | 列表、详情、Lane 分配 |
| G | Bindings 管理 | 创建/删除绑定关系 |
| H | Overview Dashboard | 统计卡片、状态概览 |

每个 Feature 遵循相同模式：
1. ViewModel (业务逻辑)
2. Page (UI 渲染)
3. Unit Tests (≥90% 覆盖)
4. Atomic Commits

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

### 6DQ 完成标准

- [ ] `bun run typecheck` 零错误
- [ ] `bun run lint` 零警告
- [ ] `bun run test` 覆盖率 ≥ 90%
- [ ] pre-commit hook 正常运行
