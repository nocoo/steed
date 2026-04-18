"use client";

import * as React from "react";
import { Label as RadixLabel } from "radix-ui";

import { cn } from "@/lib/utils";

const Label = React.forwardRef<
  React.ComponentRef<typeof RadixLabel.Root>,
  React.ComponentPropsWithoutRef<typeof RadixLabel.Root>
>(({ className, ...props }, ref) => (
  <RadixLabel.Root
    ref={ref}
    className={cn(
      "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className
    )}
    {...props}
  />
));
Label.displayName = RadixLabel.Root.displayName;

export { Label };
