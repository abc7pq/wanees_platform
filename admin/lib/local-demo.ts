export const DEMO_ADMIN_EMAIL = "demo-admin@wanees.demo";
export const DEMO_ORGANIZATION_SLUG = "wanees-demo";

export function isLoopbackDatabase(databaseUrl: string | undefined) {
  if (!databaseUrl) return false;
  try {
    const url = new URL(databaseUrl);
    return ["postgresql:", "postgres:"].includes(url.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && !url.searchParams.has("host")
      && !url.searchParams.has("hostaddr");
  } catch {
    return false;
  }
}

export function localDemoAllowed(headers: Pick<Headers, "get">, env = process.env) {
  if (env.WANEES_LOCAL_DEMO !== "true" || !isLoopbackDatabase(env.DATABASE_URL)) return false;
  const host = headers.get("host")?.toLowerCase();
  const forwarded = headers.get("x-forwarded-host")?.toLowerCase();
  return Boolean(host && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    && (forwarded === undefined || forwarded === host));
}

// Opt-in credentials shown on the public login page (for example to hackathon judges).
// Both values must be set; the page still checks them against the database before showing them.
export function publicDemoCredentials(env = process.env) {
  const email = env.WANEES_PUBLIC_DEMO_EMAIL?.trim().toLowerCase();
  const password = env.WANEES_PUBLIC_DEMO_PASSWORD;
  if (!email || !password || !/^[^\s@]+@[^\s@]+$/.test(email)) return undefined;
  return { email, password };
}

// A password shown on a public page must only unlock a read-only account.
export function hasOnlyViewerMemberships(memberships: readonly { role: string }[]) {
  return memberships.length > 0 && memberships.every((membership) => membership.role === "VIEWER");
}

export function hasDemoAdminMembership(memberships: readonly {
  role: string;
  organization: { slug: string; status: string };
}[]) {
  const [membership] = memberships;
  return memberships.length === 1 && membership.role === "ADMIN"
    && membership.organization.slug === DEMO_ORGANIZATION_SLUG
    && membership.organization.status === "ACTIVE";
}
