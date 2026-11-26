import * as Sentry from "@sentry/nextjs";

const dsn = process.env.WANEES_ERROR_MONITORING_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  beforeSend(event) {
    return {
      ...event,
      user: undefined,
      request: undefined,
      extra: undefined,
      breadcrumbs: [],
      message: undefined,
      tags: undefined,
      exception: event.exception
        ? { values: event.exception.values?.map((item) => ({ ...item, value: undefined })) }
        : undefined,
    };
  },
});
