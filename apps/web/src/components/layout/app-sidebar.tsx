import { useLocation, useNavigate } from "react-router";
import { PanelLeft } from "lucide-react";
import {
  Button,
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarPartition,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nocoo/basalt";
import { APP_VERSION } from "@/lib/version";
import { NAV_GROUPS, getAllNavItems } from "@/lib/navigation";

const LOGO_SLOT_CLASS =
  "flex h-14 w-[68px] shrink-0 items-center justify-center";

function LogoSlot() {
  return (
    <div data-sidebar-logo-slot="" className={LOGO_SLOT_CLASS}>
      <img
        src="/logo-24.png"
        alt="Steed"
        width={24}
        height={24}
        className="shrink-0"
      />
    </div>
  );
}

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  hideCollapse?: boolean;
}

export function AppSidebar({
  collapsed,
  onToggle,
  hideCollapse = false,
}: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const items = getAllNavItems();

  const go = (href: string) => {
    navigate(href);
    if (hideCollapse) onToggle();
  };

  return (
    <Sidebar collapsed={collapsed}>
      <SidebarHeader className="px-0">
        {collapsed ? (
          <LogoSlot />
        ) : (
          <div className="flex w-full min-w-0 items-center">
            <LogoSlot />
            <div className="flex min-w-0 flex-1 items-center justify-between pr-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="truncate text-lg font-semibold text-basalt-foreground md:text-xl">
                  Steed
                </span>
                <span className="shrink-0 rounded-md bg-basalt-secondary px-1.5 py-0.5 font-mono text-[10px] leading-none font-medium text-basalt-muted-foreground">
                  v{APP_VERSION}
                </span>
              </div>
              {hideCollapse ? null : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={onToggle}
                  aria-label="Collapse sidebar"
                >
                  <PanelLeft aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        )}
      </SidebarHeader>

      {collapsed ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="mb-1 self-center"
            onClick={onToggle}
            aria-label="Expand sidebar"
          >
            <PanelLeft aria-hidden="true" />
          </Button>
          <SidebarNav className="w-full items-center gap-1 pt-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <SidebarIconItem
                      active={pathname === item.href}
                      aria-label={item.title}
                      className="self-center"
                      onClick={() => go(item.href)}
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.5} />
                    </SidebarIconItem>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {item.title}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </SidebarNav>
          <SidebarFooter className="flex w-full justify-center px-0" />
        </>
      ) : (
        <>
          <SidebarNav className="pt-1">
            {NAV_GROUPS.map((group) => (
              <div key={group.title}>
                <SidebarPartition>{group.title}</SidebarPartition>
                <div className="flex flex-col gap-0.5 px-3">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <SidebarItem
                        key={item.href}
                        active={pathname === item.href}
                        onClick={() => go(item.href)}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                        <span className="flex-1 truncate text-left">
                          {item.title}
                        </span>
                      </SidebarItem>
                    );
                  })}
                </div>
              </div>
            ))}
          </SidebarNav>
          <SidebarFooter>
            <div className="text-center text-xs text-basalt-muted-foreground">
              Steed v{APP_VERSION}
            </div>
          </SidebarFooter>
        </>
      )}
    </Sidebar>
  );
}
