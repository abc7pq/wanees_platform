// Records a human crosswalk review on one catalog draft: HOLD -> VERIFIED.
// It is the only code path that sets VERIFIED. It hashes the artifact file
// itself and refuses unless that hash equals the SHA-256 the reviewer approved.
//
//   npm run catalog:crosswalk-verify -- --event <slug> --version <number> \
//     --artifact <crosswalk.csv> --sha256 <approved hash> --reviewer "<name>" [--confirm]
//
// Without --confirm it only reports what it would do. Verifying clears the
// draft's validation report, so the draft must be validated again before publishing.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadProjectEnv } from "./load-project-env.ts";
import { prismaPgArgs } from "../packages/contracts/src/database.ts";

loadProjectEnv();

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(code: string, message: string): never {
  console.error(JSON.stringify({ ok: false, code, message }));
  process.exit(1);
}

const eventSlug = argument("--event");
const versionNumber = Number(argument("--version"));
const artifactArgument = argument("--artifact");
const approved = argument("--sha256")?.toLowerCase();
const reviewer = argument("--reviewer")?.trim();
const confirm = process.argv.includes("--confirm");

if (!eventSlug || !Number.isInteger(versionNumber) || versionNumber < 1 || !artifactArgument || !approved || !reviewer) {
  fail("USAGE", "Usage: --event <slug> --version <number> --artifact <path> --sha256 <hex> --reviewer <name> [--confirm]");
}
if (!/^[0-9a-f]{64}$/.test(approved)) fail("CHECKSUM_FORMAT", "--sha256 must be 64 lowercase hex characters");

const artifactPath = resolve(artifactArgument);
const actual = createHash("sha256").update(await readFile(artifactPath)).digest("hex");
if (actual !== approved) {
  fail("CROSSWALK_CHECKSUM_MISMATCH", `artifact ${basename(artifactPath)} hashes to ${actual}, not the approved ${approved}`);
}

const db = new PrismaClient({ adapter: new PrismaPg(...prismaPgArgs(process.env.DATABASE_URL)) });
try {
  const version = await db.catalogVersion.findFirst({
    where: { versionNumber, event: { slug: eventSlug } },
    select: { id: true, status: true, crosswalkStatus: true, crosswalkChecksum: true, event: { select: { organizationId: true } } },
  });
  if (!version) fail("VERSION_NOT_FOUND", `no catalog v${versionNumber} for event ${eventSlug}`);
  if (version.status !== "DRAFT" && version.status !== "REJECTED") fail("VERSION_LOCKED", `v${versionNumber} is ${version.status}; only a draft can be verified`);
  if (version.crosswalkStatus !== "HOLD") fail("NOT_ON_HOLD", `v${versionNumber} crosswalk is ${version.crosswalkStatus}, expected HOLD`);

  const plan = { eventSlug, versionNumber, versionId: version.id, artifact: basename(artifactPath), checksum: actual, reviewer, from: "HOLD", to: "VERIFIED" };
  if (!confirm) {
    console.log(JSON.stringify({ ok: true, dryRun: true, ...plan }));
    process.exit(0);
  }

  const verifiedAt = new Date();
  await db.$transaction(async (tx) => {
    const updated = await tx.catalogVersion.updateMany({
      where: { id: version.id, status: version.status, crosswalkStatus: "HOLD" },
      data: { crosswalkStatus: "VERIFIED", crosswalkChecksum: actual, crosswalkVerifiedAt: verifiedAt, status: "DRAFT", validationReport: { valid: false, crosswalkVerifiedAt: verifiedAt.toISOString() } },
    });
    if (updated.count !== 1) throw new Error("VERSION_CHANGED: the draft changed while it was being verified");
    await tx.auditLog.create({
      data: {
        organizationId: version.event.organizationId,
        action: "catalog_version.crosswalk_verify",
        entityType: "CatalogVersion",
        entityId: version.id,
        beforeSummary: { crosswalkStatus: "HOLD" },
        afterSummary: { ...plan, verifiedAt: verifiedAt.toISOString() },
      },
    });
  });
  console.log(JSON.stringify({ ok: true, dryRun: false, ...plan, verifiedAt: verifiedAt.toISOString() }));
} finally {
  await db.$disconnect();
}
