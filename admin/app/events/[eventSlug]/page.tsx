import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import CatalogWorkspace from "./catalog";

export const dynamic = "force-dynamic";

export default async function EventWorkspacePage({ params }: { params: Promise<{ eventSlug: string }> }) {
  if (!(await isAuthed())) redirect("/login");
  const { eventSlug } = await params;
  return <CatalogWorkspace eventSlug={eventSlug} />;
}