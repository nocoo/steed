import { Network, Plug, type LucideIcon } from "lucide-react";

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
    items: [{ title: "Topology", href: "/topology", icon: Network }, { title: "Connect", href: "/connect", icon: Plug }],
  },
];

export function getAllNavItems(): NavItem[] {
  return NAV_GROUPS.flatMap((group) => group.items);
}

export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function findNavItemByHref(href: string): NavItem | undefined {
  return getAllNavItems().find((item) => item.href === href);
}

export interface HeaderTrail {
  breadcrumbs: { href?: string; label: string }[];
  title: string;
}

export function getHeaderTrail(pathname: string): HeaderTrail {
  if (pathname.startsWith("/topology/")) return { breadcrumbs: [{ href: "/topology", label: "Topology" }], title: "Topology diagram" };
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return { breadcrumbs: [], title: "Steed" };

  const breadcrumbs: { href?: string; label: string }[] = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    const href = `/${segments.slice(0, i + 1).join("/")}`;
    const nav = findNavItemByHref(href);
    breadcrumbs.push(nav ? { href, label: nav.title } : { label: href.slice(1) });
  }

  const lastNav = findNavItemByHref(`/${segments.join("/")}`);
  return { breadcrumbs, title: lastNav ? lastNav.title : String(segments.at(-1)) };
}

export function getAppHeaderBreadcrumbs(
  pathname: string,
  isMobile: boolean,
): { href?: string; label: string }[] {
  const { breadcrumbs, title } = getHeaderTrail(pathname);
  const all = [...breadcrumbs];
  if (title && all.at(-1)?.label !== title) {
    all.push({ label: title });
  }
  return isMobile && all.length > 1 ? all.slice(-1) : all;
}
