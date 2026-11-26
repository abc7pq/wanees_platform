import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The old event address keeps working: it moves to /e/{slug} with its query (a nudge link, say).
export default async function EventPage({ params, searchParams }: {
  params: Promise<{ eventSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventSlug } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value == null ? [] : [value]) query.append(key, item);
  }
  const suffix = query.toString();
  redirect(`/e/${encodeURIComponent(eventSlug)}${suffix ? `?${suffix}` : ""}`);
}
