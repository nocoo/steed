import { useLocation, useNavigate } from "react-router";
import { PanelLeft } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Sidebar,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarUser,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nocoo/basalt";
import { APP_VERSION } from "@/lib/version";
import { NAV_GROUPS, getAllNavItems } from "@/lib/navigation";
import { useProfile } from "@/hooks/use-profile";

function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo-24.png"
      alt="Steed"
      width={24}
      height={24}
      className={className}
    />
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
  const profile = useProfile();
  const name = profile?.name ?? "User";
  const active = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  const avatar = (
    <Avatar className="h-9 w-9 shrink-0" aria-label={name} title={name}>
      {profile?.avatar ? (
        <AvatarImage src={profile.avatar} alt={name} referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback className="bg-basalt-primary/10 text-xs text-basalt-primary">
        {name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );

  const go = (href: string) => {
    navigate(href);
    if (hideCollapse) onToggle();
  };

  return (
    <Sidebar collapsed={collapsed}>
      <SidebarHeader>
        {collapsed ? (
          <BrandMark className="h-6 w-6 shrink-0" />
        ) : (
          <div className="flex w-full min-w-0 items-center justify-between">
            <div className="flex min-w-0 items-center gap-basalt-space-lg">
              <BrandMark className="shrink-0" />
              <span className="truncate text-lg font-semibold text-basalt-foreground md:text-xl">
                Steed
              </span>
              <span className="shrink-0 rounded-md bg-basalt-secondary px-basalt-space-md py-basalt-space-xs font-mono text-[10px] leading-none font-medium text-basalt-muted-foreground">
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
        )}
      </SidebarHeader>

      {collapsed ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="mb-basalt-space-sm self-center"
            onClick={onToggle}
            aria-label="Expand sidebar"
          >
            <PanelLeft aria-hidden="true" />
          </Button>
          <SidebarNav>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <SidebarIconItem
                      active={active(item.href)}
                      aria-label={item.title}
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
          <SidebarFooter>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <span className="inline-flex">{avatar}</span>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {name}
              </TooltipContent>
            </Tooltip>
          </SidebarFooter>
        </>
      ) : (
        <>
          <SidebarNav>
            {NAV_GROUPS.map((group) => (
              <SidebarGroup key={group.title} label={group.title} defaultOpen>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <SidebarItem
                      key={item.href}
                      active={active(item.href)}
                      onClick={() => go(item.href)}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                      <span className="flex-1 truncate text-left">
                        {item.title}
                      </span>
                    </SidebarItem>
                  );
                })}
              </SidebarGroup>
            ))}
          </SidebarNav>
          <SidebarFooter>
            <SidebarUser name={name} email={profile?.email} avatar={avatar} />
          </SidebarFooter>
        </>
      )}
    </Sidebar>
  );
}
