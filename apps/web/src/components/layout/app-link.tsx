import { Link } from "react-router";
import type { ReactNode } from "react";

const EXTERNAL = /^(https?:|mailto:|tel:)/;

export function AppLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
}) {
  if (EXTERNAL.test(href)) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={className}>
      {children}
    </Link>
  );
}
