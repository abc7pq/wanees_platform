import {
  FEATURE_FLAGS,
  type FeatureFlagName,
  type PublicFeatureFlags,
} from "../../packages/contracts/src/index.ts";

export { FEATURE_FLAGS };

const defaults: Record<FeatureFlagName, boolean> = {
  [FEATURE_FLAGS.browserCookieSession]: true,
  [FEATURE_FLAGS.proposalConcurrency]: true,
  [FEATURE_FLAGS.map2dV2]: true,
  [FEATURE_FLAGS.llmAdapter]: true,
  [FEATURE_FLAGS.retentionJob]: true,
  // Off by default: turning it on makes name + verified phone required before a visit starts.
  [FEATURE_FLAGS.visitorRegistration]: false,
  // On by default: two visitors who said the same thing get different, equally valid routes.
  [FEATURE_FLAGS.planVariety]: true,
};

function readBoolean(name: FeatureFlagName) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off") return false;
  if (value === "1" || value === "true" || value === "on") return true;
  return defaults[name];
}

export function isFeatureEnabled(name: FeatureFlagName) {
  return readBoolean(name);
}

/** The per-visit seed for route variety (agent v8): the session id, or nothing when the flag is off. */
export function planVarietySeed(sessionId: string): string | undefined {
  return readBoolean(FEATURE_FLAGS.planVariety) ? sessionId : undefined;
}

export function getPublicFeatureFlags(): PublicFeatureFlags {
  return {
    browserCookieSession: readBoolean(FEATURE_FLAGS.browserCookieSession),
    proposalConcurrency: readBoolean(FEATURE_FLAGS.proposalConcurrency),
    map2dV2: readBoolean(FEATURE_FLAGS.map2dV2),
    llmAdapter: readBoolean(FEATURE_FLAGS.llmAdapter),
    visitorRegistration: readBoolean(FEATURE_FLAGS.visitorRegistration),
  };
}
