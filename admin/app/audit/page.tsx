import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import AuditList from "./audit-list";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  if (!(await isAuthed())) redirect("/login");
  return <AuditList />;
}
