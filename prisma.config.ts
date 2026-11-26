/// <reference types="node" />

import { argv, env } from "node:process";
import { defineConfig } from "prisma/config";
import { loadProjectEnv } from "./scripts/load-project-env.ts";

loadProjectEnv();

const databaseCommand = ["migrate", "studio", "introspect", "pull", "push"].some(
  (command) => argv.includes(command),
);
const databaseUrl =
  env.DATABASE_URL ??
  "postgresql://wanees:unconfigured@127.0.0.1:5432/wanees?schema=public";

if (!env.DATABASE_URL && databaseCommand) {
  throw new Error(
    "DATABASE_URL is required for database commands. Set it in the environment or provide app/.env.local.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl },
});
