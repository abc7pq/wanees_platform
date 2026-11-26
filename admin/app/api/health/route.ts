import { NextResponse } from "next/server";
import { checkDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const database = await checkDatabase();
  const healthy = database.configured && database.reachable && database.catalogReady;
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", service: "wanees-admin-web", timestamp: new Date().toISOString(), checks: { database: database.reachable, publishedCatalog: database.catalogReady } },
    { status: healthy ? 200 : 503 },
  );
}
