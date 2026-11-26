import assert from "node:assert/strict";
import { readOffsiteBackupConfig, signedS3Put } from "./offsite-backup.ts";

assert.equal(readOffsiteBackupConfig({}), null);
assert.throws(() => readOffsiteBackupConfig({ WANEES_BACKUP_OFFSITE_REQUIRED: "true" }), /offsite backups are required/i);

const config = readOffsiteBackupConfig({
  WANEES_BACKUP_S3_ENDPOINT: "https://objects.example.test",
  WANEES_BACKUP_S3_BUCKET: "wanees-backups",
  WANEES_BACKUP_S3_REGION: "eu-west-1",
  WANEES_BACKUP_S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
  WANEES_BACKUP_S3_SECRET_ACCESS_KEY: "secret-example",
  WANEES_BACKUP_S3_PREFIX: "prod/db",
});
assert.ok(config);
const signed = signedS3Put(config, "wanees-db-20261123T000000Z-a1b2c3.wan.enc", "a".repeat(64), new Date("2026-11-23T00:00:00.000Z"));
assert.equal(signed.key, "prod/db/wanees-db-20261123T000000Z-a1b2c3.wan.enc");
assert.match(signed.url, /objects\.example\.test\/wanees-backups\/prod\/db\/wanees-db-/);
assert.match(signed.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//);
assert.equal(signed.headers["x-amz-content-sha256"], "a".repeat(64));
assert.throws(() => signedS3Put(config, "not-a-wanees-file.dump", "a".repeat(64)), /naming convention/i);
console.log("offsite backup configuration and SigV4 signing passed");
