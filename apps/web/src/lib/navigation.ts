import {
  LayoutDashboard,
  Server,
  Bot,
  Database,
  Network,
  Shapes,
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
    title: "Workspace",
    items: [{ title: "Diagrams", href: "/diagrams", icon: Shapes }],
  },
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

export function getAllNavItems(): NavItem[] {
  return NAV_GROUPS.flatMap((group) => group.items);
}

export function findNavItemByHref(href: string): NavItem | undefined {
  return getAllNavItems().find((item) => item.href === href);
}

export interface HeaderTrail {
  breadcrumbs: { href?: string; label: string }[];
  title: string;
}

export function getHeaderTrail(pathname: string): HeaderTrail {
  if (pathname.startsWith("/diagrams/")) return { breadcrumbs: [{ href: "/diagrams", label: "Diagrams" }], title: "Architecture diagram" };
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return { breadcrumbs: [], title: "Overview" };
  }

  const crumbs: { href?: string; label: string }[] = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    const href = `/${segments.slice(0, i + 1).join("/")}`;
    const nav = findNavItemByHref(href);
    crumbs.push(nav ? { href, label: nav.title } : { label: href.slice(1) });
  }

  const lastHref = `/${segments.join("/")}`;
  const lastNav = findNavItemByHref(lastHref);
  const title = lastNav ? lastNav.title : String(segments.at(-1));

  if (lastHref === "/overview") {
    return { breadcrumbs: [], title: "Overview" };
  }

  return {
    breadcrumbs: [{ href: "/overview", label: "Overview" }, ...crumbs],
    title,
  };
}
