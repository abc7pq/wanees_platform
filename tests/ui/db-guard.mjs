// Refuses to run the browser suite unless the stack under test is declared to use a
// throwaway database on a different Postgres server or database than the real one.
// The UI tests create drafts, publish events and write audit rows through the running
// apps, so they must never reach wanees_final — not even a new schema inside its database.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REAL_ENV_FILES = [".env", ".env.local", "app/.env", "app/.env.local", "admin/.env", "admin/.env.local"];
const PROTECTED_NAME = "wanees_final";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function describeDatabase(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("WANEES_UI_DATABASE_URL is not a valid postgresql:// URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("WANEES_UI_DATABASE_URL must be a postgresql:// URL.");
  }
  const host = LOOPBACK.has(parsed.hostname.toLowerCase()) ? "loopback" : parsed.hostname.toLowerCase();
  const port = parsed.port || "5432";
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();
  const schema = (parsed.searchParams.get("schema") ?? "public").toLowerCase();
  return { server: `${host}:${port}/${database}`, port, database, schema };
}

function readEnvDatabaseUrls(root) {
  const urls = [];
  for (const file of REAL_ENV_FILES) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\s#]+)/);
      if (match) urls.push({ source: file, url: match[1] });
    }
  }
  return urls;
}

/** Returns the safe test database description, or throws with a reason (never the URL). */
export function assertThrowawayDatabase({ env = process.env, root = repoRoot } = {}) {
  const declared = env.WANEES_UI_DATABASE_URL;
  if (!declared) {
    throw new Error(
      "Set WANEES_UI_DATABASE_URL to the throwaway Postgres the test stack was started with " +
        "(its own server or database, e.g. a pg_dump restore on another port). The UI suite refuses to run without it.",
    );
  }
  if (!env.WANEES_BASE_URL || !env.WANEES_ADMIN_BASE_URL) {
    throw new Error("Set WANEES_BASE_URL and WANEES_ADMIN_BASE_URL to the throwaway stack; the 3100/3200 defaults are not used.");
  }
  const target = describeDatabase(declared);

  const real = readEnvDatabaseUrls(root);
  if (env.DATABASE_URL) real.push({ source: "DATABASE_URL", url: env.DATABASE_URL });
  for (const { source, url } of real) {
    let known;
    try {
      known = describeDatabase(url);
    } catch {
      continue;
    }
    if (known.server === target.server) {
      throw new Error(
        `WANEES_UI_DATABASE_URL points at the same Postgres database as ${source} (${known.server}). ` +
          "A separate schema there is not isolation; use a throwaway server or database.",
      );
    }
  }
  // Fallback when no env file is present: the default-port database holding wanees_final is off-limits.
  if (target.port === "5432" && (target.database === PROTECTED_NAME || target.schema === PROTECTED_NAME)) {
    throw new Error(`WANEES_UI_DATABASE_URL targets ${PROTECTED_NAME} on the default Postgres port; use a throwaway copy.`);
  }
  return target;
}

export default async function globalSetup() {
  const target = assertThrowawayDatabase();
  console.log(`[ui] throwaway database ${target.server} (schema ${target.schema})`);
}
