import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { Menu, PanelLeftOpen } from "lucide-react";
import {
  Button,
  ContentIsland,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@nocoo/basalt";
import { LinkButton } from "@nocoo/basalt/components/button";
import { AppHeader } from "@nocoo/basalt/components/app-header";
import { AppMain, AppShell, AppSkipLink } from "@nocoo/basalt/components/app-shell";
import { useTheme } from "@nocoo/basalt/providers/theme";
import { useMobile } from "@/hooks/use-mobile";
import { getHeaderTrail } from "@/lib/navigation";
import { HeaderTooltip, HexlyLink } from "./header-links";
import { ThemeToggle } from "./theme-toggle";
import { AppSidebar } from "./app-sidebar";
import {
  TopologyNavigationProvider,
  type TopologyNavigationState,
} from "./topology-navigation-context";

const STORAGE_KEY = "sidebar-expanded";
const TOPOLOGY_NAV_STORAGE_KEY = "steed-topology-nav";

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
  const railExpandRef = useRef<HTMLButtonElement>(null);
  const expandedCollapseRef = useRef<HTMLButtonElement>(null);
  const hiddenRevealRef = useRef<HTMLButtonElement>(null);
  const suppressRevealRailFocus = useRef(false);
  const isMobile = useMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { theme } = useTheme();
  const { breadcrumbs, title } = getHeaderTrail(location.pathname);
  const topologyPage = location.pathname === "/topology";
  const effectiveTopologyNavigation = fullscreenActive ? "hidden" : topologyNavigation;
  const workspace = topologyPage;

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!topologyPage) setFullscreenActive(false);
  }, [topologyPage]);

  useEffect(() => {
    if (fullscreenActive) setMobileOpen(false);
  }, [fullscreenActive]);

  const onToggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(!next));
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
  }, [collapsed]);

  const setTopologyState = useCallback((next: TopologyNavigationState) => {
    setTopologyNavigation(next);
    writeTopologyNavigation(next);
  }, []);

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
    if (effectiveTopologyNavigation === "rail") {
      revealFocusRequested.current = false;
      railExpandRef.current?.focus();
    } else if (effectiveTopologyNavigation === "expanded") {
      revealFocusRequested.current = false;
      expandedCollapseRef.current?.focus();
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
        {isMobile ? null : topologyPage ? (
          effectiveTopologyNavigation === "hidden" ? null : (
            <AppSidebar
              collapsed={effectiveTopologyNavigation === "rail"}
              onToggle={toggleExpanded}
              expandButtonRef={railExpandRef}
              collapseButtonRef={expandedCollapseRef}
            />
          )
        ) : (
          <AppSidebar collapsed={collapsed} onToggle={onToggleCollapsed} />
        )}
        <Sheet open={isMobile ? mobileOpen : false} onOpenChange={setMobileOpen}>
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
              density={workspace ? "compact" : "comfortable"}
              leading={isMobile && !fullscreenActive ? (
                <HeaderTooltip label="Open navigation">
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
                </HeaderTooltip>
              ) : null}
              breadcrumbs={breadcrumbs}
              title={title}
              actions={
                <>
                  <HeaderTooltip label="GitHub repository">
                    <LinkButton
                      href="https://github.com/nocoo/steed"
                      target="_blank"
                      rel="noopener noreferrer"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="GitHub repository"
                    >
                      <svg className="h-[18px] w-[18px]" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                    </LinkButton>
                  </HeaderTooltip>
                  <HexlyLink />
                  <ThemeToggle aria-label={`Toggle theme (now ${theme})`} />
                </>
              }
            />
            <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
              <ContentIsland className={workspace ? "flex flex-col md:p-3 lg:px-3" : undefined}>
                <Outlet />
              </ContentIsland>
            </div>
          </AppMain>
        </Sheet>
      </AppShell>
    </TopologyNavigationProvider>
  );
}
