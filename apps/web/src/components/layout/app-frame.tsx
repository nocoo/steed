import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { PanelLeftOpen } from "lucide-react";
import {
  Button,
  ContentIsland,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SidebarProvider,
} from "@nocoo/basalt";
import { AppHeader, AppHeaderMenuButton, ProjectLinks } from "@nocoo/basalt/components/app-header";
import { AppMain, AppShell, AppSkipLink } from "@nocoo/basalt/components/app-shell";
import { ThemeToggle } from "@nocoo/basalt/components/theme-toggle";
import { useMobile } from "@/hooks/use-mobile";
import { getAppHeaderBreadcrumbs } from "@/lib/navigation";
import { AppSidebar } from "./app-sidebar";
import {
  TopologyNavigationProvider,
  type TopologyNavigationState,
} from "./topology-navigation-context";

const STORAGE_KEY = "sidebar-expanded";
const TOPOLOGY_NAV_STORAGE_KEY = "steed-topology-nav";
const MOBILE_SHEET_ID = "steed-mobile-navigation-sheet";

function readTopologyNavigation(): TopologyNavigationState {
  try {
    const value = localStorage.getItem(TOPOLOGY_NAV_STORAGE_KEY);
    return value === "rail" || value === "hidden" || value === "expanded" ? value : "rail";
  } catch {
    return "rail";
  }
}

function writeTopologyNavigation(state: TopologyNavigationState) {
  try {
    localStorage.setItem(TOPOLOGY_NAV_STORAGE_KEY, state);
  } catch {
    // Navigation remains usable when browser storage is unavailable.
  }
}

