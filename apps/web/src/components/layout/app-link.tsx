import { Link } from "react-router";
import type { AnchorHTMLAttributes, ReactNode } from "react";

const EXTERNAL = /^(https?:|mailto:|tel:)/;

export function AppLink({
  href,
  className,
  children,
  ...props
}: {
  href: string;
  className?: string;
  children?: ReactNode;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  if (EXTERNAL.test(href)) {
    return (
      <a href={href} className={className} {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={className} {...props}>
      {children}
    </Link>
  );
}
