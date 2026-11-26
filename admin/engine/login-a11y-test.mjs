import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PasswordField } from "../lib/password-field.ts";
import { hasDemoAdminMembership, isLoopbackDatabase, localDemoAllowed } from "../lib/local-demo.ts";

const markup = renderToStaticMarkup(createElement(PasswordField, {
  value: "",
  disabled: false,
  onChange: () => {},
}));
const label = markup.match(/<label[^>]*for="([^"]+)"/);
const input = markup.match(/<input[^>]*id="([^"]+)"/);
assert.ok(label && input, "password label and input should render");
assert.equal(label[1], input[1], "password label must reference its input id");

console.log("admin login label association regression passed");

const localEnv = { WANEES_LOCAL_DEMO: "true", DATABASE_URL: "postgresql://localhost:5432/wanees" };
for (const host of ["localhost", "LOCALHOST:4200", "127.0.0.1:4200", "[::1]:4200"]) {
  assert.equal(localDemoAllowed(new Headers({ host, "x-forwarded-host": host }), localEnv), true);
}
const loopback = new Headers({ host: "127.0.0.1:4200" });
assert.equal(localDemoAllowed(loopback, localEnv), true);
for (const flag of ["false", undefined]) assert.equal(localDemoAllowed(loopback, { ...localEnv, WANEES_LOCAL_DEMO: flag }), false);
for (const [host, forwarded] of [
  ["example.com", "localhost"],
  ["localhost", "example.com"],
  ["localhost", "localhost, proxy.internal"],
  ["localhost:4200", "localhost:3200"],
  ["", "localhost"],
]) assert.equal(localDemoAllowed(new Headers({ host, "x-forwarded-host": forwarded }), localEnv), false);
assert.equal(isLoopbackDatabase("postgresql://[::1]:5432/wanees"), true);
assert.equal(isLoopbackDatabase("postgresql://localhost/wanees?host=db.example.com"), false);
assert.equal(localDemoAllowed(loopback, { ...localEnv, DATABASE_URL: "postgresql://prod.example.com/wanees" }), false);

const admin = { role: "ADMIN", organization: { slug: "wanees-demo", status: "ACTIVE" } };
assert.equal(hasDemoAdminMembership([admin]), true);
assert.equal(hasDemoAdminMembership([{ ...admin, role: "VIEWER" }]), false);
assert.equal(hasDemoAdminMembership([admin, { ...admin, organization: { ...admin.organization, slug: "another-org" } }]), false);

const loginSource = await readFile(resolve(import.meta.dirname, "../app/login/login-form.tsx"), "utf8");
assert.match(loginSource, /demo && <aside className="demo-credentials"/);
assert.match(loginSource, /value: demo\.email/);
assert.match(loginSource, /value: demo\.password/);
assert.doesNotMatch(loginSource, /api\/demo-credentials/);

const pageSource = await readFile(resolve(import.meta.dirname, "../app/login/page.tsx"), "utf8");
assert.match(pageSource, /force-dynamic/, "login page must resolve the demo flag per request, not at build time");
assert.match(pageSource, /localDemoAllowed\(await headers\(\)\)/);
assert.match(pageSource, /verifyPassword\(password, user\.passwordHash\)/);

const demoRouteSource = await readFile(resolve(import.meta.dirname, "../app/api/demo-login/route.ts"), "utf8");
assert.match(demoRouteSource, /status: 410/, "legacy demo endpoint must be disabled");
assert.doesNotMatch(demoRouteSource, /cookies\.set|localDemoCookieValue|DEMO_COOKIE/, "legacy endpoint must not mint a local bypass cookie");
console.log("local-only database demo admin login regression passed");

const { publicDemoCredentials } = await import("../lib/local-demo.ts");
assert.deepEqual(publicDemoCredentials({ WANEES_PUBLIC_DEMO_EMAIL: " Owner@Wanees.Demo ", WANEES_PUBLIC_DEMO_PASSWORD: "pw" }),
  { email: "owner@wanees.demo", password: "pw" });
for (const env of [{}, { WANEES_PUBLIC_DEMO_EMAIL: "owner@wanees.demo" }, { WANEES_PUBLIC_DEMO_PASSWORD: "pw" },
  { WANEES_PUBLIC_DEMO_EMAIL: "not-an-email", WANEES_PUBLIC_DEMO_PASSWORD: "pw" }]) {
  assert.equal(publicDemoCredentials(env), undefined, "public demo panel stays hidden unless both values are valid");
}
assert.match(pageSource, /verifyPassword\(credentials\.password, user\.passwordHash\)/, "public demo credentials must be verified before display");
assert.match(pageSource, /membership\.organization\.status === "ACTIVE"/);
console.log("public demo login credentials regression passed");
