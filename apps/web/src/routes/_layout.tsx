import { Outlet } from "react-router";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";

export function Layout() {
  return (
    <SidebarProvider>
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster />
    </SidebarProvider>
  );
}
