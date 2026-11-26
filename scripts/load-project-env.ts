import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Keep the same precedence as the app's local configuration while allowing
// root database tooling to use the documented `.env` file. `loadEnvFile`
// never overwrites an already-defined process variable, so the first file
// wins after the inherited environment.
const projectEnvFiles = [
  join(repoRoot, "app", ".env.local"),
  join(repoRoot, ".env.local"),
  join(repoRoot, ".env"),
];

export function loadProjectEnv() {
  for (const file of projectEnvFiles) {
    if (existsSync(file)) loadEnvFile(file);
  }
}
