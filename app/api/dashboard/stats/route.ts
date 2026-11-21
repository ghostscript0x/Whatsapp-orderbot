import { NextResponse } from "next/server";
import { requireTenant, route } from "@/lib/api";
import { getSystemStatus } from "@/lib/system-status";
import { getHomeData } from "@/components/home/data";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/stats: today's counts (tenant timezone), WhatsApp status, setup checklist,
 * and `system` ({ workerOnline, lastHeartbeatAt }) so the dashboard can warn when the bot worker is down.
 */
export const GET = route(async () => {
  const { db, tenantId } = await requireTenant();
  const [data, system] = await Promise.all([getHomeData(db, tenantId), getSystemStatus()]);
  return NextResponse.json({ ...data, system }, { headers: { "cache-control": "no-store" } });
});
