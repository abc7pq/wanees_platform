import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function VenuesPage() {
  if (!(await isAuthed())) redirect("/login");
  // The JSON-file venue editor was a historical demo surface. Durable catalog
  // management now lives under /events and PostgreSQL-backed v1 APIs.
  redirect("/events");
}
