import { AppFrame } from "@/components/layout/app-frame";
import { ShellProviders } from "@/components/layout/shell-providers";
import { Toaster } from "@/components/ui/sonner";

export function Layout() {
  return (
    <ShellProviders>
      <AppFrame />
      <Toaster />
    </ShellProviders>
  );
}
