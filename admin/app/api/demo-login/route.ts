import { NextResponse } from "next/server";

export async function POST(req: Request) {
  void req;
  return NextResponse.json(
    { error: "legacy demo login removed; use the seeded VIEWER account through /api/login" },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
