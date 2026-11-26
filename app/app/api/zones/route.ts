import { NextResponse } from "next/server";
import { loadActiveCatalog } from "@/lib/venues.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    zones: loadActiveCatalog().zones.map((z) => ({ id: z.id, name: z.name, x: z.x, y: z.y })),
  });
}
