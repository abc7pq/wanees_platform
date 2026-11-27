import { z } from "zod";
import { AGENT_LANGUAGES, type ClientType } from "../../packages/contracts/src/index.ts";
import { a2uiActionMessageSchema } from "./a2ui.ts";
import { visitorPositionSchema } from "./visitor-position.ts";

const text = (max: number) => z.string().trim().min(1).max(max);

export const visitorPreferencesSchema = z.object({
  companions: text(40).optional(),
  partySize: z.number().int().min(1).max(20).nullable().optional(),
  youngestChildAge: z.number().int().min(0).max(17).nullable().optional(),
  mood: text(40).optional(),
  interests: z.array(text(40)).max(12).optional(),
  budgetMaxCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  availableMinutes: z.number().int().min(10).max(24 * 60).nullable().optional(),
  walkingTolerance: text(20).optional(),
  startPointId: text(120).optional(),
  optInPersist: z.boolean().optional(),
}).strict();

export const createVisitorSessionSchema = z.object({
  locale: z.enum(["ar-SA", "en"]).default("ar-SA"),
  // kiosk: a venue screen (audit 5.2); it must also send its device token in x-wanees-kiosk-token.
  clientType: z.enum(["web", "native", "kiosk"]).default("web"),
  entryPoint: text(120).optional(),
  consentState: z.object({}).catchall(z.unknown()).optional(),
  preferences: visitorPreferencesSchema.optional(),
}).strict();

// Registered visitors: the name and phone are validated again by cleanVisitorName/normalizeSaudiMobile.
export const visitorOtpStartSchema = z.object({
  name: z.string().max(120),
  phone: z.string().max(40),
  consent: z.literal(true),
  consentVersion: text(80),
  clientType: z.enum(["web", "native"]).default("web"),
}).strict();

export const visitorOtpVerifySchema = z.object({
  challengeId: text(64),
  // Twilio Verify and the test provider both use 6-digit codes; anything else would only burn an attempt.
  code: z.string().trim().regex(/^[0-9٠-٩۰-۹]{6}$/),
  rememberDevice: z.boolean().default(true),
  clientType: z.enum(["web", "native"]).default("web"),
}).strict();

export const itineraryRequestSchema = z.object({
  preferences: visitorPreferencesSchema.optional(),
  generatedReason: text(160).optional(),
}).strict();

export const assistantRequestSchema = z.object({
  // Exactly one of: a typed/spoken message, or an A2UI v1.0 action from a tapped card button.
  message: text(500).optional(),
  action: a2uiActionMessageSchema.optional(),
  // text: written reply. voice: short spoken reply (browser speech fallback). call: live realtime call;
  // the server returns the engine draft plus compact facts and the realtime voice phrases them.
  channel: z.enum(["text", "voice", "call"]).optional(),
  // Audit 3.1: where the visitor is, as a walkway node id snapped on the device (never coordinates).
  position: visitorPositionSchema.optional(),
  // Audit 5.1: a reply language the visitor picked on the screen, and a kiosk's redeemed phone link.
  language: z.enum(AGENT_LANGUAGES).optional(),
  linkGrantId: text(64).optional(),
}).strict().refine((value) => Boolean(value.message) !== Boolean(value.action), {
  message: "Send either message or action.",
});

export const liveUpdateRequestSchema = z.object({
  updateType: z.enum(["CLOSURE", "DELAY", "SCHEDULE_CHANGE", "CROWD_OVERRIDE", "CONTENT_CORRECTION"]),
  targetType: z.enum(["event", "zone", "activity"]),
  targetId: text(120).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.targetType === "zone" || value.targetType === "activity") && !value.targetId) {
    ctx.addIssue({ code: "custom", path: ["targetId"], message: "targetId is required for zone/activity updates" });
  }
  if (value.updateType === "CROWD_OVERRIDE" && value.targetType !== "zone") {
    ctx.addIssue({ code: "custom", path: ["targetType"], message: "crowd overrides must target a zone" });
  }
  if (value.updateType === "CROWD_OVERRIDE" && (typeof value.payload.level !== "number" || value.payload.level < 0 || value.payload.level > 1)) {
    ctx.addIssue({ code: "custom", path: ["payload", "level"], message: "level must be between 0 and 1" });
  }
  if (value.startsAt && value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt must be after startsAt" });
  }
});

export const replanRequestSchema = z.object({
  nowMinute: z.number().int().min(0).max(24 * 60).optional(),
  reason: text(160).optional(),
  decision: z.enum(["preview", "accept", "keep_current"]).default("preview"),
  proposalId: text(100).optional(),
  baseItineraryId: text(100).optional(),
  baseLiveRevision: text(160).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "accept") {
    const required: Array<[keyof typeof value, string]> = [
      ["proposalId", "proposalId is required when accepting a replan proposal"],
      ["baseItineraryId", "baseItineraryId is required when accepting a replan proposal"],
      ["baseLiveRevision", "baseLiveRevision is required when accepting a replan proposal"],
    ];
    for (const [field, message] of required) {
      if (!value[field]) ctx.addIssue({ code: "custom", path: [field], message });
    }
  }
});

export const analyticsEventSchema = z.object({
  metricName: z.enum(["session_started", "itinerary_created", "assistant_message", "activity_viewed", "activity_selected", "replan_requested", "replan_applied", "replan_proposed", "replan_dismissed", "crowd_warning_seen", "time_to_plan_seconds", "update_delivery_seconds", "visit_rating"]),
  metricValue: z.number().finite().min(0).max(1_000_000).default(1),
  zoneKey: text(120).optional(),
  activityKey: text(120).optional(),
}).strict().refine(
  // A visit rating is a whole number of stars, 1–5; it is stored only as an anonymous aggregate.
  (event) => event.metricName !== "visit_rating" || (Number.isInteger(event.metricValue) && event.metricValue >= 1 && event.metricValue <= 5),
  { message: "visit_rating must be a whole number from 1 to 5", path: ["metricValue"] },
);

export type CreateVisitorSessionInput = z.infer<typeof createVisitorSessionSchema>;
export type VisitorClientType = ClientType;
export type AssistantRequestInput = z.infer<typeof assistantRequestSchema>;
export type LiveUpdateRequestInput = z.infer<typeof liveUpdateRequestSchema>;
export type ReplanRequestInput = z.infer<typeof replanRequestSchema>;
export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;
