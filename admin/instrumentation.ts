import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WANEES_ERROR_MONITORING_DSN) {
    await import("./sentry.server.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
