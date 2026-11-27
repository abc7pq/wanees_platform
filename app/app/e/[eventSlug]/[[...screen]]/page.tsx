import DemoPage from "../../../demo/page";
import { visitorViewport } from "@/lib/visitor-viewport";

export const generateViewport = visitorViewport;

export const dynamic = "force-dynamic";

// The visitor app's canonical address (audit 2.1): /e/{slug} is «ونيس», and /plan, /map, /nearby, /me
// and /guide/{id} are its other screens. The guide reads the slug and the screen from the URL.
export default function VisitorEventPage() {
  return <DemoPage />;
}
