import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, "..");
let baseUrl;
let server;
let serverOutput = "";
// One build folder per run: parallel runs (several sessions, CI shards) sharing ".next-test"
// corrupt each other's webpack chunks ("__webpack_modules__[moduleId] is not a function").
const distDir = `.next-test-${process.pid}`;

// `next dev` adds "<distDir>/types/**/*.ts" to tsconfig.json and never removes it. Drop only this
// run's entries afterwards, so concurrent runs and other dev servers keep theirs.
// The file's exact text before `next dev` touched it. Next rewrites it with the OS line ending,
// so restoring these bytes (not re-serialising) keeps `git status` clean on CRLF and LF checkouts.
const tsconfigPath = resolve(appRoot, "tsconfig.json");
let tsconfigBefore;

async function forgetDistDirInTsconfig() {
  try {
    const current = await readFile(tsconfigPath, "utf8");
    const config = JSON.parse(current);
    if (!Array.isArray(config.include)) return;
    const include = config.include.filter((entry) => !(typeof entry === "string" && entry.startsWith(`${distDir}/`)));
    if (include.length === config.include.length && current === tsconfigBefore) return;
    const cleaned = { ...config, include };
    if (tsconfigBefore !== undefined && JSON.stringify(cleaned) === JSON.stringify(JSON.parse(tsconfigBefore))) {
      await writeFile(tsconfigPath, tsconfigBefore);
      return;
    }
    if (include.length === config.include.length) return;
    // Someone else changed the file meanwhile: drop only our entry, keeping its line endings.
    const text = `${JSON.stringify(cleaned, null, 2)}\n`;
    await writeFile(tsconfigPath, current.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text);
  } catch {}
}

async function freePort() {
  const probe = createServer();
  await new Promise((ok, fail) => probe.once("error", fail).listen(0, "127.0.0.1", ok));
  const { port } = probe.address();
  await new Promise((ok, fail) => probe.close((err) => err ? fail(err) : ok()));
  return port;
}

async function startServer() {
  const port = await freePort();
  try { tsconfigBefore = await readFile(tsconfigPath, "utf8"); } catch {}
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [
    resolve(appRoot, "node_modules/next/dist/bin/next"),
    "dev", "-H", "127.0.0.1", "-p", String(port),
  ], {
    cwd: appRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      OPENAI_API_KEY: "",
      NEXT_TELEMETRY_DISABLED: "1",
      WANEES_NEXT_DIST_DIR: distDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => { serverOutput = (serverOutput + chunk).slice(-6000); });
  }

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next dev exited early:\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/session`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Next dev did not become ready:\n${serverOutput}`);
}

async function post(body) {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200, `POST ${body.op} should return 200`);
  return response.json();
}

async function getState(sessionId) {
  const response = await fetch(`${baseUrl}/api/session?session=${encodeURIComponent(sessionId)}`);
  assert.equal(response.status, 200, "session GET should return 200");
  return response.json();
}

async function deleteSession(sessionId) {
  return fetch(`${baseUrl}/api/session?session=${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

try {
  if (!baseUrl) await startServer();

  const created = await post({ op: "new" });
  const sessionId = created.sessionId;
  assert.ok(sessionId, "new session should return an id");
  assert.match(sessionId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i, "new session ID should be a cryptographic UUID, not the old short token");

  const planned = await post({
    op: "profile",
    sessionId,
    profile: {
      mood: "مرح",
      budget: 300,
      duration_min: 180,
      interests: ["طعام", "عروض"],
    },
  });
  assert.ok(planned.itinerary?.stops?.length, "profile should produce an itinerary");
  const original = {
    profile: structuredClone(planned.profile),
    itinerary: structuredClone(planned.itinerary),
  };

  for (const [text, expectedReply, label] of [
    ["احذف نشاط مجهول", "ما لقيت النشاط، ذكرني باسمه؟", "unresolved remove"],
    ["بدّل نشاط مجهول", "قل لي أي نشاط تبي أبدله؟", "unresolved swap"],
  ]) {
    const result = await post({ op: "chat", sessionId, text });
    const state = await getState(sessionId);
    assert.deepEqual(state.profile, original.profile, `${label} must not mutate the visitor profile`);
    assert.deepEqual(state.itinerary, original.itinerary, `${label} must not mutate the itinerary`);
    assert.ok(result.messages?.some((message) => message.text === expectedReply), `${label} should receive the fail-closed prompt; got ${JSON.stringify(result.messages)}`);
    console.log(`passed: ${label} leaves profile and itinerary unchanged`);
  }

  const missingDeletion = await deleteSession(`missing-${sessionId}`);
  assert.equal(missingDeletion.status, 404, "DELETE for an unknown session should return 404");

  const deletion = await deleteSession(sessionId);
  assert.equal(deletion.status, 200, "session DELETE should return 200");
  const deletedState = await fetch(`${baseUrl}/api/session?session=${encodeURIComponent(sessionId)}`);
  assert.equal(deletedState.status, 404, "deleted session GET should return 404");
  console.log("passed: session deletion removes the session");

  const demoSource = await readFile(resolve(appRoot, "app/demo/page.tsx"), "utf8");
  assert.doesNotMatch(demoSource, /localStorage\.(?:getItem|setItem)\(\s*["'`]wanees_(?:sid|msgs)["'`]/, "demo must not read or write legacy session IDs or messages in localStorage");
  for (const key of ["wanees_sid", "wanees_msgs"]) {
    assert.match(demoSource, new RegExp(`localStorage\\.removeItem\\([\\"']${key}[\\"']\\)`), `demo should clear legacy ${key} data once on mount`);
  }
  assert.match(demoSource, /if\s*\(!res\.ok\s*&&\s*res\.status\s*!==\s*404\)\s*throw/, "new visit should tolerate DELETE 404 and reject other non-2xx statuses");
  assert.match(demoSource, /catch\s*\{\s*setVisitResetError\(/, "new visit should show an error and keep the current view when DELETE rejects");
  assert.match(demoSource, /role="alert"/, "new visit errors should be visible to visitors");
  console.log("passed: new visit handles already-deleted sessions and surfaces retry errors");
} finally {
  if (server && server.exitCode === null) {
    const killServerGroup = (signal) => {
      try {
        // Windows has no process groups: kill the whole tree, or `next dev`'s server child outlives the test.
        if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
        else if (server.pid) process.kill(-server.pid, signal);
        else server.kill(signal);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    };
    killServerGroup("SIGTERM");
    await Promise.race([new Promise((resolveExit) => server.once("exit", resolveExit)), sleep(5000)]);
    if (server.exitCode === null) killServerGroup("SIGKILL");
  }
  await rm(resolve(appRoot, distDir), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  await forgetDistDirInTsconfig();
}
