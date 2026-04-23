"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
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
              <svg className="h-[18px] w-[18px]" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
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
