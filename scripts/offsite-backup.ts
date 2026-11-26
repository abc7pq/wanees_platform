import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

export type OffsiteBackupConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  required: boolean;
};

type Environment = Record<string, string | undefined>;

function requiredFlag(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function encodePathSegment(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hex(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function signingKey(secret: string, date: string, region: string) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

export function readOffsiteBackupConfig(env: Environment = process.env): OffsiteBackupConfig | null {
  const required = requiredFlag(env.WANEES_BACKUP_OFFSITE_REQUIRED);
  const raw = {
    endpoint: env.WANEES_BACKUP_S3_ENDPOINT?.trim() ?? "",
    bucket: env.WANEES_BACKUP_S3_BUCKET?.trim() ?? "",
    region: env.WANEES_BACKUP_S3_REGION?.trim() || "us-east-1",
    accessKeyId: env.WANEES_BACKUP_S3_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: env.WANEES_BACKUP_S3_SECRET_ACCESS_KEY?.trim() ?? "",
    prefix: (env.WANEES_BACKUP_S3_PREFIX?.trim() || "wanees").replace(/^\/+|\/+$/g, ""),
  };
  const anyConfigured = [raw.endpoint, raw.bucket, raw.accessKeyId, raw.secretAccessKey].some(Boolean);
  if (!anyConfigured) {
    if (required) throw new Error("Offsite backups are required, but WANEES_BACKUP_S3_* is not configured.");
    return null;
  }
  const missing = Object.entries(raw).filter(([name, value]) => name !== "prefix" && !value).map(([name]) => name);
  if (missing.length) throw new Error(`Incomplete offsite backup configuration: ${missing.join(", ")}.`);
  const endpoint = new URL(raw.endpoint);
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("WANEES_BACKUP_S3_ENDPOINT must use http or https.");
  if (endpoint.protocol !== "https:" && env.NODE_ENV === "production" && !requiredFlag(env.WANEES_BACKUP_S3_ALLOW_INSECURE)) {
    throw new Error("Offsite backup replication requires an HTTPS endpoint in production.");
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(raw.bucket)) throw new Error("WANEES_BACKUP_S3_BUCKET is not a valid bucket name.");
  if (!/^[a-z0-9-]{1,63}$/i.test(raw.region)) throw new Error("WANEES_BACKUP_S3_REGION is not valid.");
  return { ...raw, endpoint: endpoint.toString().replace(/\/$/, ""), required };
}

export function signedS3Put(config: OffsiteBackupConfig, filename: string, payloadHash: string, at = new Date()) {
  const safeFilename = path.basename(filename);
  if (!/^wanees-db-[A-Za-z0-9._-]+\.wan\.enc$/.test(safeFilename)) throw new Error("Refusing to upload a file outside the WANEES backup naming convention.");
  const url = new URL(config.endpoint);
  const key = [config.prefix, safeFilename].filter(Boolean).join("/");
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/${encodePathSegment(config.bucket)}/${key.split("/").map(encodePathSegment).join("/")}`;
  const amzDate = at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const shortDate = amzDate.slice(0, 8);
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${shortDate}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, shortDate, config.region)).update(stringToSign).digest("hex");
  return {
    url: url.toString(),
    key,
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "content-type": "application/octet-stream",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  };
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function uploadEncryptedBackup(filePath: string, filename: string, config: OffsiteBackupConfig) {
  const fileStat = await stat(filePath);
  const payloadHash = await sha256File(filePath);
  const signed = signedS3Put(config, filename, payloadHash);
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: { ...signed.headers, "content-length": String(fileStat.size) },
    body: createReadStream(filePath) as unknown as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240).replace(/\s+/g, " ");
    throw new Error(`Offsite backup upload failed with HTTP ${response.status}.${detail ? ` ${detail}` : ""}`);
  }
  return { key: signed.key, bytes: fileStat.size };
}
