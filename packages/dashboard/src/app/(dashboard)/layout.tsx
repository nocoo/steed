import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "@/components/ui/sonner";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Redirect to login if not authenticated
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <AuthProvider>
      <SidebarProvider>
        <AppShell>{children}</AppShell>
        <Toaster />
      </SidebarProvider>
    </AuthProvider>
  );
}
