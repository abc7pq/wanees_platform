import { spawn } from "node:child_process";

export function postgresEnvironment(connectionString: string) {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("A PostgreSQL URL is required.");
  const env = { ...process.env };
  delete env.DATABASE_URL;
  env.PGHOST = url.hostname;
  env.PGPORT = url.port || "5432";
  env.PGUSER = decodeURIComponent(url.username);
  env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGDATABASE = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode) env.PGSSLMODE = sslMode;
  env.PGCONNECT_TIMEOUT = env.PGCONNECT_TIMEOUT ?? "10";
  return env;
}

export function runPostgresTool(program: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      if (outputBytes < 16_384) {
        const part = chunk.subarray(0, Math.max(0, 16_384 - outputBytes));
        output.push(part);
        outputBytes += part.length;
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes < 16_384) {
        const part = chunk.subarray(0, Math.max(0, 16_384 - errorBytes));
        errors.push(part);
        errorBytes += part.length;
      }
    });
    child.once("error", () => reject(new Error(`${program} could not start; install PostgreSQL client tools.`)));
    child.once("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(output).toString("utf8"));
      const detail = Buffer.concat(errors).toString("utf8").trim();
      reject(new Error(`${program} failed with exit code ${code ?? "unknown"}.${detail ? ` ${detail}` : ""}`));
    });
  });
}

export function assertDifferentDatabase(sourceUrl: string, targetUrl: string) {
  const source = new URL(sourceUrl);
  const target = new URL(targetUrl);
  const sameServer = source.hostname.toLowerCase() === target.hostname.toLowerCase()
    && (source.port || "5432") === (target.port || "5432");
  const sourceDb = decodeURIComponent(source.pathname.replace(/^\//, ""));
  const targetDb = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (sameServer && sourceDb === targetDb) throw new Error("Restore smoke URL must point to a different database from DATABASE_URL.");
}
