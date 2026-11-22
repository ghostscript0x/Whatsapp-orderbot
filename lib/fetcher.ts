/** Client-side JSON fetch that throws the API's `{ error: { message } }` as an Error. */
export async function apiFetch<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  if (!text) {
    if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
    return null as T;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // A proxy or Next.js error page is HTML. Never hand the raw markup (or the JSON.parse
    // SyntaxError) to the UI — show a short, actionable message instead.
    const status = `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
    if (/^\s*</.test(text)) {
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.replace(/\s+/g, " ").trim();
      throw new Error(`The server returned an error page${title ? `: ${title}` : ""} (${status}). Please try again.`);
    }
    throw new Error(`The server returned an unexpected response (${status}): ${text.slice(0, 120)}`);
  }

  const body = data as { error?: { message?: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (HTTP ${res.status})`);
  return data as T;
}
