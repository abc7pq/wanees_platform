import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) redirect("/login");
  await params;
  redirect("/events");
}
