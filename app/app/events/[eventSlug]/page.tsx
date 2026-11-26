import DemoPage from "../../demo/page";

export const dynamic = "force-dynamic";

// The visitor guide reads the event slug from the URL and disables the legacy
// in-memory fallback on /events/* routes, so this page only needs to render it.
export default function EventPage() {
  return <DemoPage />;
}
