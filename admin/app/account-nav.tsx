"use client";

import { useEffect, useState } from "react";

export type AccountPage = "users" | "audit";

type Permissions = { manageMembers: boolean; viewAudit: boolean };

let cached: Promise<Permissions | null> | null = null;

function loadPermissions() {
  cached ??= fetch("/api/v1/me", { credentials: "include" })
    .then(async (res) => (res.ok ? ((await res.json())?.data?.permissions as Permissions) ?? null : null))
    .catch(() => null);
  return cached;
}

/**
 * Links to the organization pages (members, audit log), rendered only for roles that may
 * open them. The server enforces the same rules; this only keeps the nav honest.
 */
export function AccountNavLinks({ current }: { current?: string }) {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  useEffect(() => {
    let live = true;
    void loadPermissions().then((value) => { if (live) setPermissions(value); });
    return () => { live = false; };
  }, []);
  if (!permissions) return null;
  return (
    <>
      {permissions.manageMembers && <a className={`navlink${current === "users" ? " active" : ""}`} href="/users" aria-current={current === "users" ? "page" : undefined}>المستخدمون</a>}
      {permissions.viewAudit && <a className={`navlink${current === "audit" ? " active" : ""}`} href="/audit" aria-current={current === "audit" ? "page" : undefined}>سجل التدقيق</a>}
    </>
  );
}
