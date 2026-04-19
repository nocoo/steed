import {
  LayoutDashboard,
  Server,
  Bot,
  Database,
  Network,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Dashboard",
    items: [
      {
        title: "Overview",
        href: "/overview",
        icon: LayoutDashboard,
      },
      {
        title: "Map",
        href: "/map",
        icon: Network,
      },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      {
        title: "Hosts",
        href: "/hosts",
        icon: Server,
      },
      {
        title: "Agents",
        href: "/agents",
        icon: Bot,
      },
      {
        title: "Data Sources",
        href: "/data-sources",
        icon: Database,
      },
    ],
  },
];

/**
 * Get all navigation items as a flat array
 */
export function getAllNavItems(): NavItem[] {
  return NAV_GROUPS.flatMap((group) => group.items);
}

/**
 * Find a nav item by its href
 */
export function findNavItemByHref(href: string): NavItem | undefined {
  return getAllNavItems().find((item) => item.href === href);
}
