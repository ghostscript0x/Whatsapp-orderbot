import pino from "pino";

/** Structured logger. Always pass tenantId / jobId in the bindings when available. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["*.password", "*.passwordHash", "*.apiKey", "*.secret", "*.token", "headers.authorization"],
});
