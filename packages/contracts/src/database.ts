// The pg driver ignores Prisma's `?schema=` URL parameter. Read it here and pass it
// both to the Prisma adapter (generated queries) and as the connection search_path
// (raw SQL), so a non-default schema such as `?schema=wanees_final` is honoured.
const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export function databaseSchema(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return undefined;
  let schema: string | null = null;
  try {
    schema = new URL(databaseUrl).searchParams.get("schema");
  } catch {
    return undefined;
  }
  if (!schema || schema === "public") return undefined;
  if (!SCHEMA_NAME.test(schema)) throw new Error("DATABASE_URL schema must be a plain PostgreSQL identifier.");
  return schema;
}

/** Arguments for `new PrismaPg(...prismaPgArgs(url, poolOptions))`. */
export function prismaPgArgs<T extends object>(databaseUrl: string | undefined, pool?: T) {
  const schema = databaseSchema(databaseUrl);
  const config = { ...(pool ?? {}), connectionString: databaseUrl, ...(schema ? { options: `-c search_path=${schema}` } : {}) };
  return [config, schema ? { schema } : undefined] as const;
}

// One PostgreSQL pool per server process. The visitor app, the admin app and packages/engine each have a
// Prisma client module, and Next.js may evaluate a module more than once in one process (instrumentation,
// route bundles). They all reuse the client stored under this key, so a process holds one pool, not several.
export const SHARED_PRISMA_KEY = "__waneesPrisma";

export const DEFAULT_POOL_MAX = 20;

/**
 * Connections one server process may open: the caller passes the `WANEES_DB_POOL_MAX` setting (1–100, default 20). Add up every process
 * that shares a database and keep the total under PostgreSQL's `max_connections` (100 by default).
 */
export function databasePoolMax(value: string | undefined) {
  if (value == null || value.trim() === "") return DEFAULT_POOL_MAX;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : DEFAULT_POOL_MAX;
}
