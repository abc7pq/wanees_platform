import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import EventList from "./event-list";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  if (!(await isAuthed())) redirect("/login");
  return <EventList />;
}
