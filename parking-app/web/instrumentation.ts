import type { Instrumentation } from "next";

// Server-side error tracking, only when SENTRY_DSN is set at runtime. No personal data is sent.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.APP_ENV ?? "local", sendDefaultPii: false, tracesSampleRate: 0 });
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.captureException(err, { tags: { path: request.path, method: request.method, route: context.routePath, kind: context.routeType } });
};
