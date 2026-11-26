import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const rules = [
  {
    name: "deterministic itinerary engine stays infrastructure-free",
    directory: path.join(root, "app", "engine"),
    forbidden: [
      { pattern: /from\s+["'](?:next|@prisma)/, label: "Next.js or Prisma imports" },
      { pattern: /from\s+["'](?:zod|pg)["']/, label: "transport/database validation imports" },
      { pattern: /process\.env/, label: "environment access" },
    ],
  },
  {
    name: "shared contracts stay independent from application adapters",
    directory: path.join(root, "packages", "contracts"),
    forbidden: [
      { pattern: /from\s+["'](?:next|@prisma|react)/, label: "framework imports" },
      { pattern: /process\.env/, label: "environment access" },
    ],
  },
];

function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) && !/(?:test|spec)\./i.test(entry.name) ? [file] : [];
  });
}

const violations = [];
for (const rule of rules) {
  for (const file of sourceFiles(rule.directory)) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const check of rule.forbidden) {
        if (check.pattern.test(line)) {
          violations.push(`${path.relative(root, file)}:${index + 1} ${check.label} (${rule.name})`);
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error("Architecture boundary violations found:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture boundaries passed (${rules.length} rules).`);
}
