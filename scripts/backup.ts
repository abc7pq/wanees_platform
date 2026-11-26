import { randomBytes, scrypt as scryptCallback, createCipheriv } from "node:crypto";
import { promisify } from "node:util";
import { spawn } from "node:child_process";
import { appendFile, chmod, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { loadProjectEnv } from "./load-project-env.ts";
import { postgresEnvironment } from "./postgres-cli.ts";
import { readOffsiteBackupConfig, uploadEncryptedBackup } from "./offsite-backup.ts";

loadProjectEnv();

const scrypt = promisify(scryptCallback);
const magic = Buffer.from("WNDBAK01");
const headerLength = magic.length + 16 + 12;
const databaseUrl = process.env.DATABASE_URL;
const passphrase = process.env.WANEES_BACKUP_ENCRYPTION_PASSPHRASE;
const directory = path.resolve(process.env.WANEES_BACKUP_DIR || "/var/backups/wanees");
const retentionDays = Number(process.env.WANEES_BACKUP_RETENTION_DAYS || "7");
const offsite = readOffsiteBackupConfig();

if (!databaseUrl) throw new Error("DATABASE_URL is required to create a backup.");
if (!passphrase || passphrase.length < 16) throw new Error("WANEES_BACKUP_ENCRYPTION_PASSPHRASE must contain at least 16 characters.");
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) throw new Error("WANEES_BACKUP_RETENTION_DAYS must be an integer from 1 to 90.");

await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const suffix = randomBytes(3).toString("hex");
const filename = `wanees-db-${stamp}-${suffix}.wan.enc`;
const finalPath = path.join(directory, filename);
const temporaryPath = `${finalPath}.partial`;
const salt = randomBytes(16);
const nonce = randomBytes(12);
const key = (await scrypt(passphrase, salt, 32)) as Buffer;
const cipher = createCipheriv("aes-256-gcm", key, nonce);
const header = Buffer.concat([magic, salt, nonce]);
const childEnv = postgresEnvironment(databaseUrl);
const dump = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-privileges"], { env: childEnv, stdio: ["ignore", "pipe", "ignore"] });
const closed = new Promise<void>((resolve, reject) => {
  dump.once("error", () => reject(new Error("pg_dump could not start; install PostgreSQL client tools.")));
  dump.once("close", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump failed with exit code ${code ?? "unknown"}.`)));
});

try {
  await writeFile(temporaryPath, header, { flag: "wx", mode: 0o600 });
  const output = createWriteStream(temporaryPath, { flags: "a", mode: 0o600 });
  await Promise.all([pipeline(dump.stdout, cipher, output), closed]);
  await appendFile(temporaryPath, cipher.getAuthTag(), { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, finalPath);

  const offsiteResult = offsite ? await uploadEncryptedBackup(finalPath, filename, offsite) : null;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^wanees-db-.*\.wan\.enc$/.test(entry.name)) continue;
    const candidate = path.join(directory, entry.name);
    if ((await stat(candidate)).mtimeMs < cutoff) await rm(candidate);
  }
  console.log(JSON.stringify({ backup: filename, local: true, offsite: offsiteResult ?? { enabled: false } }));
} catch (error) {
  dump.kill();
  await rm(temporaryPath, { force: true }).catch(() => {});
  if (error instanceof Error) throw error;
  throw new Error("Backup failed.");
}
