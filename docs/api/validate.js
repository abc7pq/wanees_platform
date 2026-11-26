import fs from "node:fs";
import yaml from "js-yaml";

const file = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
let doc;
try {
  doc = yaml.load(raw);
} catch (e) {
  console.error("YAML PARSE FAILED:", e.message);
  process.exit(1);
}

const problems = [];
const refs = new Set();
(function walk(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(walk);
  for (const [k, v] of Object.entries(node)) {
    if (k === "$ref" && typeof v === "string") refs.add(v);
    else walk(v);
  }
})(doc);

function resolve(ref) {
  if (!ref.startsWith("#/")) return null;
  let cur = doc;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!cur || typeof cur !== "object" || !(key in cur)) return null;
    cur = cur[key];
  }
  return cur;
}

for (const ref of refs) if (!resolve(ref)) problems.push("unresolved $ref: " + ref);

// every path must have an operation object with operationId + responses
let ops = 0;
for (const [p, item] of Object.entries(doc.paths || {})) {
  for (const m of ["get", "post", "put", "patch", "delete"]) {
    const op = item[m];
    if (!op) continue;
    ops++;
    if (!op.operationId) problems.push(`${m.toUpperCase()} ${p}: missing operationId`);
    if (!op.responses || !Object.keys(op.responses).length) problems.push(`${m.toUpperCase()} ${p}: no responses`);
    if (!op.tags || !op.tags.length) problems.push(`${m.toUpperCase()} ${p}: no tags`);
  }
}

// schema sanity: required fields must exist in properties
for (const [name, schema] of Object.entries(doc.components.schemas || {})) {
  if (schema.required && schema.properties) {
    for (const r of schema.required) if (!(r in schema.properties)) problems.push(`schema ${name}: required "${r}" not in properties`);
  }
  if (schema.required && !schema.properties && !schema.allOf) problems.push(`schema ${name}: required without properties`);
}

const summary = {
  openapi: doc.openapi,
  title: doc.info && doc.info.title,
  version: doc.info && doc.info.version,
  paths: Object.keys(doc.paths || {}).length,
  operations: ops,
  schemas: Object.keys((doc.components && doc.components.schemas) || {}).length,
  refs: refs.size,
  problems,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(problems.length ? 2 : 0);
