import { redis } from "./redis";
import { logger } from "./logger";

/**
 * Worker liveness via a Redis heartbeat. The worker writes the current ISO time to
 * WORKER_HEARTBEAT_KEY every WORKER_HEARTBEAT_INTERVAL_MS with a TTL of WORKER_HEARTBEAT_TTL_S,
 * so the key disappears ~45 s after the worker stops (or immediately on a clean shutdown).
 */
export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
export const WORKER_HEARTBEAT_TTL_S = 45;

/** Redis down must not hang the dashboard: give up after this long and report the worker offline. */
const READ_TIMEOUT_MS = 1500;

export type SystemStatus = { workerOnline: boolean; lastHeartbeatAt: string | null };

export async function writeWorkerHeartbeat(now: Date = new Date()): Promise<void> {
  await redis().set(WORKER_HEARTBEAT_KEY, now.toISOString(), "EX", WORKER_HEARTBEAT_TTL_S);
}

export async function clearWorkerHeartbeat(): Promise<void> {
  await redis().del(WORKER_HEARTBEAT_KEY);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Is the bot worker alive? A missing key means no heartbeat within the TTL.
 * If Redis itself is unreachable the worker cannot be processing jobs either, so that is
 * reported as offline (and logged) instead of failing the caller's whole request.
 */
export async function getSystemStatus(): Promise<SystemStatus> {
  try {
    const value = await withTimeout(redis().get(WORKER_HEARTBEAT_KEY), READ_TIMEOUT_MS);
    return { workerOnline: value !== null, lastHeartbeatAt: value };
  } catch (err) {
    logger.warn({ err }, "could not read worker heartbeat from Redis; reporting worker offline");
    return { workerOnline: false, lastHeartbeatAt: null };
  }
}
