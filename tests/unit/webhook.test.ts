import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseWebhook, phoneForChat, toInboundJob, verifySignature } from "@/lib/webhook";
import { planSessionUpdate } from "@/worker/session-events";

const SECRET = "test-webhook-secret-0123456789";
const sign = (body: string, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
const headers = (sig?: string) => new Headers(sig ? { "X-OpenWA-Signature": sig } : {});

function messageEvent(data: Record<string, unknown> = {}) {
  return {
    event: "message.received",
    timestamp: "2026-02-02T10:00:00.000Z",
    sessionId: "8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a",
    idempotencyKey: "msg_8f3c2b1a_3EB0ABC123_wh1",
    deliveryId: "dlv_1",
    data: {
      id: "false_2348012345678@c.us_3EB0ABC123",
      from: "2348012345678@c.us",
      to: "2348000000000@c.us",
      chatId: "2348012345678@c.us",
      body: "Hi, what do you have today?",
      type: "text",
      timestamp: 1770026400,
      isGroup: false,
      kind: "individual",
      fromMe: false,
      contact: { pushName: "Ada" },
      ...data,
    },
  };
}

describe("verifySignature", () => {
  const body = JSON.stringify(messageEvent());

  it("accepts a valid signature over the raw body", () => {
    expect(verifySignature(body, headers(sign(body)), SECRET)).toBe(true);
    expect(verifySignature(Buffer.from(body), headers(sign(body)), SECRET)).toBe(true);
  });

  it("rejects a missing header, wrong secret, missing prefix and empty secret", () => {
    expect(verifySignature(body, headers(), SECRET)).toBe(false);
    expect(verifySignature(body, headers(sign(body, "another-secret-xxxxxxxx")), SECRET)).toBe(false);
    expect(verifySignature(body, headers(sign(body).replace("sha256=", "")), SECRET)).toBe(false);
    expect(verifySignature(body, headers(sign(body)), "")).toBe(false);
    expect(verifySignature(body, headers("sha256=abc"), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const sig = sign(body);
    const tampered = body.replace("Hi, what", "Hi, WHAT");
    expect(verifySignature(tampered, headers(sig), SECRET)).toBe(false);
    // Re-serialising changes bytes: signature must be checked on the raw body only.
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifySignature(reserialised, headers(sig), SECRET)).toBe(false);
  });
});

describe("parseWebhook", () => {
  it("parses session events and keeps unknown events as 'other'", () => {
    const base = { sessionId: "s1", idempotencyKey: "k1", timestamp: "t" };
    expect(parseWebhook({ ...base, event: "session.qr", data: { sessionId: "s1", qr: "data:image/png;base64,AAA" } })).toMatchObject({
      event: "session.qr",
      data: { qr: "data:image/png;base64,AAA" },
    });
    expect(parseWebhook({ ...base, event: "message.ack", data: { status: "read" } })).toMatchObject({ event: "other", originalEvent: "message.ack" });
  });

  it("throws on a payload without idempotencyKey", () => {
    expect(() => parseWebhook({ event: "session.status", sessionId: "s1", data: { status: "ready" } })).toThrow();
  });
});

describe("toInboundJob", () => {
  const ctx = { tenantId: "tenant_1" };

  it("maps a 1:1 text message to an InboundMessageJob", () => {
    const decision = toInboundJob(parseWebhook(messageEvent()), ctx);
    expect(decision).toEqual({
      ok: true,
      job: {
        tenantId: "tenant_1",
        sessionId: "8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a",
        idempotencyKey: "msg_8f3c2b1a_3EB0ABC123_wh1",
        chatId: "2348012345678@c.us",
        phone: "2348012345678",
        pushName: "Ada",
        messageId: "false_2348012345678@c.us_3EB0ABC123",
        type: "text",
        body: "Hi, what do you have today?",
        timestamp: 1770026400 * 1000,
      },
    });
  });

  it("maps an image message using its caption and never a base64 body", () => {
    const withCaption = toInboundJob(parseWebhook(messageEvent({ type: "image", body: "", caption: "Do you have this?" })), ctx);
    expect(withCaption).toMatchObject({ ok: true, job: { type: "image", body: "Do you have this?" } });
    const blob = "/9j/" + "A".repeat(2000);
    const thumbOnly = toInboundJob(parseWebhook(messageEvent({ type: "image", body: blob })), ctx);
    expect(thumbOnly).toMatchObject({ ok: true, job: { type: "image", body: "" } });
  });

  it.each([
    ["group chat", { chatId: "120363000000000001@g.us", isGroup: true, kind: "group" }, "not_direct_chat"],
    ["group chat by id only", { chatId: "120363000000000001@g.us", isGroup: undefined, kind: undefined }, "not_direct_chat"],
    ["status broadcast", { chatId: "status@broadcast", kind: "status", isStatusBroadcast: true }, "not_direct_chat"],
    ["broadcast list", { chatId: "1234@broadcast", kind: "broadcast" }, "not_direct_chat"],
    ["channel", { chatId: "1203@newsletter", kind: "channel" }, "not_direct_chat"],
    ["own message", { fromMe: true }, "from_me"],
    ["contact card", { type: "contact" }, "unsupported_type:contact"],
    ["poll", { type: "poll" }, "unsupported_type:poll"],
    ["deleted message", { type: "revoked" }, "unsupported_type:revoked"],
    ["empty text", { body: "   " }, "empty_text"],
  ])("ignores %s", (_label, data, reason) => {
    expect(toInboundJob(parseWebhook(messageEvent(data)), ctx)).toEqual({ ok: false, reason });
  });

  it("ignores non-message events", () => {
    const evt = parseWebhook({ event: "session.status", sessionId: "s", idempotencyKey: "k", data: { status: "ready" } });
    expect(toInboundJob(evt, ctx)).toEqual({ ok: false, reason: "not_a_message" });
  });
});

describe("phoneForChat", () => {
  it("reads the number from phone-based ids and senderPhone for @lid", () => {
    expect(phoneForChat("2348012345678@c.us")).toBe("2348012345678");
    expect(phoneForChat("2348012345678:12@s.whatsapp.net")).toBe("2348012345678");
    expect(phoneForChat("123456789012345@lid", "2348012345678")).toBe("2348012345678");
    expect(phoneForChat("123456789012345@lid")).toBe("");
  });
});

describe("planSessionUpdate", () => {
  it("stores the QR while pending", () => {
    expect(planSessionUpdate({ event: "session.qr", payload: { qr: "data:image/png;base64,AAA" } }, "STARTING")).toMatchObject({
      data: { status: "QR_PENDING", qr: "data:image/png;base64,AAA" },
      notifyOwner: false,
    });
  });

  it("marks connected with phone on authentication", () => {
    expect(planSessionUpdate({ event: "session.authenticated", payload: { phone: "2348000000000" } }, "QR_PENDING")).toMatchObject({
      data: { status: "CONNECTED", qr: null, phone: "2348000000000" },
      notifyOwner: false,
    });
  });

  it("notifies the owner once when a connected session drops", () => {
    expect(planSessionUpdate({ event: "session.disconnected", payload: { reason: "LOGOUT" } }, "CONNECTED")).toMatchObject({
      data: { status: "NEEDS_RESCAN" },
      notifyOwner: true,
    });
    expect(planSessionUpdate({ event: "session.disconnected", payload: { reason: "connection lost" } }, "DISCONNECTED")).toMatchObject({
      data: { status: "DISCONNECTED" },
      notifyOwner: false,
    });
  });

  it("maps session.status and ignores unknown statuses", () => {
    expect(planSessionUpdate({ event: "session.status", payload: { status: "ready" } }, "QR_PENDING")).toMatchObject({ data: { status: "CONNECTED" } });
    expect(planSessionUpdate({ event: "session.status", payload: { status: "disconnected" } }, "CONNECTED")).toMatchObject({ notifyOwner: true });
    expect(planSessionUpdate({ event: "session.status", payload: { status: "weird" } }, "CONNECTED")).toBeNull();
  });
});
