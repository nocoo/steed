"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { useMobile } from "@/hooks/use-mobile";
import { NAV_GROUPS } from "@/lib/navigation";
import { APP_VERSION } from "@/lib/version";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Sidebar dimensions
const SIDEBAR_WIDTH_EXPANDED = "260px";
const SIDEBAR_WIDTH_COLLAPSED = "68px";

export function Sidebar() {
  const pathname = usePathname();
  const { isExpanded, isMobileOpen, toggle, closeMobile } =
    useSidebar();
  const isMobile = useMobile();
  const { data: session } = useSession();

  // User info
  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const userImage = session?.user?.image;
  const userInitial = userName[0] ?? "?";

  // On mobile, always show expanded sidebar in overlay
  const showExpanded = isMobile ? true : isExpanded;

  // Flatten nav items for collapsed view
  const allNavItems = NAV_GROUPS.flatMap((g) => g.items);

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile overlay */}
      {isMobile && isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs md:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-full flex-col bg-background transition-all duration-300 ease-in-out",
          isMobile
            ? cn(
                "w-[260px]",
                isMobileOpen ? "translate-x-0" : "-translate-x-full"
              )
            : "translate-x-0"
        )}
        style={{
          width: isMobile
            ? SIDEBAR_WIDTH_EXPANDED
            : showExpanded
              ? SIDEBAR_WIDTH_EXPANDED
              : SIDEBAR_WIDTH_COLLAPSED,
        }}
      >
        {showExpanded ? (
          /* -- Expanded view -- */
          <div className="flex h-full w-[260px] flex-col">
            {/* Header: logo + collapse toggle */}
            <div className="flex h-14 items-center px-3">
              <div className="flex w-full items-center justify-between px-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <span className="text-sm font-bold">S</span>
                  </div>
                  <span className="text-lg font-semibold text-foreground">
                    Steed
                  </span>
                  <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground leading-none">
                    v{APP_VERSION}
                  </span>
                </div>
                {!isMobile && (
                  <button
                    onClick={toggle}
                    aria-label="Collapse sidebar"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <ChevronLeft
                      className="h-4 w-4"
                      aria-hidden="true"
                      strokeWidth={1.5}
                    />
                  </button>
                )}
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto px-3 py-2">
              {NAV_GROUPS.map((group) => (
                <div key={group.title} className="mb-4">
                  <h3 className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                    {group.title}
                  </h3>
                  <ul className="flex flex-col gap-0.5">
                    {group.items.map((item) => {
                      const isActive = pathname === item.href;
                      return (
                        <li key={item.href}>
                          <NavLink
                            href={item.href}
                            icon={item.icon}
                            title={item.title}
                            isActive={isActive}
                            isExpanded={true}
                            {...(isMobile && { onClick: closeMobile })}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>

            {/* User info + sign out */}
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 shrink-0">
                  {userImage && <AvatarImage src={userImage} alt={userName} />}
                  <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                    {userInitial}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {userName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {userEmail}
                  </p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => signOut({ callbackUrl: "/login" })}
                      aria-label="Sign out"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                    >
                      <LogOut
                        className="h-4 w-4"
                        aria-hidden="true"
                        strokeWidth={1.5}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Sign out</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        ) : (
          /* -- Collapsed (icon-only) view -- */
          <div className="flex h-full w-[68px] flex-col items-center">
            {/* Logo */}
            <div className="flex h-14 w-full items-center justify-start pl-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <span className="text-sm font-bold">S</span>
              </div>
            </div>

            {/* Expand toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggle}
                  aria-label="Expand sidebar"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mb-2"
                >
                  <ChevronRight
                    className="h-4 w-4"
                    aria-hidden="true"
                    strokeWidth={1.5}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Expand sidebar
              </TooltipContent>
            </Tooltip>

            {/* Navigation — flattened icon-only list */}
            <nav className="flex-1 flex flex-col items-center gap-1 overflow-y-auto pt-1">
              {allNavItems.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;

                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.href}
                        className={cn(
                          "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                          isActive
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.5} />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {item.title}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </nav>

            {/* User avatar + sign out */}
            <div className="py-3 flex justify-center w-full">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="cursor-pointer"
                  >
                    <Avatar className="h-9 w-9">
                      {userImage && (
                        <AvatarImage src={userImage} alt={userName} />
                      )}
                      <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                        {userInitial}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {userName} · Click to sign out
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}
      </aside>
    </TooltipProvider>
  );
}

interface NavLinkProps {
  href: string;
  icon: LucideIcon;
  title: string;
  isActive: boolean;
  isExpanded: boolean;
  onClick?: () => void;
}

function NavLink({
  href,
  icon: Icon,
  title,
  isActive,
  isExpanded,
  onClick,
}: NavLinkProps) {
  return (
    <Link
      href={href}
      {...(onClick && { onClick })}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors",
        isActive
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        !isExpanded && "justify-center"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
      {isExpanded && <span className="flex-1 text-left truncate">{title}</span>}
    </Link>
  );
}
