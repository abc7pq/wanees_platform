// The agent contract (audit 5.1): one request and one response for every screen — the phone (web), a
// live voice call and a kiosk. Clients only send what the visitor said or tapped and where they are; every
// fact, price, time and route comes back from the server. The server owns all logic.

/** Where a visit runs. A call is the phone visit's own session speaking; a kiosk has its own session. */
export const AGENT_CHANNELS = ["web", "call", "kiosk"] as const;
export type AgentChannel = (typeof AGENT_CHANNELS)[number];

/** How the reply is delivered: written, spoken by the browser, or phrased by the live call's voice. */
export const AGENT_REPLY_MODES = ["text", "voice", "call"] as const;
export type AgentReplyMode = (typeof AGENT_REPLY_MODES)[number];

export const AGENT_LANGUAGES = ["ar", "en", "fr", "ur"] as const;
export type AgentLanguage = (typeof AGENT_LANGUAGES)[number];

/** A kiosk visit ends after this long without a request; its next visitor starts fresh. */
export const KIOSK_IDLE_SECONDS = 60;

/** A walkway node id snapped on the device (never coordinates), or the kiosk's own node. */
export interface AgentPosition {
  nodeId: string;
  accuracyM?: number;
  capturedAt: string;
  source: "gps" | "kiosk" | "spoken";
}

/** POST /api/v1/events/{slug}/assistant. Exactly one of message or action. */
export interface AgentRequest {
  message?: string;
  /** An A2UI v1.0 action from a tapped card button. */
  action?: { action: { name: string; context?: Record<string, unknown> } } & Record<string, unknown>;
  /** The reply mode (the session decides the channel). Default text. */
  channel?: AgentReplyMode;
  /** Ignored on a kiosk: the kiosk's node is always the origin. */
  position?: AgentPosition;
  /** The reply language when the visitor picked one (a kiosk's language button); else it follows their words. */
  language?: AgentLanguage;
  /** A kiosk with a redeemed phone link reads that visit's plan, read-only. */
  linkGrantId?: string;
}

export interface AgentSource {
  type: string;
  id: string;
  name?: string;
  zone?: string;
  [key: string]: unknown;
}

export interface AgentDirections {
  targetId: string;
  totalWalkMin: number;
  avoided: string[];
  [key: string]: unknown;
}

/** The response body's `data`. Every fact in `message` is also in `sources`, `directions` or the plan. */
export interface AgentResponse {
  message: string;
  /** A2UI v1.0 messages for the cards, or null. */
  ui: unknown[] | null;
  intent: string;
  tool: string | null;
  confidence: string;
  needsClarification: boolean;
  itineraryId: string | null;
  itinerary: unknown | null;
  proposal: unknown | null;
  next: unknown | null;
  sources: AgentSource[];
  warnings: unknown[];
  directions: AgentDirections | null;
  handoff: { id: string; status: string } | null;
  clock: unknown;
  position: { zone: string; source: "gps" | "kiosk" | "spoken" } | null;
  positionRejected?: string;
  understanding: { language: AgentLanguage; assumptions: unknown[]; question: unknown };
  /** Live call only: the compact facts the voice may say. */
  facts?: Record<string, unknown>;
  /** Present when the answer came from a linked phone visit. */
  linked?: { scope: "read" };
}

/**
 * The facts of a reply, without wording: what three screens must agree on for the same question
 * (audit 5.3). The text may differ (a call is shorter), the facts may not.
 */
export function agentFacts(response: Pick<AgentResponse, "intent" | "sources" | "directions" | "position">) {
  const sources = (response.sources ?? [])
    .map((source) => [source.type, source.id, source.zone ?? "", source.priceSar ?? source.price ?? "", source.walkMin ?? ""].join("|"))
    .sort();
  return {
    intent: response.intent,
    sources,
    directions: response.directions ? { targetId: response.directions.targetId, totalWalkMin: response.directions.totalWalkMin } : null,
    origin: response.position ? response.position.zone : null,
  };
}
