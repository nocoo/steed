import { AppFrame } from "@/components/layout/app-frame";
import { ShellProviders } from "@/components/layout/shell-providers";
import { Toaster } from "@nocoo/basalt";

export function Layout() {
  return (
    <ShellProviders>
      <AppFrame />
      <Toaster />
    </ShellProviders>
  );
}
