import { headers } from "next/headers";
import { DEMO_ADMIN_EMAIL, hasDemoAdminMembership, hasOnlyViewerMemberships, localDemoAllowed, publicDemoCredentials } from "@/lib/local-demo";
import { findUserForLogin } from "@/lib/organizer-auth";
import { verifyPassword } from "@/lib/password";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function Login() {
  const password = process.env.WANEES_DEMO_ADMIN_PASSWORD;
  if (password && localDemoAllowed(await headers())) {
    const user = await findUserForLogin(DEMO_ADMIN_EMAIL).catch(() => null);
    if (user?.status === "ACTIVE" && hasDemoAdminMembership(user.memberships)
      && verifyPassword(password, user.passwordHash)) {
      return <LoginForm demo={{ email: user.email, password, scope: "local" }} />;
    }
  }
  return <LoginForm demo={await verifiedPublicDemo()} />;
}

type PublicDemo = { email: string; password: string; scope: "public" };
const PUBLIC_DEMO_CACHE_MS = 60_000;
let publicDemoCache: { key: string; value: PublicDemo | undefined; expiresAt: number } | undefined;

// Shows the public demo account only while it can actually sign in, so stale values never appear.
// Credentials printed on a public page must belong to a read-only (VIEWER-only) account.
// The verified result is cached briefly so each GET /login does not run scrypt.
async function verifiedPublicDemo(): Promise<PublicDemo | undefined> {
  const credentials = publicDemoCredentials();
  if (!credentials || !process.env.DATABASE_URL) return undefined;
  const key = `${credentials.email}\u0000${credentials.password}`;
  if (publicDemoCache && publicDemoCache.key === key && publicDemoCache.expiresAt > Date.now()) return publicDemoCache.value;
  let value: PublicDemo | undefined;
  try {
    const user = await findUserForLogin(credentials.email);
    const canSignIn = user?.status === "ACTIVE"
      && user.memberships.some((membership) => membership.organization.status === "ACTIVE")
      && verifyPassword(credentials.password, user.passwordHash);
    if (canSignIn && !hasOnlyViewerMemberships(user.memberships)) {
      console.warn(JSON.stringify({ level: "warn", logger: "wanees.login", event: "public_demo_not_viewer", message: "WANEES_PUBLIC_DEMO_* account has a non-VIEWER role; demo panel hidden." }));
    }
    value = canSignIn && hasOnlyViewerMemberships(user.memberships) ? { ...credentials, scope: "public" } : undefined;
  } catch {
    // Database unavailable: hide the panel and retry on the next request.
    return undefined;
  }
  publicDemoCache = { key, value, expiresAt: Date.now() + PUBLIC_DEMO_CACHE_MS };
  return value;
}
