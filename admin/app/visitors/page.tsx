import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import VisitorList from "./visitor-list";

export const dynamic = "force-dynamic";

export default async function VisitorsPage() {
  if (!(await isAuthed())) redirect("/login");
  return <VisitorList />;
}
