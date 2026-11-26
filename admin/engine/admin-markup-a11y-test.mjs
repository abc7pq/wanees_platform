import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const adminRoot = resolve(import.meta.dirname, "..");
const appDir = join(adminRoot, "app");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

const files = await walk(appDir);
for (const extra of ["lib", "components"].map((name) => join(adminRoot, name))) {
  try {
    files.push(...await walk(extra));
  } catch {
    // optional folder
  }
}
const sources = new Map();
for (const file of files) sources.set(file, await readFile(file, "utf8"));

// Every id rendered anywhere in the admin app, for cross-component label targets.
const allIds = new Set();
for (const source of sources.values()) {
  for (const match of source.matchAll(/\bid="([^"]+)"/g)) allIds.add(match[1]);
}

let labelCount = 0;
for (const [file, source] of sources) {
  const rel = relative(adminRoot, file).replaceAll("\\", "/");
  if (!rel.startsWith("app/") || !rel.endsWith(".tsx")) continue;
  for (const match of source.matchAll(/<label\b[^>]*>/g)) {
    labelCount += 1;
    const tag = match[0];
    assert.match(tag, /\bhtmlFor=/, `${rel}: label without htmlFor -> ${tag}`);
  }
  for (const match of source.matchAll(/\bhtmlFor="([^"]+)"/g)) {
    assert.ok(allIds.has(match[1]), `${rel}: htmlFor="${match[1]}" has no matching id in the admin app`);
  }
}

// A page that renders the shared topbar must expose the skip-link target.
let topbarPages = 0;
for (const [file, source] of sources) {
  if (!source.includes("<Topbar")) continue;
  topbarPages += 1;
  const rel = relative(adminRoot, file).replaceAll("\\", "/");
  assert.match(source, /id="main-content"/, `${rel}: uses Topbar but has no main#main-content landmark`);
}

// The shared topbar keeps the skip link and announces the current page.
const topbarSource = sources.get(join(appDir, "dashboard.tsx"));
assert.ok(topbarSource, "dashboard.tsx should exist");
assert.match(topbarSource, /className="skip-link" href="#main-content"/, "Topbar must render the skip link");
assert.match(topbarSource, /aria-current=\{current === "dashboard" \? "page" : undefined\}/, "Topbar must mark the current page");
assert.match(topbarSource, /aria-label="التنقل الرئيسي"/, "Topbar nav must be labelled");

console.log(`admin markup accessibility passed: ${labelCount} labels, ${topbarPages} topbar pages`);
