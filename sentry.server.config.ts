import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // Errors only by default; set SENTRY_TRACES_SAMPLE_RATE (0..1) to enable performance tracing.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // Customer phone numbers and chats are personal data: never attach IPs, cookies or bodies.
    sendDefaultPii: false,
  });
}
