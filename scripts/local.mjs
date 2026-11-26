// One-command local workflow for WANEES (Windows, macOS, Linux).
//   npm run setup         install, write env files, create + migrate + seed PostgreSQL
//   npm run start:local   build (if needed) and run the visitor (3100) and organizer (3200) apps
//   npm run verify:local  unit suites + full HTTP and presentation-story flows against the running apps
//
// Setup inputs (all optional, read from the environment):
//   DATABASE_URL     default postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public
//   OPENAI_API_KEY   enables the conversational model; planning works without it
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const command = process.argv[2];
const force = process.argv.includes("--force");
const VISITOR = "http://localhost:3100";
const ADMIN = "http://localhost:3200";

function parseEnv(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return values;
}

function writeEnv(file, values) {
  const body = Object.entries(values).map(([key, value]) => `${key}="${value}"`).join("\n");
  writeFileSync(file, `# Written by npm run setup. Local only: never commit this file.\n${body}\n`);
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", ...options });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

const step = (text) => console.log(`\n\u001b[35m▸ ${text}\u001b[0m`);
const secret = () => randomBytes(18).toString("base64url");

async function ensureDatabase(databaseUrl) {
  const { default: pg } = await import("pg");
  const target = new URL(databaseUrl);
  const name = decodeURIComponent(target.pathname.slice(1));
  const probe = new pg.Client({ connectionString: databaseUrl });
  try {
    await probe.connect();
    await probe.end();
    return "exists";
  } catch (error) {
    if (error.code !== "3D000") throw error; // anything other than "database does not exist"
  }
  const maintenance = new URL(databaseUrl);
  maintenance.pathname = "/postgres";
  maintenance.search = "";
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
  await admin.end();
  return "created";
}

async function setup() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 22) throw new Error(`Node.js 22.6+ is required (26 recommended); found ${process.versions.node}.`);

  step("Installing dependencies (root, visitor app, organizer app)");
  for (const dir of [".", "app", "admin"]) {
    if (!force && existsSync(join(root, dir, "node_modules"))) { console.log(`  ${dir}: already installed`); continue; }
    await run(npm, ["ci", "--no-audit", "--no-fund"], { cwd: join(root, dir) });
  }

  step("Writing local environment files");
  const existing = { ...parseEnv(join(root, ".env")), ...parseEnv(join(root, "app", ".env.local")) };
  const shared = {
    DATABASE_URL: process.env.DATABASE_URL ?? existing.DATABASE_URL ?? "postgresql://wanees:wanees_dev@localhost:5432/wanees?schema=public",
    NEXT_PUBLIC_APP_URL: VISITOR,
    ADMIN_APP_URL: ADMIN,
    VISITOR_API: VISITOR,
    WANEES_ORGANIZATION_SLUG: "wanees-demo",
    WANEES_OWNER_PASSWORD: existing.WANEES_OWNER_PASSWORD || secret(),
    ADMIN_TOKEN: existing.ADMIN_TOKEN || secret(),
    WANEES_RATE_LIMIT_SALT: existing.WANEES_RATE_LIMIT_SALT && existing.WANEES_RATE_LIMIT_SALT !== "change-me" ? existing.WANEES_RATE_LIMIT_SALT : secret(),
  };
  const openAiKey = process.env.OPENAI_API_KEY ?? existing.OPENAI_API_KEY ?? "";
  writeEnv(join(root, ".env"), shared);
  writeEnv(join(root, "admin", ".env.local"), shared);
  writeEnv(join(root, "app", ".env.local"), { ...shared, OPENAI_API_KEY: openAiKey, WANEES_OPENAI_MODEL: existing.WANEES_OPENAI_MODEL || "gpt-6-luna" });
  console.log(`  .env, app/.env.local and admin/.env.local written (OpenAI key ${openAiKey ? "set" : "not set: deterministic replies only"})`);

  step("Preparing PostgreSQL");
  console.log(`  database ${await ensureDatabase(shared.DATABASE_URL)}`);
  await run(npm, ["run", "db:generate"]);
  await run(npm, ["run", "db:deploy"]);
  await run(npm, ["run", "db:seed"]);

  console.log(`\n\u001b[32m✓ Setup complete.\u001b[0m Next: npm run start:local
  Visitor app     ${VISITOR}/demo
  Operator view   ${VISITOR}/ops
  Organizer app   ${ADMIN}  (owner@wanees.demo / ${shared.WANEES_OWNER_PASSWORD})`);
}

async function start() {
  if (!existsSync(join(root, "app", ".env.local"))) throw new Error("Run npm run setup first.");
  for (const dir of ["app", "admin"]) {
    if (force || !existsSync(join(root, dir, ".next", "BUILD_ID"))) {
      step(`Building ${dir === "app" ? "visitor" : "organizer"} app`);
      await run(npm, ["run", "build"], { cwd: join(root, dir) });
    }
  }
  step("Starting visitor (3100) and organizer (3200) apps. Press Ctrl+C to stop both.");
  const children = ["app", "admin"].map((dir) => {
    const child = spawn(npm, ["start"], { cwd: join(root, dir), shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
    const label = dir === "app" ? "visitor  " : "organizer";
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim() && !line.includes('"event":"wanees.http"')) console.log(`[${label}] ${line}`);
        }
      });
    }
    return child;
  });
  const stop = () => { for (const child of children) child.kill(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const [visitor, admin] = await Promise.all([fetch(`${VISITOR}/api/health`), fetch(`${ADMIN}/api/health`)]);
      if (visitor.ok && admin.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(`\n\u001b[32m✓ WANEES is running\u001b[0m
  Visitor app     ${VISITOR}/demo
  Operator view   ${VISITOR}/ops
  Organizer app   ${ADMIN}`);
}

async function verify() {
  const env = { ...process.env, ...parseEnv(join(root, "admin", ".env.local")), WANEES_BASE_URL: VISITOR, WANEES_ADMIN_BASE_URL: ADMIN };
  const checks = [
    ["Visitor unit and contract suites", npm, ["test"], "app"],
    ["Organizer unit suites", npm, ["test"], "admin"],
    ["Architecture boundaries", npm, ["run", "test:architecture"], "."],
    ["OpenAPI contract", npm, ["run", "test:contract"], "."],
    ["Database smoke checks", npm, ["run", "db:smoke"], "."],
    ["Idempotency", "node", ["scripts/idempotency-smoke.mjs"], "."],
    ["Visitor + organizer HTTP flow", "node", ["scripts/http-smoke.mjs"], "."],
    ["Presentation story (Abu Fahd)", "node", ["scripts/deck-story-smoke.mjs"], "."],
  ];
  const results = [];
  for (const [name, cmd, args, dir] of checks) {
    step(name);
    try {
      await run(cmd, args, { cwd: join(root, dir), env });
      results.push([name, "PASS"]);
    } catch {
      results.push([name, "FAIL"]);
    }
  }
  console.log("\nResults");
  for (const [name, status] of results) console.log(`  ${status === "PASS" ? "\u001b[32m✓" : "\u001b[31m✗"} ${name}\u001b[0m`);
  if (results.some(([, status]) => status === "FAIL")) process.exit(1);
}

const commands = { setup, start, verify };
if (!commands[command]) {
  console.log("Usage: node scripts/local.mjs <setup|start|verify> [--force]");
  process.exit(1);
}
commands[command]().catch((error) => {
  console.error(`\n\u001b[31m✗ ${error.message}\u001b[0m`);
  process.exit(1);
});
