import { NextResponse } from "next/server";
import { errors, requireTenant, route } from "@/lib/api";
import { decrypt, encrypt, randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { acquireLock } from "@/lib/redis";
import { openwa, sessionNameFor } from "@/lib/openwa";
import { gatewayError, sessionView } from "../shared";

export const runtime = "nodejs";

/** Owner: create (or reuse) the tenant's OpenWA session, register our signed webhook, start it. */
export const POST = route(async () => {
  const { tenantId, db } = await requireTenant({ role: "OWNER" });

  const appUrl = env().APP_URL.replace(/\/+$/, "");
  if (!appUrl.startsWith("https://")) {
    throw errors.badRequest(
      `APP_URL is ${appUrl}. The WhatsApp gateway can only deliver messages to a public https address. ` +
        "In development, run a tunnel (for example cloudflared or ngrok) to port 3000 and set APP_URL to its https URL.",
    );
  }

  const release = await acquireLock(`wa-connect:${tenantId}`, 60_000);
  if (!release) throw errors.conflict("A connection attempt is already in progress. Please wait a moment.");
  try {
    const existing = await db.whatsAppSession.findUnique({ where: { tenantId } });
    // Reuse the stored secret so a reconnect doesn't invalidate in-flight retries.
    const secret = existing ? decrypt(existing.webhookSecretEnc) : randomToken(32);

    let sessionId: string;
    try {
      ({ sessionId } = await openwa.createSession(sessionNameFor(tenantId), { url: `${appUrl}/api/webhooks/openwa`, secret }));
    } catch (err) {
      gatewayError(err, "start the WhatsApp session");
    }

    const data = { openwaSessionId: sessionId, status: "STARTING" as const, qr: null };
    const saved = existing
      ? await db.whatsAppSession.update({ where: { tenantId }, data })
      : await db.whatsAppSession.create({ data: { ...data, tenantId, webhookSecretEnc: encrypt(secret) } });
    return NextResponse.json(sessionView(saved));
  } finally {
    await release();
  }
});
