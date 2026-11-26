import { randomBytes, scrypt as scryptCallback, createDecipheriv } from "node:crypto";
import { promisify } from "node:util";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { loadProjectEnv } from "./load-project-env.ts";
import { assertDifferentDatabase, postgresEnvironment, runPostgresTool } from "./postgres-cli.ts";

loadProjectEnv();

const scrypt = promisify(scryptCallback);
const magic = Buffer.from("WNDBAK01");
const headerLength = magic.length + 16 + 12;
const tagLength = 16;
const sourceUrl = process.env.DATABASE_URL;
const restoreUrl = process.env.WANEES_RESTORE_SMOKE_DATABASE_URL;
const passphrase = process.env.WANEES_BACKUP_ENCRYPTION_PASSPHRASE;
const directory = path.resolve(process.env.WANEES_BACKUP_DIR || "/var/backups/wanees");
if (!sourceUrl || !restoreUrl) throw new Error("DATABASE_URL and WANEES_RESTORE_SMOKE_DATABASE_URL are required.");
if (!passphrase || passphrase.length < 16) throw new Error("WANEES_BACKUP_ENCRYPTION_PASSPHRASE must contain at least 16 characters.");
assertDifferentDatabase(sourceUrl, restoreUrl);

const entries = await readdir(directory, { withFileTypes: true });
const backups = await Promise.all(entries.filter((entry) => entry.isFile() && /^wanees-db-.*\.wan\.enc$/.test(entry.name)).map(async (entry) => {
  const filePath = path.join(directory, entry.name);
  return { filePath, modifiedAt: (await stat(filePath)).mtimeMs };
}));
backups.sort((left, right) => right.modifiedAt - left.modifiedAt);
const latest = backups[0]?.filePath;
if (!latest) throw new Error("No encrypted backup file was found for the restore rehearsal.");

const databaseName = `wanees_restore_${process.pid}_${randomBytes(4).toString("hex")}`;
const dumpPath = path.join(os.tmpdir(), `${databaseName}.dump`);
const backupStat = await stat(latest);
if (backupStat.size < headerLength + tagLength + 1) throw new Error("Encrypted backup is too small or incomplete.");

let databaseCreated = false;
try {
  const handle = await open(latest, "r");
  let header: Buffer;
  let tag: Buffer;
  try {
    header = Buffer.alloc(headerLength);
    tag = Buffer.alloc(tagLength);
    await handle.read(header, 0, headerLength, 0);
    await handle.read(tag, 0, tagLength, backupStat.size - tagLength);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, magic.length).equals(magic)) throw new Error("Backup format is not recognized.");
  const salt = header.subarray(magic.length, magic.length + 16);
  const nonce = header.subarray(magic.length + 16, headerLength);
  const key = (await scrypt(passphrase, salt, 32)) as Buffer;
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const encrypted = createReadStream(latest, { start: headerLength, end: backupStat.size - tagLength - 1 });
  await pipeline(encrypted, decipher, createWriteStream(dumpPath, { flags: "wx", mode: 0o600 }));

  const adminEnv = postgresEnvironment(restoreUrl);
  const restoreDatabase = { ...adminEnv, PGDATABASE: databaseName };
  await runPostgresTool("createdb", [databaseName], adminEnv);
  databaseCreated = true;
  await runPostgresTool("pg_restore", ["--dbname", databaseName, "--exit-on-error", "--no-owner", "--no-privileges", dumpPath], restoreDatabase);
  const counts = await runPostgresTool("psql", ["--tuples-only", "--no-align", "--command", 'SELECT (SELECT count(*) FROM "Event"), (SELECT count(*) FROM "CatalogVersion");'], restoreDatabase);
  const [events, catalogs] = counts.trim().split("|").map(Number);
  if (!Number.isInteger(events) || events < 1 || !Number.isInteger(catalogs) || catalogs < 1) {
    throw new Error("Restore rehearsal completed, but the restored event/catalog tables are empty.");
  }
  console.log(`Restore rehearsal passed: ${events} events and ${catalogs} catalog versions.`);
} finally {
  if (databaseCreated) {
    const adminEnv = postgresEnvironment(restoreUrl);
    await runPostgresTool("dropdb", ["--if-exists", databaseName], adminEnv).catch(() => {
      console.error("Restore rehearsal database cleanup failed; remove the generated temporary database manually.");
    });
  }
  await rm(dumpPath, { force: true });
}
