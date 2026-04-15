import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider } from "@/components/auth-provider";

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
      </SidebarProvider>
    </AuthProvider>
  );
}
