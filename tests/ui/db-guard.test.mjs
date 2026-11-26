import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertThrowawayDatabase } from "./db-guard.mjs";

const REAL = "postgresql://u:p@127.0.0.1:5432/wanees?schema=wanees_final";
const urls = { WANEES_BASE_URL: "http://127.0.0.1:4101", WANEES_ADMIN_BASE_URL: "http://127.0.0.1:4201" };

function withRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), "wanees-guard-"));
  try {
    mkdirSync(join(root, "app"));
    writeFileSync(join(root, "app", ".env.local"), `DATABASE_URL="${REAL}"\n`);
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("refuses when no test database is declared", () =>
  withRepo((root) => assert.throws(() => assertThrowawayDatabase({ env: { ...urls }, root }), /WANEES_UI_DATABASE_URL/)));

test("refuses when base URLs are left at defaults", () =>
  withRepo((root) =>
    assert.throws(
      () => assertThrowawayDatabase({ env: { WANEES_UI_DATABASE_URL: "postgresql://u:p@127.0.0.1:5499/wanees" }, root }),
      /WANEES_BASE_URL/,
    )));

test("refuses the real wanees_final database", () =>
  withRepo((root) => assert.throws(() => assertThrowawayDatabase({ env: { ...urls, WANEES_UI_DATABASE_URL: REAL }, root }), /same Postgres database/)));

test("refuses another schema inside the real database, including via localhost", () =>
  withRepo((root) =>
    assert.throws(
      () => assertThrowawayDatabase({ env: { ...urls, WANEES_UI_DATABASE_URL: "postgresql://u:p@localhost/wanees?schema=wanees_mob360" }, root }),
      /separate schema there is not isolation/,
    )));

test("refuses wanees_final on the default port even without env files", () => {
  const root = mkdtempSync(join(tmpdir(), "wanees-guard-empty-"));
  try {
    assert.throws(
      () => assertThrowawayDatabase({ env: { ...urls, WANEES_UI_DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/other?schema=wanees_final" }, root }),
      /default Postgres port/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts a pg_dump restore on its own server, even with the same schema name", () =>
  withRepo((root) => {
    const target = assertThrowawayDatabase({
      env: { ...urls, WANEES_UI_DATABASE_URL: "postgresql://u:p@127.0.0.1:5499/wanees?schema=wanees_final" },
      root,
    });
    assert.equal(target.server, "loopback:5499/wanees");
  }));

test("accepts a separate database on the same server", () =>
  withRepo((root) => {
    const target = assertThrowawayDatabase({ env: { ...urls, WANEES_UI_DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/wanees_ui_tmp" }, root });
    assert.equal(target.server, "loopback:5432/wanees_ui_tmp");
  }));

test("error messages never echo credentials", () =>
  withRepo((root) => {
    try {
      assertThrowawayDatabase({ env: { ...urls, WANEES_UI_DATABASE_URL: "postgresql://secretuser:secretpw@127.0.0.1:5432/wanees?schema=x" }, root });
      assert.fail("expected refusal");
    } catch (error) {
      assert.doesNotMatch(String(error.message), /secret/);
    }
  }));
