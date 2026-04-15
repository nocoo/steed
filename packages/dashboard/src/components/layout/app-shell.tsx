"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { useMobile } from "@/hooks/use-mobile";
import { Sidebar } from "./sidebar";
import { Breadcrumbs } from "./breadcrumbs";

// Sidebar dimensions (must match sidebar.tsx)
const SIDEBAR_WIDTH_EXPANDED = 260;
const SIDEBAR_WIDTH_COLLAPSED = 68;

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { isExpanded } = useSidebar();
  const isMobile = useMobile();

  // Calculate main content margin based on sidebar state
  const marginLeft = isMobile
    ? 0
    : isExpanded
      ? SIDEBAR_WIDTH_EXPANDED
      : SIDEBAR_WIDTH_COLLAPSED;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      {/* Main content area */}
      <main
        className={cn("flex flex-col transition-all duration-300 ease-in-out")}
        style={{ marginLeft }}
      >
        {/* Header with breadcrumbs */}
        <header
          className={cn(
            "flex h-16 items-center px-4 md:px-6",
            isMobile && "pl-16" // Space for mobile menu button
          )}
        >
          <Breadcrumbs />
        </header>

        {/* Content island */}
        <div className="flex-1 px-2 pb-2 md:px-3 md:pb-3">
          <div className="h-full min-h-[calc(100vh-5rem)] rounded-[16px] bg-card p-3 md:rounded-[20px] md:p-5">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