export function AppFrame() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "false";
    } catch {
      return false;
    }
  });
  const [topologyNavigation, setTopologyNavigation] = useState<TopologyNavigationState>(readTopologyNavigation);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const hiddenPrevious = useRef<TopologyNavigationState>("rail");
  const revealFocusRequested = useRef(false);
  const hiddenFocusRequested = useRef(false);
  const hiddenRevealRef = useRef<HTMLButtonElement>(null);
  const suppressRevealRailFocus = useRef(false);
  const isMobile = useMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const pathname = location.pathname;
  const headerBreadcrumbs = getAppHeaderBreadcrumbs(pathname, isMobile);
  const topologyPage = pathname === "/topology";
  const effectiveTopologyNavigation = fullscreenActive ? "hidden" : topologyNavigation;
  const workspace = topologyPage;

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!topologyPage) setFullscreenActive(false);
  }, [topologyPage]);

  useEffect(() => {
    if (fullscreenActive) setMobileOpen(false);
  }, [fullscreenActive]);

  const onGlobalCollapsedChange = useCallback((nextCollapsed: boolean) => {
    setCollapsed(nextCollapsed);
    try {
      localStorage.setItem(STORAGE_KEY, String(!nextCollapsed));
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
  }, []);

  const setTopologyState = useCallback((next: TopologyNavigationState) => {
    setTopologyNavigation(next);
    writeTopologyNavigation(next);
  }, []);

  const onTopologyCollapsedChange = useCallback(
    (nextCollapsed: boolean) => {
      setTopologyState(nextCollapsed ? "rail" : "expanded");
    },
    [setTopologyState],
  );

  const toggleHidden = useCallback((moveFocus = false) => {
    if (fullscreenActive) return;
    setTopologyNavigation((current) => {
      if (current === "hidden") {
        const next = hiddenPrevious.current === "rail" || hiddenPrevious.current === "expanded"
          ? hiddenPrevious.current
          : "rail";
        revealFocusRequested.current = moveFocus;
        hiddenFocusRequested.current = false;
        writeTopologyNavigation(next);
        return next;
      }
      hiddenPrevious.current = current;
      hiddenFocusRequested.current = moveFocus;
      revealFocusRequested.current = false;
      writeTopologyNavigation("hidden");
      return "hidden";
    });
  }, [fullscreenActive]);

  const toggleExpanded = useCallback(() => {
    setTopologyNavigation((current) => {
      const next: TopologyNavigationState = current === "expanded" ? "rail" : current === "rail" ? "expanded" : "rail";
      writeTopologyNavigation(next);
      return next;
    });
  }, []);

  const revealRail = useCallback((moveFocus = false) => {
    if (fullscreenActive) return;
    revealFocusRequested.current = moveFocus;
    setTopologyState("rail");
  }, [fullscreenActive, setTopologyState]);

  useEffect(() => {
    if (hiddenFocusRequested.current && effectiveTopologyNavigation === "hidden") {
      hiddenFocusRequested.current = false;
      suppressRevealRailFocus.current = true;
      hiddenRevealRef.current?.focus();
      return;
    }
    if (!revealFocusRequested.current) return;
    if (effectiveTopologyNavigation === "rail" || effectiveTopologyNavigation === "expanded") {
      revealFocusRequested.current = false;
      const toggle = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand sidebar"], button[aria-label="Collapse sidebar"]',
      );
      toggle?.focus();
    }
  }, [effectiveTopologyNavigation]);

  useEffect(() => {
    if (!topologyPage || isMobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "\\" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      toggleHidden(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [topologyPage, isMobile, toggleHidden]);

  const navigation = useMemo(() => ({
    state: effectiveTopologyNavigation,
    fullscreenActive,
    toggleHidden,
    toggleExpanded,
    revealRail,
    setFullscreenActive,
  }), [effectiveTopologyNavigation, fullscreenActive, toggleHidden, toggleExpanded, revealRail]);

  const showDesktopSidebar = !isMobile && !(topologyPage && effectiveTopologyNavigation === "hidden");
  const topologySidebarCollapsed = effectiveTopologyNavigation === "rail";

  return (
    <TopologyNavigationProvider value={navigation}>
      <AppShell>
        <AppSkipLink>Skip to main content</AppSkipLink>
        {!isMobile && topologyPage && effectiveTopologyNavigation === "hidden" && !fullscreenActive ? (
          <Button
            variant="ghost"
            size="icon"
            ref={hiddenRevealRef}
            aria-label="Reveal navigation"
            title="Reveal navigation"
            className="fixed left-0 top-1/2 z-50 h-12 w-4 -translate-y-1/2 rounded-l-none rounded-r-md border border-l-0 border-basalt-border bg-basalt-card p-0 shadow-sm"
            onMouseEnter={() => revealRail(false)}
            onFocus={() => {
              if (suppressRevealRailFocus.current) {
                suppressRevealRailFocus.current = false;
                return;
              }
              revealRail(true);
            }}
            onClick={() => revealRail(true)}
          >
            <PanelLeftOpen className="h-3 w-3" aria-hidden="true" />
          </Button>
        ) : null}
        {showDesktopSidebar ? (
          topologyPage ? (
            <SidebarProvider
              collapsed={topologySidebarCollapsed}
              onCollapsedChange={onTopologyCollapsedChange}
              defaultWidth={260}
            >
              <AppSidebar ariaLabel="Main navigation" />
            </SidebarProvider>
          ) : (
            <SidebarProvider
              collapsed={collapsed}
              onCollapsedChange={onGlobalCollapsedChange}
              defaultWidth={260}
            >
              <AppSidebar ariaLabel="Main navigation" />
            </SidebarProvider>
          )
        ) : null}

        {isMobile ? (
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent
              id={MOBILE_SHEET_ID}
              side="left"
              className="w-[260px] max-w-[260px] border-0 bg-basalt-background p-0 sm:max-w-[260px] sm:p-0"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                menuButton.current?.focus();
              }}
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
                <SheetDescription>Browse Steed workspace pages</SheetDescription>
              </SheetHeader>
              <SidebarProvider collapsed={false} defaultWidth={260}>
                <AppSidebar
                  ariaLabel="Navigation"
                  variant="mobile"
                  onNavigate={() => setMobileOpen(false)}
                  onDismiss={() => setMobileOpen(false)}
                />
              </SidebarProvider>
            </SheetContent>
          </Sheet>
        ) : null}

        <AppMain tabIndex={-1}>
          <AppHeader
            density={workspace ? "compact" : "comfortable"}
            leading={
              isMobile && !fullscreenActive ? (
                <AppHeaderMenuButton
                  ref={menuButton}
                  label="Open navigation"
                  aria-expanded={mobileOpen}
                  aria-haspopup="dialog"
                  aria-controls={mobileOpen ? MOBILE_SHEET_ID : undefined}
                  onClick={() => setMobileOpen(true)}
                />
              ) : null
            }
            breadcrumbs={headerBreadcrumbs}
            breadcrumbsLabel="Breadcrumb"
            actions={
              <>
                <ProjectLinks
                  github="nocoo/steed"
                  hexly="steed"
                  name="Steed"
                  githubLabel="GitHub repository"
                  hexlyLabel="Steed on hexly.ai"
                />
                <ThemeToggle aria-label="Toggle theme" />
              </>
            }
          />
          <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
            <ContentIsland className={workspace ? "flex flex-col md:p-3 lg:px-3" : undefined}>
              <Outlet />
            </ContentIsland>
          </div>
        </AppMain>
      </AppShell>
    </TopologyNavigationProvider>
  );
}
