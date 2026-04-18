"use client";

import { Toaster as SonnerToaster } from "sonner";

export type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

export function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      theme="system"
      richColors
      closeButton
      position="bottom-right"
      {...props}
    />
  );
}

export { toast } from "sonner";
