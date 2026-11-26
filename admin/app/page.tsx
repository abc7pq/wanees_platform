import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  if (!(await isAuthed())) redirect("/login");
  const { event } = await searchParams;
  return <Dashboard initialEvent={typeof event === "string" ? event : ""} />;
}
