import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/fetcher";

const HTML_502 = `<!DOCTYPE html><html><head><title>orders.example | 502: Bad gateway</title></head><body>…</body></html>`;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns parsed JSON on success", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await expect(apiFetch("/api/health")).resolves.toEqual({ ok: true });
  });

  it("throws the API error message for JSON errors", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: "bad_request", message: "Enter a valid phone number" } }));
    await expect(apiFetch("/api/tenants")).rejects.toThrow("Enter a valid phone number");
  });

  it("reports an HTML proxy error as a readable message, not a JSON parse error", async () => {
    fetchMock.mockResolvedValueOnce(new Response(HTML_502, { status: 502, statusText: "Bad Gateway" }));
    const err = await apiFetch("/api/tenants").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("502: Bad gateway");
    expect(err.message).toContain("HTTP 502");
    expect(err.message).not.toContain("<!DOCTYPE");
    expect(err.message).not.toContain("Unexpected token");
  });

  it("reports an unexpected HTML success response too", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<!DOCTYPE html><title>Log in</title>", { status: 200 }));
    const err = await apiFetch("/api/health").catch((e) => e);
    expect(err.message).toContain("error page: Log in");
  });

  it("handles an empty successful body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(apiFetch("/api/tenants/switch")).resolves.toBeNull();
  });
});
