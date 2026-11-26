// أنواع البيانات — مطابقة لنموذج الكتالوج والبروفايل والمسار
export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  popularity: number;
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
}

export interface Catalog {
  meta: { source: string; note: string; currency: string };
  site: SiteConfig;
  zones: Zone[];
  activities: Activity[];
}

export interface Profile {
  mood?: string;
  budget?: number | null;
  companions_kids: boolean;
  companions_adults: number;
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
  | { type: "crowd_spike"; zone: string; level?: number; until_hour?: number }
  | { type: "delay"; activity: string; minutes: number }
  | { type: "cancel"; activity: string }
  | { type: "user_skip"; activity: string }
  | { type: "user_shorten" };
