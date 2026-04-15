import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginCard } from "./login-card";

export default async function LoginPage() {
  const session = await auth();

  // Redirect to overview if already authenticated
  if (session?.user) {
    redirect("/overview");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <LoginCard />
    </main>
  );
}
