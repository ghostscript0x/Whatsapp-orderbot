import { NextResponse } from "next/server";
import { errors, requireTenant, route } from "@/lib/api";
import { openwa, OpenWaError } from "@/lib/openwa";
import { gatewayError, sessionView } from "../shared";

export const runtime = "nodejs";

/** Owner: unlink the device on WhatsApp and mark the session DISCONNECTED. */
export const POST = route(async () => {
  const { tenantId, db } = await requireTenant({ role: "OWNER" });
  const session = await db.whatsAppSession.findUnique({ where: { tenantId } });
  if (!session) throw errors.notFound("WhatsApp session");

  try {
    await openwa.logout(session.openwaSessionId);
  } catch (err) {
    // Already deleted on the gateway: nothing left to unlink.
    if (!(err instanceof OpenWaError && err.status === 404)) gatewayError(err, "disconnect WhatsApp");
  }

  const updated = await db.whatsAppSession.update({
    where: { tenantId },
    data: { status: "DISCONNECTED", qr: null, phone: null },
  });
  return NextResponse.json(sessionView(updated));
});
