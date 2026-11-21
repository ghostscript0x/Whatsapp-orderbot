import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { getSystemStatus, type SystemStatus } from "@/lib/system-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEOUT_MS = 2000;

type Check = { ok: boolean; latencyMs: number; error?: string };

class CheckTimeout extends Error {}

/**
 * Runs one dependency check with a hard timeout. Error text is reduced to a short, fixed reason
 * so hostnames, credentials or connection strings never reach this public endpoint.
 */
async function runCheck(name: string, fn: (signal: AbortSignal) => Promise<string | null>): Promise<Check> {
  const started = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CheckTimeout());
    }, TIMEOUT_MS);
  });
  try {
    const problem = await Promise.race([fn(controller.signal), timeout]);
    const latencyMs = Math.round(performance.now() - started);
    return problem ? { ok: false, latencyMs, error: problem } : { ok: true, latencyMs };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const timedOut = err instanceof CheckTimeout;
    // Full detail goes to the server log only.
    logger.warn({ check: name, timedOut, err: timedOut ? undefined : err }, "health check failed");
    return { ok: false, latencyMs, error: timedOut ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** SQLite locally, Postgres in production: either way a trivial query proves the connection. */
async function checkDatabase(): Promise<string | null> {
  await prisma.$queryRaw`SELECT 1`;
  return null;
}

async function checkRedis(): Promise<string | null> {
  const pong = await redis().ping();
  return pong === "PONG" ? null : "unexpected reply";
}

/**
 * Lists sessions filtered by a name no tenant can have (tenant names are `t-<id>`), which proves
 * the gateway is up AND the API key is accepted, while returning an empty list.
 */
async function checkOpenWa(signal: AbortSignal): Promise<string | null> {
  const { OPENWA_BASE_URL, OPENWA_API_KEY } = env();
  if (!OPENWA_API_KEY) return "not configured";
  const url = new URL(`${OPENWA_BASE_URL.replace(/\/+$/, "")}/api/sessions`);
  url.searchParams.set("name", "healthcheck");
  const res = await fetch(url, { headers: { "X-API-Key": OPENWA_API_KEY }, signal, cache: "no-store" });
  await res.body?.cancel();
  if (res.status === 401 || res.status === 403) return "auth rejected";
  return res.ok ? null : `http ${res.status}`;
}

/** The worker has no endpoint of its own; its Redis heartbeat stands in for a ping. */
function workerCheck(system: SystemStatus): Check {
  return system.workerOnline ? { ok: true, latencyMs: 0 } : { ok: false, latencyMs: 0, error: "offline" };
}

/**
 * GET /api/health — 200 when the database, Redis and OpenWA respond and the worker heartbeat is fresh,
 * else 503 with status "degraded". `system` mirrors the dashboard's worker status. Public, no secrets.
 */
export const GET = route(async () => {
  const [database, redisCheck, openwa, system] = await Promise.all([
    runCheck("database", checkDatabase),
    runCheck("redis", checkRedis),
    runCheck("openwa", checkOpenWa),
    getSystemStatus(),
  ]);
  const checks = { database, redis: redisCheck, openwa, worker: workerCheck(system) };
  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", time: new Date().toISOString(), checks, system },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
});
