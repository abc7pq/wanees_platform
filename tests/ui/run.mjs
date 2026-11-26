import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { assertThrowawayDatabase } from "./db-guard.mjs";

const require = createRequire(import.meta.url);
// Fail before starting anything if the stack is not on a throwaway database.
assertThrowawayDatabase();
const visitor = new URL(process.env.WANEES_BASE_URL ?? "http://127.0.0.1:3100");
const admin = new URL(process.env.WANEES_ADMIN_BASE_URL ?? "http://127.0.0.1:3200");
for (const target of [visitor, admin]) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new Error("Run the browser tests against a seeded loopback test stack.");
  }
}

// Some browser engines only accept Secure cookies over HTTPS, even on loopback.
const tlsDirectory = mkdtempSync(join(tmpdir(), "wanees-ui-"));
const keyPath = join(tlsDirectory, "key.pem");
const certPath = join(tlsDirectory, "cert.pem");
const servers = [];

try {
  const gitOpenSsl = join(process.env.ProgramFiles ?? "", "Git", "usr", "bin", "openssl.exe");
  const openssl = process.env.WANEES_UI_OPENSSL ?? (process.platform === "win32" && existsSync(gitOpenSsl) ? gitOpenSsl : "openssl");
  execFileSync(openssl, [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout", keyPath, "-out", certPath,
  ], { stdio: "pipe", windowsHide: true });
  const tls = { key: readFileSync(keyPath), cert: readFileSync(certPath) };

  async function wrap(target) {
    if (target.protocol === "https:") return target.origin;
    const server = createServer(tls, (incoming, outgoing) => {
      const upstream = request(target, {
        method: incoming.method,
        path: incoming.url,
        headers: { ...incoming.headers, "x-forwarded-host": incoming.headers.host, "x-forwarded-proto": "https" },
      }, (response) => {
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      });
      upstream.on("error", () => outgoing.writeHead(502).end("Local test server unavailable"));
      incoming.pipe(upstream);
    });
    servers.push(server);
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    return `https://127.0.0.1:${server.address().port}`;
  }

  const [visitorUrl, adminUrl] = await Promise.all([wrap(visitor), wrap(admin)]);
  const child = spawn(process.execPath, [require.resolve("@playwright/test/cli"), "test", ...process.argv.slice(2)], {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      WANEES_BASE_URL: visitorUrl,
      WANEES_ADMIN_BASE_URL: adminUrl,
      WANEES_UI_LOCAL_CERT: "1",
    },
  });
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
} finally {
  for (const server of servers) {
    server.close();
    server.closeAllConnections();
  }
  if (existsSync(keyPath)) unlinkSync(keyPath);
  if (existsSync(certPath)) unlinkSync(certPath);
  rmdirSync(tlsDirectory);
}
