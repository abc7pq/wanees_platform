export const PITCH_EVENT_SLUG = "boulevard-world-pitch";
export const PITCH_ORGANIZATION_SLUG = "wanees-pitch";

export const API_CONTRACT_VERSION = "v1" as const;

export type ClientType = "web" | "native";

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "EVENT_NOT_FOUND"
  | "EVENT_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "SESSION_TOKEN_REQUIRED"
  | "SESSION_NOT_FOUND"
  | "ITINERARY_NOT_FOUND"
  | "CATALOG_VERSION_UNAVAILABLE"
  | "CATALOG_INCOMPLETE"
  | "PROPOSAL_REQUIRED"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_STALE"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_REQUEST_IN_PROGRESS"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR";

export interface ApiMeta {
  contractVersion: typeof API_CONTRACT_VERSION;
  requestId: string;
  persistence?: "postgresql" | "json-fallback";
  [key: string]: unknown;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
  };
  meta: ApiMeta;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export const FEATURE_FLAGS = {
  browserCookieSession: "WANEES_FEATURE_BROWSER_COOKIE_SESSION",
  proposalConcurrency: "WANEES_FEATURE_PROPOSAL_CONCURRENCY",
  map2dV2: "WANEES_FEATURE_MAP_2D_V2",
  llmAdapter: "WANEES_FEATURE_LLM_ADAPTER",
  retentionJob: "WANEES_FEATURE_RETENTION_JOB",
} as const;

export type FeatureFlagName = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

export interface PublicFeatureFlags {
  browserCookieSession: boolean;
  proposalConcurrency: boolean;
  map2dV2: boolean;
  llmAdapter: boolean;
}

export interface LiveRevision {
  value: string;
  updateCount: number;
  snapshotCount: number;
  capturedAt: string;
}

export interface ProposalMetadata {
  proposalId: string | null;
  baseItineraryId: string;
  baseLiveRevision: string;
  proposalExpiresAt: string | null;
}

export interface AssistantProposal<TItinerary = unknown, TDiff = unknown> {
  id: string;
  candidate: TItinerary;
  baseItineraryId: string;
  baseLiveRevision: string;
  proposalExpiresAt: string | null;
  diff: TDiff;
}

// ---------------------------------------------------------------------------
// منسّق الحركة + منسّق الموسم (ص6) — عقد النقل بين المحرك والواجهات
// ---------------------------------------------------------------------------
export const COORDINATOR_CONTRACT_VERSION = "v1" as const;

export interface ZoneLoadContract {
  zone: string;
  name: string;
  crowd: number; // 0..1
  loadFactor: number; // 0..1
  overThreshold: boolean;
  spareCapacity: number; // 0..1
}

export interface DiversionTargetContract {
  zone: string;
  name: string;
  score: number;
  reason: "spare_capacity" | "hidden_gem" | "low_crowd";
}

export interface SeasonIncentiveContract {
  zone: string;
  name: string;
  kind: "hidden_gem" | "peak_relief" | "comfort";
  priority: number;
  rationale: string;
}

export interface CoordinatorPlanContract {
  contractVersion: typeof COORDINATOR_CONTRACT_VERSION;
  atMinute: number;
  zones: ZoneLoadContract[];
  diversionTargets: DiversionTargetContract[];
  incentives: SeasonIncentiveContract[];
}

export interface ZoneStatContract {
  zone: string;
  crowd: number;
  plannedStops: number;
}

// ---------------------------------------------------------------------------
// مقاييس النجاح الأربعة (ص11) — عقد تقرير التقييم
// ---------------------------------------------------------------------------
export const SUCCESS_METRICS_VERSION = "v1" as const;

/** Presentation rollout gates: baseline, pilot, and measured expansion. */
export type SuccessStage = 60 | 70 | 80;

export interface LatencyStatsContract {
  p50Ms: number;
  p95Ms: number;
}

export interface SuccessMetricResultContract {
  name: string;
  score: number; // 0..100
  stage: SuccessStage;
  detail: string;
}

