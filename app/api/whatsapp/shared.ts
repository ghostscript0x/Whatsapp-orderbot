import type { WhatsAppSession } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { OpenWaError } from "@/lib/openwa";

/** Shape returned to the dashboard by every /api/whatsapp/* route. */
export function sessionView(s: Pick<WhatsAppSession, "status" | "qr" | "phone" | "lastSeenAt"> | null) {
  if (!s) return { status: "DISCONNECTED" as const, qr: null, phone: null, lastSeenAt: null };
  return { status: s.status, qr: s.status === "QR_PENDING" ? s.qr : null, phone: s.phone, lastSeenAt: s.lastSeenAt };
}

/** Converts gateway failures into API errors with a message an owner can act on. */
export function gatewayError(err: unknown, action: string): never {
  if (err instanceof OpenWaError) {
    if (err.status === 0) throw new ApiError(502, "gateway_unreachable", `The WhatsApp gateway is unreachable, so we could not ${action}. Try again shortly.`);
    if (err.status === 401 || err.status === 403) throw new ApiError(502, "gateway_auth", `The WhatsApp gateway rejected our API key, so we could not ${action}.`);
    throw new ApiError(502, "gateway_error", `The WhatsApp gateway could not ${action}: ${err.message}`);
  }
  throw err;
}
