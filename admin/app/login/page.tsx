import { headers } from "next/headers";
import { DEMO_ADMIN_EMAIL, hasDemoAdminMembership, localDemoAllowed, publicDemoCredentials } from "@/lib/local-demo";
import { findUserForLogin } from "@/lib/organizer-auth";
import { verifyPassword } from "@/lib/password";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function Login() {
  const password = process.env.WANEES_DEMO_ADMIN_PASSWORD;
  if (password && localDemoAllowed(await headers())) {
    const user = await findUserForLogin(DEMO_ADMIN_EMAIL);
    if (user?.status === "ACTIVE" && hasDemoAdminMembership(user.memberships)
      && verifyPassword(password, user.passwordHash)) {
      return <LoginForm demo={{ email: user.email, password, scope: "local" }} />;
    }
  }
  return <LoginForm demo={await verifiedPublicDemo()} />;
}

// Shows the public demo account only while it can actually sign in, so stale values never appear.
async function verifiedPublicDemo() {
  const credentials = publicDemoCredentials();
  if (!credentials || !process.env.DATABASE_URL) return undefined;
  const user = await findUserForLogin(credentials.email);
  const canSignIn = user?.status === "ACTIVE"
    && user.memberships.some((membership) => membership.organization.status === "ACTIVE")
    && verifyPassword(credentials.password, user.passwordHash);
  return canSignIn ? { ...credentials, scope: "public" as const } : undefined;
}
