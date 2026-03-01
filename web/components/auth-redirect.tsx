import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Server component that checks if a user is logged in and redirects to /dashboard.
 * Must be wrapped in <Suspense> since it accesses cookies (runtime data).
 */
export async function AuthRedirect() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (session) {
    redirect("/dashboard");
  }
  return null;
}
