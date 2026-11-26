import { headers } from "next/headers";
import { DEMO_ADMIN_EMAIL, hasDemoAdminMembership, localDemoAllowed } from "@/lib/local-demo";
import { findUserForLogin } from "@/lib/organizer-auth";
import { verifyPassword } from "@/lib/password";
import LoginForm from "./login-form";

export const dynamic = "force-dynamic";

export default async function Login() {
  const password = process.env.WANEES_DEMO_ADMIN_PASSWORD;
  if (!password || !localDemoAllowed(await headers())) return <LoginForm />;

  const user = await findUserForLogin(DEMO_ADMIN_EMAIL);
  const demo = user?.status === "ACTIVE" && hasDemoAdminMembership(user.memberships)
    && verifyPassword(password, user.passwordHash)
    ? { email: user.email, password }
    : undefined;
  return <LoginForm demo={demo} />;
}
