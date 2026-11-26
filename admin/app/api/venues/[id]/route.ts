import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function retired() {
  return NextResponse.json({ error: { code: "LEGACY_SURFACE_RETIRED", message: "استخدم مساحة الفعاليات PostgreSQL من /events." } }, { status: 410, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  return retired();
}

export async function POST() {
  return retired();
}

export async function PUT() {
  return retired();
}

export async function DELETE() {
  return retired();
}
