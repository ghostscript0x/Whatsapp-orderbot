import IORedis, { type Redis } from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as unknown as { redis?: Redis };

/** Shared connection for app code (dedupe, locks, rate limits, caches). */
export function redis(): Redis {
  if (!globalForRedis.redis) {
    globalForRedis.redis = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: 3 });
  }
  return globalForRedis.redis;
}

/** BullMQ needs its own connections with maxRetriesPerRequest = null. */
export function bullConnection(): Redis {
  return new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
}

/** SET NX with TTL. Returns true if this caller won (key did not exist). */
export async function setOnce(key: string, ttlSeconds: number): Promise<boolean> {
  const res = await redis().set(key, "1", "EX", ttlSeconds, "NX");
  return res === "OK";
}

/**
 * Simple distributed lock. Returns a release function, or null if the lock is held.
 * Release only deletes the key if we still own it.
 */
export async function acquireLock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
  const token = crypto.randomUUID();
  const ok = await redis().set(key, token, "PX", ttlMs, "NX");
  if (ok !== "OK") return null;
  return async () => {
    await redis().eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token,
    );
  };
}

/** Fixed-window rate limit. Returns true when the call is allowed. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  // INCR and EXPIRE in one MULTI: if they were separate calls and the process died in between,
  // the counter would never expire and the caller would stay rate-limited forever.
  const res = await redis().multi().incr(k).expire(k, windowSeconds).exec();
  const [incrErr, n] = res?.[0] ?? [new Error("rate limit transaction was aborted"), null];
  if (incrErr) throw incrErr;
  return Number(n) <= limit;
}
