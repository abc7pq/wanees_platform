// أنواع البيانات — مطابقة لنموذج الكتالوج والبروفايل والمسار
export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  popularity: number;
}

export type RouteNodeType = "ENTRANCE" | "ZONE" | "ACTIVITY" | "LANDMARK" | "SERVICE";

export interface Location {
  id: string;
  label: string;
  type: RouteNodeType;
  zone?: string;
  x: number;
  y: number;
  accessible: boolean;
  status: string;
  description?: string;
  aliases: string[];
  sourceRef: string;
}

export interface RouteGraphNode {
  id: string;
  type: RouteNodeType;
  label: string;
  zone?: string;
  x: number;
  y: number;
  accessible: boolean;
  status: string;
}

export interface RouteGraphEdge {
  from: string;
  to: string;
  distanceM: number;
  walkMin: number;
  accessible: boolean;
  status: string;
}

export interface RouteGraph {
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
}

export type Schedule =
  | { type: "slots"; slots: number[] }
  | { type: "continuous"; from: number; to: number };

export interface Activity {
  id: string;
  name: string;
  name_en?: string;
  zone: string;
  type: string;
  duration_min: number;
  price: number;
  price_known?: boolean;
  /** Set only when the price was checked on an official ticket seller; otherwise the price is an estimate. */
  price_source?: { url: string; title: string; checked: string };
  eligibility_known?: boolean;
  family: boolean;
  min_age?: number;
  interests: string[];
  moods: string[];
  popularity: number;
  schedule: Schedule;
}

export interface SiteConfig {
  name: string;
  walking_speed_m_per_min: number;
  min_walk_min: number;
  opening: { from: number; to: number };
  crowd_threshold: number;
  base_crowd_curve: Record<string, number>;
  /** Entry ticket from the official seller, when the catalog has a sourced price. */
  entry_ticket?: { price: number; url: string; checked: string };
}

export interface Catalog {
  meta: { source: string; note: string; currency: string };
  site: SiteConfig;
  zones: Zone[];
  activities: Activity[];
  locations?: Location[];
  routeGraph?: RouteGraph;
}

export interface Profile {
  mood?: string;
  budget?: number | null;
  companions_kids: boolean;
  companions_adults: number;
  /** Everyone in the group, adults and children. Prices are per head, budgets are for the group. */
  party_size?: number;
  /** Age of the youngest child; activities with a higher min_age are skipped. Unknown → skip any age-limited activity. */
  youngest_child_age?: number | null;
  interests: string[];
  start_min: number;
  duration_min: number;
  start_zone: string;
  must_include: string[];
  avoid: string[];
}

export const endMin = (p: Profile) => p.start_min + p.duration_min;

export interface Stop {
  act_id: string;
  zone: string;
  start: number;
  end: number;
  walk_min: number;
  wait_min: number;
  price: number;
  name: string;
  note: string;
}

export interface Itinerary {
  stops: Stop[];
  unfulfilled: string[];
  explanations: string[];
  score: number;
  total_cost: number;
}

export type CrowdEvent =
  | { type: "crowd_spike"; zone: string; level?: number; until_hour?: number; measured?: boolean }
  | { type: "delay"; activity: string; minutes: number }
  | { type: "cancel"; activity: string }
  | { type: "user_skip"; activity: string }
  | { type: "user_add"; activity: string }
  | { type: "user_shorten" }
  | { type: "swap"; activity: string; replacement: string };
