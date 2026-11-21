import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, errors, parseJson, requireTenant, route } from "@/lib/api";
import { openwa, OpenWaError } from "@/lib/openwa";
import { gatewayError } from "../shared";

export const runtime = "nodejs";

const Body = z.object({
  // Digits with country code; "+", spaces and dashes are stripped. OpenWA accepts 6-15 digits.
  phone: z
    .string()
    .transform((s) => s.replace(/[\s+\-()]/g, ""))
    .pipe(z.string().regex(/^\d{6,15}$/, "Enter the number with country code, digits only (e.g. 2348012345678)")),
});

/** Owner: link by phone number instead of QR. Requires a started session waiting for a link. */
export const POST = route(async (req: Request) => {
  const { tenantId, db } = await requireTenant({ role: "OWNER" });
  const { phone } = await parseJson(req, Body);

  const session = await db.whatsAppSession.findUnique({ where: { tenantId } });
  if (!session) throw errors.badRequest("Click Connect first, then request a pairing code.");
  if (session.status === "CONNECTED") throw errors.conflict("WhatsApp is already connected.");

  try {
    const code = await openwa.requestPairingCode(session.openwaSessionId, phone);
    return NextResponse.json({ code });
  } catch (err) {
    if (err instanceof OpenWaError && err.status === 409) {
      throw new ApiError(409, "not_ready", "WhatsApp is still starting up. Wait until the QR code appears, then try again.");
    }
    if (err instanceof OpenWaError && err.status === 400) {
      throw errors.badRequest("The gateway rejected this request. Check the number, or click Connect again to restart the session.");
    }
    gatewayError(err, "create a pairing code");
  }
});
