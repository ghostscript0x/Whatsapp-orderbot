import "dotenv/config";
// @sentry/node, not @sentry/nextjs: under tsx the nextjs package loads with its API on `.default`.
import * as Sentry from "@sentry/node";
import type { Worker } from "bullmq";
import { logger } from "../lib/logger";
import { clearWorkerHeartbeat, writeWorkerHeartbeat, WORKER_HEARTBEAT_INTERVAL_MS } from "../lib/system-status";
import { startInboundWorker } from "./inbound-message";
import { startSessionWorker } from "./session-events";
import { startNotificationsWorker } from "./notifications";
import { startMaintenance } from "./maintenance";

/** A clean shutdown that takes longer than this (e.g. a stuck LLM call) is cut short. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV, sendDefaultPii: false });
}

const workers: Worker[] = [startInboundWorker(), startSessionWorker(), startNotificationsWorker()];
const stopMaintenance = startMaintenance();

for (const w of workers) {
  w.on("failed", (job, err) => {
    logger.error({ queue: w.name, jobId: job?.id, tenantId: job?.data?.tenantId, attempt: job?.attemptsMade, err }, "job failed");
    Sentry.captureException(err, { tags: { queue: w.name, tenantId: job?.data?.tenantId } });
  });
  w.on("error", (err) => {
    logger.error({ queue: w.name, err }, "worker error");
    Sentry.captureException(err, { tags: { queue: w.name } });
  });
}

/** Lets the dashboard and /api/health see that the worker is running (lib/system-status.ts). */
async function beat() {
  try {
    await writeWorkerHeartbeat();
  } catch (err) {
    logger.warn({ err }, "worker heartbeat write failed (is Redis reachable?)");
  }
}
void beat();
const heartbeatTimer = setInterval(() => void beat(), WORKER_HEARTBEAT_INTERVAL_MS);

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection in worker");
  Sentry.captureException(reason);
});

logger.info({ queues: workers.map((w) => w.name) }, "worker started");

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker shutting down");
  const force = setTimeout(() => {
    logger.error("worker shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  clearInterval(heartbeatTimer);
  stopMaintenance();
  let exitCode = 0;
  try {
    await Promise.all(workers.map((w) => w.close()));
    // Mark offline right away instead of waiting for the heartbeat TTL to lapse.
    await clearWorkerHeartbeat();
  } catch (err) {
    logger.error({ err }, "error during worker shutdown");
    exitCode = 1;
  }
  await Sentry.close(2000);
  process.exit(exitCode);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
