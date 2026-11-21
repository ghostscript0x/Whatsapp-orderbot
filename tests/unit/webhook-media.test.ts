import { describe, expect, it } from "vitest";
import { lastInboundKey, parseWebhook, toInboundJob } from "@/lib/webhook";

const ctx = { tenantId: "t_1" };

function messageEvent(data: Record<string, unknown>) {
  return {
    event: "message.received",
    sessionId: "8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a",
    idempotencyKey: "msg_8f3c2b1a_3EB0ABC123_wh1",
    data: { id: "false_2348012345678@c.us_3EB0ABC123", chatId: "2348012345678@c.us", body: "", type: "text", fromMe: false, kind: "individual", ...data },
  };
}

const job = (data: Record<string, unknown>) => toInboundJob(parseWebhook(messageEvent(data)), ctx);

describe("toInboundJob media types", () => {
  it("accepts a voice note with no body (media bytes are never forwarded)", () => {
    expect(job({ type: "voice", body: "T2dnUw".repeat(200), media: { mimetype: "audio/ogg", data: "T2dnUw==" } })).toMatchObject({ ok: true, job: { type: "voice", body: "" } });
    expect(job({ type: "audio" })).toMatchObject({ ok: true, job: { type: "audio", body: "" } });
  });

  it("accepts a sticker", () => {
    expect(job({ type: "sticker", body: "UklGR".repeat(200) })).toMatchObject({ ok: true, job: { type: "sticker", body: "" } });
  });

  it("turns a shared location into readable text with a map pin", () => {
    const res = job({ type: "location", location: { latitude: 6.6018, longitude: 3.3515, description: "Ikeja City Mall", address: "Obafemi Awolowo Way" } });
    expect(res).toMatchObject({ ok: true, job: { type: "location", body: "Ikeja City Mall, Obafemi Awolowo Way (pin: https://maps.google.com/?q=6.601800,3.351500)" } });
  });

  it("tolerates a location without the location object or with invalid coordinates", () => {
    expect(job({ type: "location", body: "" })).toMatchObject({ ok: true, job: { type: "location", body: "" } });
    expect(job({ type: "location", body: "", location: { latitude: 999, longitude: 3 } })).toMatchObject({ ok: true, job: { type: "location", body: "" } });
  });

  it("keeps captions for video and documents", () => {
    expect(job({ type: "video", caption: "like this one" })).toMatchObject({ ok: true, job: { type: "video", body: "like this one" } });
    expect(job({ type: "document", body: "menu.pdf" })).toMatchObject({ ok: true, job: { type: "document", body: "menu.pdf" } });
  });

  it("caps very long text", () => {
    const res = job({ type: "text", body: "a ".repeat(5000) });
    expect(res.ok && res.job.body.length).toBe(4096);
  });

  it("namespaces the last-inbound key by tenant and chat", () => {
    expect(lastInboundKey("t_1", "234@c.us")).toBe("chat:lastin:t_1:234@c.us");
  });
});
