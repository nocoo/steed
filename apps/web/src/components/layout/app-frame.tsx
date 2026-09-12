import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Menu } from "lucide-react";
import {
  Button,
  ContentIsland,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  ThemeToggle,
} from "@nocoo/basalt";
import { LinkButton } from "@nocoo/basalt/components/button";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import { AppMain, AppShell, AppSkipLink } from "@nocoo/basalt/components/app-shell";
import { useTheme } from "@nocoo/basalt/providers/theme";
import { useMobile } from "@/hooks/use-mobile";
import { getHeaderTrail } from "@/lib/navigation";
import { AppSidebar } from "./app-sidebar";

const STORAGE_KEY = "sidebar-expanded";

export function AppFrame() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "false";
    } catch {
      return false;
    }
  });
  const isMobile = useMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { theme } = useTheme();
  const { breadcrumbs, title } = getHeaderTrail(location.pathname);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile) {
      setMobileOpen(false);
    }
  }, [isMobile]);

  const onToggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(!next));
    } catch {
      // Navigation must remain usable when browser storage is unavailable.
    }
  };

  return (
    <AppShell>
      <AppSkipLink>Skip to main content</AppSkipLink>
      {isMobile ? null : (
        <AppSidebar collapsed={collapsed} onToggle={onToggleCollapsed} />
      )}
      <Sheet
        open={isMobile ? mobileOpen : false}
        onOpenChange={setMobileOpen}
      >
        {isMobile ? (
          <SheetContent
            side="left"
            className="w-[260px] max-w-[260px] border-0 bg-basalt-background p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <AppSidebar
              collapsed={false}
              onToggle={() => setMobileOpen(false)}
              hideCollapse
            />
          </SheetContent>
        ) : null}
      <AppMain tabIndex={-1}>
        <AppHeader
          leading={
            isMobile ? (
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Open navigation"
                >
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
            ) : null
          }
          breadcrumbs={breadcrumbs}
          title={title}
          actions={
            <>
              <LinkButton
                href="https://github.com/nocoo/steed"
                target="_blank"
                rel="noopener noreferrer"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="GitHub repository"
              >
                <svg
                  className="h-[18px] w-[18px]"
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
              </LinkButton>
              <ThemeToggle aria-label={`Toggle theme (now ${theme})`} />
            </>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
          <ContentIsland>
            <Outlet />
          </ContentIsland>
        </div>
      </AppMain>
      </Sheet>
    </AppShell>
  );
}
