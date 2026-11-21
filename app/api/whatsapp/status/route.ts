import { NextResponse } from "next/server";
import { requireTenant, route } from "@/lib/api";
import { logger } from "@/lib/logger";
import { openwa, OpenWaError } from "@/lib/openwa";
import { sessionView } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner + staff: live session state from OpenWA, persisted to WhatsAppSession.
 * If the gateway is unreachable we return the last stored state with `stale: true`
 * rather than failing the dashboard.
 */
export const GET = route(async () => {
  const { tenantId, db } = await requireTenant();
  const session = await db.whatsAppSession.findUnique({ where: { tenantId } });
  if (!session) return NextResponse.json({ ...sessionView(null), stale: false });

  try {
    const live = await openwa.getSessionState(session.openwaSessionId);
    const updated = await db.whatsAppSession.update({
      where: { tenantId },
      data: { status: live.status, qr: live.qr, phone: live.phone ?? session.phone },
    });
    return NextResponse.json({ ...sessionView(updated), stale: false });
  } catch (err) {
    if (err instanceof OpenWaError && err.status === 404) {
      // Session deleted on the gateway: the owner must connect again.
      const updated = await db.whatsAppSession.update({ where: { tenantId }, data: { status: "DISCONNECTED", qr: null } });
      return NextResponse.json({ ...sessionView(updated), stale: false });
    }
    if (!(err instanceof OpenWaError)) throw err;
    logger.warn({ tenantId, err: err.message }, "whatsapp status: gateway unavailable, returning stored state");
    return NextResponse.json({ ...sessionView(session), stale: true });
  }
});
