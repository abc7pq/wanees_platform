import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import MemberList from "./member-list";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  if (!(await isAuthed())) redirect("/login");
  return <MemberList />;
}
