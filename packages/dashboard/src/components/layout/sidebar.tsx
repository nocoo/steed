"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { useMobile } from "@/hooks/use-mobile";
import { NAV_GROUPS } from "@/lib/navigation";
import { ThemeToggle } from "./theme-toggle";
import { APP_VERSION } from "@/lib/version";

// Sidebar dimensions
const SIDEBAR_WIDTH_EXPANDED = "260px";
const SIDEBAR_WIDTH_COLLAPSED = "68px";

export function Sidebar() {
  const pathname = usePathname();
  const { isExpanded, isMobileOpen, toggle, toggleMobile, closeMobile } =
    useSidebar();
  const isMobile = useMobile();

  // On mobile, always show expanded sidebar in overlay
  const showExpanded = isMobile ? true : isExpanded;

  return (
    <>
      {/* Mobile toggle button */}
      {isMobile && (
        <button
          onClick={toggleMobile}
          className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-card text-foreground shadow-md md:hidden"
          aria-label="Toggle menu"
        >
          {isMobileOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </button>
      )}

      {/* Mobile overlay */}
      {isMobile && isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 flex h-full flex-col bg-card transition-all duration-300 ease-in-out",
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
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 px-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <span className="text-lg font-bold">S</span>
          </div>
          {showExpanded && (
            <span className="text-lg font-semibold text-foreground">Steed</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-6">
              {showExpanded && (
                <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </h3>
              )}
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <NavLink
                        href={item.href}
                        icon={item.icon}
                        title={item.title}
                        isActive={isActive}
                        isExpanded={showExpanded}
                        {...(isMobile && { onClick: closeMobile })}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-4">
          <div
            className={cn(
              "flex items-center",
              showExpanded ? "justify-between" : "justify-center"
            )}
          >
            {showExpanded && (
              <span className="text-xs text-muted-foreground">
                v{APP_VERSION}
              </span>
            )}
            <div className="flex items-center gap-2">
              <ThemeToggle />
              {/* Desktop collapse toggle */}
              {!isMobile && (
                <button
                  onClick={toggle}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
                >
                  {isExpanded ? (
                    <ChevronLeft className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
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
        "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        !isExpanded && "justify-center"
      )}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      {isExpanded && <span className="truncate">{title}</span>}
    </Link>
  );
}
