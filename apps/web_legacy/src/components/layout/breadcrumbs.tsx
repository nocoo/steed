"use client";

import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { findNavItemByHref } from "@/lib/navigation";

export function Breadcrumbs() {
  const pathname = usePathname();

  // Build breadcrumb segments from pathname
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const breadcrumbs = segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/");
    const navItem = findNavItemByHref(href);
    const title = navItem?.title ?? formatSegment(segment);
    const isLast = index === segments.length - 1;

    return { href, title, isLast };
  });

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-sm text-muted-foreground"
    >
      <Link
        href="/overview"
        className="flex items-center hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
      </Link>
      {breadcrumbs.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-1">
          <ChevronRight className="h-4 w-4" />
          {crumb.isLast ? (
            <span className="text-foreground font-medium">{crumb.title}</span>
          ) : (
            <Link
              href={crumb.href}
              className="hover:text-foreground transition-colors"
            >
              {crumb.title}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

function formatSegment(segment: string): string {
  // Convert kebab-case to Title Case
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