export interface EvalReportContract {
  contractVersion: typeof SUCCESS_METRICS_VERSION;
  at: string;
  metrics: SuccessMetricResultContract[];
  overallStage: SuccessStage;
  summary: string;
}

// ---------------------------------------------------------------------------
// (٢) مصدر بيانات الزحام القابل للاستبدال (ص6 «البوابات والعدّادات»)
// ---------------------------------------------------------------------------
export const CROWD_SOURCE_CONTRACT_VERSION = "v1" as const;

export interface ZoneCrowdSnapshotContract {
  zone: string;
  crowd: number; // 0..1
  updatedAtMinute: number;
}

export interface CrowdReadingContract {
  atMinute: number;
  zones: ZoneCrowdSnapshotContract[];
}

/** مصدر زحام قابل للاستبدال: قراءة واحدة تُعيد أحمال كل المناطق عند دقيقة معيّنة */
export interface CrowdDataSourceContract {
  readonly kind: string;
  readZones(atMinute: number): ZoneCrowdSnapshotContract[];
}

export interface SimulatedCrowdConfigContract {
  seed: number;
  baseCurve: Record<string, number>; // ساعة -> 0..1
  zonePopularity: Record<string, number>; // منطقة -> 0..1
  noiseAmp?: number;
}

// ---------------------------------------------------------------------------
// (١) حزام المحاكاة المقارنة (ص11 «نختبر بالمحاكاة»)
// ---------------------------------------------------------------------------
export const SIMULATION_CONTRACT_VERSION = "v1" as const;

export type SimulationStrategyContract = "least_crowded" | "coordinator";

export interface SimulationZoneSpecContract {
  id: string;
  name: string;
  popularity: number; // 0..1
  capacity: number;
  serviceRatePerMin: number;
}

export interface SimulationScenarioContract {
  seed: number;
  horizonMinutes: number;
  arrivalsPerMin: number;
  zones: SimulationZoneSpecContract[];
}

export interface StrategyOutcomeContract {
  strategy: SimulationStrategyContract;
  visitors: number;
  totalWaitMin: number;
  avgWaitMin: number;
  loadBalancePct: number;
  peakCrowd: number;
  overflow: number;
  gemUtilization: number;
}

export interface SimulationComparisonContract {
  contractVersion: typeof SIMULATION_CONTRACT_VERSION;
  seed: number;
  horizonMinutes: number;
  leastCrowded: StrategyOutcomeContract;
  coordinator: StrategyOutcomeContract;
  winner: SimulationStrategyContract | "tie";
  acceptance: { passed: boolean; reasons: string[] };
}

// --- Weather data source contract -------------------------------------------
// Canonical output shape shared by the visitor app, the season coordinator, and
// any future real weather provider adapter. The port (WeatherSource) and the
// deterministic stub live in `app/engine/weather.ts`; the real provider is
// deferred until one is selected.

export const WEATHER_CONTRACT_VERSION = "v1" as const;

export type WeatherCondition =
  | "clear"
  | "partly_cloudy"
  | "cloudy"
  | "rain"
  | "windy"
  | "hot"
  | "cold"
  | "unknown";

export type WeatherImpactHint =
  | "outdoor_fine"
  | "no_impact"
  | "indoor_preferred"
  | "heat_precaution"
  | "rain_precaution"
  | "wind_precaution";

export interface WeatherReading {
  /** Event zone/region key the reading applies to. */
  region: string;
  /** ISO-8601 instant of the observation. */
  at: string;
  /** Air temperature in degrees Celsius. */
  temperatureCelsius: number;
  condition: WeatherCondition;
  impactHint: WeatherImpactHint;
  /** Provider identifier; the deterministic stub reports "deterministic-stub". */
  source: string;
}

/** ADR-004: the only live-source signal crossing the visitor/admin boundary. */
export interface LiveSignalContract { offline: boolean; }

/** ADR-005: runtime and persisted session counts have distinct meanings. */
export interface SessionCountsContract {
  liveSessions: number;
  catalogSeeded: number;
}
