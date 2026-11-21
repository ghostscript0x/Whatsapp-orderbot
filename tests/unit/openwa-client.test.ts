import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({ OPENWA_BASE_URL: "https://gw.test" }),
  requireEnv: () => "key",
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { whatsAppSession: { findUnique: vi.fn(async () => ({ openwaSessionId: "sess-1", status: "CONNECTED" })) } },
}));

import { openwa, OpenWaError, sendTenantImage } from "@/lib/openwa";

const CLOUDFLARE_502 = `<!DOCTYPE html><html><head><title>garage.example | 502: Bad gateway</title></head><body>…</body></html>`;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

describe("openwa client", () => {
  it("retries a send after a proxy 502 with the same idempotency key", async () => {
    fetchMock.mockResolvedValueOnce(new Response(CLOUDFLARE_502, { status: 502, statusText: "Bad Gateway" }));
    fetchMock.mockResolvedValueOnce(json(201, { messageId: "m1" }));

    const res = await settle(openwa.sendText("sess-1", "234@c.us", "hi"));

    expect(res).toEqual({ messageId: "m1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const key1 = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const key2 = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(key1["Idempotency-Key"]).toBeTruthy();
    expect(key1["Idempotency-Key"]).toBe(key2["Idempotency-Key"]);
  });

  it("gives up after the retry budget with a short message instead of HTML", async () => {
    fetchMock.mockImplementation(async () => new Response(CLOUDFLARE_502, { status: 502, statusText: "Bad Gateway" }));

    const err = await settle(openwa.sendText("sess-1", "234@c.us", "hi").catch((e) => e));

    expect(err).toBeInstanceOf(OpenWaError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(err.message).toContain("502: Bad gateway (gateway unreachable through its proxy)");
    expect(err.message).not.toContain("<!DOCTYPE");
  });

  it("does not retry a client error", async () => {
    fetchMock.mockResolvedValue(json(400, { message: "Media fetch failed" }));
    const err = await settle(openwa.sendText("sess-1", "234@c.us", "hi").catch((e) => e));
    expect(err.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the outcome of an earlier attempt is unknown", async () => {
    fetchMock.mockResolvedValue(json(409, { message: "maybe sent", code: "IDEMPOTENCY_OUTCOME_UNKNOWN" }));
    const err = await settle(openwa.sendText("sess-1", "234@c.us", "hi").catch((e) => e));
    expect(err.code).toBe("IDEMPOTENCY_OUTCOME_UNKNOWN");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("each logical send gets its own idempotency key", async () => {
    fetchMock.mockImplementation(async () => json(201, { messageId: "m" }));
    await settle(openwa.sendText("sess-1", "234@c.us", "one"));
    await settle(openwa.sendText("sess-1", "234@c.us", "two"));
    const k = (i: number) => ((fetchMock.mock.calls[i][1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    expect(k(0)).not.toBe(k(1));
  });
});

describe("sendTenantImage", () => {
  it("downloads the photo and sends it as base64", async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).startsWith("https://cdn.test/")) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      return json(201, { messageId: "img1" });
    });

    const res = await settle(sendTenantImage("t1", "234@c.us", "https://cdn.test/a.jpg", "*Jollof* — ₦3,500"));

    expect(res).toEqual({ messageId: "img1" });
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toEqual({ chatId: "234@c.us", base64: "AQID", mimetype: "image/jpeg", caption: "*Jollof* — ₦3,500" });
  });

  it("falls back to the URL when the app can't download the photo", async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).startsWith("https://cdn.test/")) return new Response("nope", { status: 403 });
      return json(201, { messageId: "img2" });
    });

    await settle(sendTenantImage("t1", "234@c.us", "https://cdn.test/a.jpg"));

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toEqual({ chatId: "234@c.us", url: "https://cdn.test/a.jpg" });
  });
});
