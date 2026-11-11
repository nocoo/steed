import { useLocation } from "react-router";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Sidebar as BasaltSidebar,
  SidebarBrand,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarToggle,
  SidebarUser,
} from "@nocoo/basalt";
import { useSidebar } from "@nocoo/basalt/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nocoo/basalt/components/tooltip";
import { useProfile } from "@/hooks/use-profile";
import { ACCESS_LOGOUT_URL } from "@/lib/access";
import { NAV_GROUPS, getAllNavItems, isNavActive } from "@/lib/navigation";
import { APP_VERSION } from "@/lib/version";

interface AppSidebarBodyProps {
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
  onDismiss?: () => void;
}

function AppSidebarBody({ variant, onNavigate, onDismiss }: AppSidebarBodyProps) {
  const { pathname } = useLocation();
  const { collapsed } = useSidebar();
  const railCollapsed = collapsed;
  const profile = useProfile();
  const name = profile?.name ?? "User";
  const items = getAllNavItems();

  const avatar = (
    <Avatar className="h-9 w-9 shrink-0">
      {profile?.avatar ? (
        <AvatarImage src={profile.avatar} alt={name} referrerPolicy="no-referrer" />
      ) : null}
      <AvatarFallback className="text-basalt-sm">
        {name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );

  return (
    <>
      <SidebarHeader>
        <SidebarBrand
          logo={<img src="/logo-24.png" alt="Steed" width={24} height={24} />}
          name="Steed"
          version={`v${APP_VERSION}`}
          action={
            variant === "mobile" ? (
              <SidebarToggle
                mode="dismiss"
                dismissLabel="Close navigation"
                {...(onDismiss ? { onDismiss } : {})}
              />
            ) : (
              <SidebarToggle expandLabel="Expand sidebar" collapseLabel="Collapse sidebar" />
            )
          }
        />
      </SidebarHeader>
      <SidebarNav>
        {railCollapsed
          ? items.map((item) => {
              const Icon = item.icon;
              const active = isNavActive(pathname, item.href);
              return (
                <Tooltip key={item.href} delayDuration={0}>
                  <TooltipTrigger asChild>
                    <SidebarIconItem
                      href={item.href}
                      active={active}
                      aria-label={item.title}
                      onClick={onNavigate}
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                    </SidebarIconItem>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {item.title}
                  </TooltipContent>
                </Tooltip>
              );
            })
          : NAV_GROUPS.map((group) => (
              <SidebarGroup key={group.title} label={group.title}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavActive(pathname, item.href);
                  return (
                    <SidebarItem
                      key={item.href}
                      href={item.href}
                      active={active}
                      onClick={onNavigate}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span className="flex-1 truncate text-left">{item.title}</span>
                    </SidebarItem>
                  );
                })}
              </SidebarGroup>
            ))}
      </SidebarNav>
      <SidebarFooter>
        <SidebarUser
          name={name}
          email={profile?.email}
          avatar={avatar}
          tooltip={name}
          signOutHref={ACCESS_LOGOUT_URL}
          signOutLabel="Sign out"
        />
      </SidebarFooter>
    </>
  );
}

export interface AppSidebarProps {
  ariaLabel: string;
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
  onDismiss?: () => void;
}

export function AppSidebar({
  ariaLabel,
  variant = "desktop",
  onNavigate,
  onDismiss,
}: AppSidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <BasaltSidebar aria-label={ariaLabel} resizable={false}>
        <AppSidebarBody
          variant={variant}
          {...(onNavigate ? { onNavigate } : {})}
          {...(onDismiss ? { onDismiss } : {})}
        />
      </BasaltSidebar>
    </TooltipProvider>
  );
}
