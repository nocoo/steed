"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { useMobile } from "@/hooks/use-mobile";
import { Sidebar } from "./sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { ThemeToggle } from "./theme-toggle";

// Sidebar dimensions (must match sidebar.tsx)
const SIDEBAR_WIDTH_EXPANDED = 260;
const SIDEBAR_WIDTH_COLLAPSED = 68;

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { isExpanded, isMobileOpen, toggleMobile, closeMobile } = useSidebar();
  const isMobile = useMobile();
  const pathname = usePathname();

  // Close mobile sidebar on route change
  useEffect(() => {
    closeMobile();
  }, [pathname, closeMobile]);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileOpen]);

  // Calculate main content margin based on sidebar state
  const marginLeft = isMobile
    ? 0
    : isExpanded
      ? SIDEBAR_WIDTH_EXPANDED
      : SIDEBAR_WIDTH_COLLAPSED;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />

      {/* Main content area */}
      <main
        className="flex flex-1 flex-col min-h-screen min-w-0 transition-all duration-300 ease-in-out"
        style={{ marginLeft }}
      >
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                onClick={toggleMobile}
                aria-label="Open navigation"
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg",
                  "text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                )}
              >
                <Menu className="h-5 w-5" aria-hidden="true" strokeWidth={1.5} />
              </button>
            )}
            <Breadcrumbs />
          </div>
          <div className="flex items-center gap-1">
            <a
              href="https://github.com/niccokunzmann/steed"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <ExternalLink className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.5} />
            </a>
            <ThemeToggle />
          </div>
        </header>

        {/* Floating island content area */}
        <div className="flex-1 px-2 pb-2 md:px-3 md:pb-3">
          <div className="h-full min-h-[calc(100vh-4.5rem)] rounded-[16px] md:rounded-[20px] bg-card p-3 md:p-5 overflow-y-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
