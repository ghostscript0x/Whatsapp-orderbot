import { LlmError } from "./types";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const MAX_RETRY_DELAY_MS = 5_000;

function statusToKind(status: number): LlmError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408) return "timeout";
  if (status >= 500) return "server";
  return "bad_request";
}

function retryDelayMs(res: Response | null): number {
  const header = res?.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  return 750 + Math.floor(Math.random() * 500);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extracts a short provider error message without echoing request content. */
async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { error?: { message?: string } | string };
    const msg = typeof data.error === "string" ? data.error : data.error?.message;
    if (msg) return msg.slice(0, 300);
  } catch {
    // Not JSON: fall through to the raw (truncated) body.
  }
  return text.slice(0, 300) || res.statusText;
}

/**
 * POSTs JSON with a timeout and ONE retry on 429 / 5xx / timeout / network errors.
 * Throws LlmError on failure.
 */
export async function postJson<T>(opts: {
  provider: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<T> {
  const doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  let lastError: LlmError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response | null = null;
    try {
      res = await doFetch(opts.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...opts.headers },
        body: JSON.stringify(opts.body),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      lastError = new LlmError(
        isTimeout ? "timeout" : "network",
        isTimeout ? `Request timed out after ${opts.timeoutMs} ms` : `Network error: ${(err as Error).message}`,
        opts.provider,
      );
    }

    if (res) {
      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new LlmError("invalid_response", "Provider returned invalid JSON", opts.provider, res.status);
        }
      }
      lastError = new LlmError(statusToKind(res.status), `HTTP ${res.status}: ${await errorDetail(res)}`, opts.provider, res.status);
    }

    if (!lastError!.retryable || attempt === 1) break;
    await sleep(retryDelayMs(res));
  }
  throw lastError!;
}
