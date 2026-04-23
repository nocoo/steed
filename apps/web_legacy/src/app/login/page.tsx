import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginCard } from "./login-card";

export default async function LoginPage() {
  // Redirect authenticated users to overview
  const session = await auth();
  if (session?.user) {
    redirect("/overview");
  }

  return <LoginCard />;
}
