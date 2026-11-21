import * as Sentry from "@sentry/nextjs";

/** Next.js instrumentation hook. Sentry is only initialised when SENTRY_DSN is set. */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

/** Reports errors thrown in server components, route handlers and middleware (no-op when Sentry is not initialised). */
export const onRequestError = Sentry.captureRequestError;
