/** Cloudflare's trace endpoint; fetched from inside the Worker it is answered by the colo the Worker runs in. */
export const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
export const TRACE_TIMEOUT_MS = 500;
/** After a failed lookup the header is omitted, and the lookup is retried no sooner than this. */
export const TRACE_RETRY_MS = 60_000;
const MAX_TRACE_BYTES = 4096;

/** Calls `fetch` through a wrapper; a bare `fetch` reference throws Illegal invocation in Workers. */
export type TraceFetcher = { fetch(input: string, init: RequestInit): Promise<Response> };
const defaultFetcher: TraceFetcher = { fetch: (input, init) => fetch(input, init) };

/** Reads the `colo=` line of a trace response; any failure, redirect, oversize or malformed value is null. */
export async function traceColo(url: string, fetcher: TraceFetcher = defaultFetcher): Promise<string | null> {
  try {
    const response = await fetcher.fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TRACE_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const text = await response.text();
    if (text.length > MAX_TRACE_BYTES) return null;
    return /^colo=([A-Z]{3})$/m.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * A per-isolate cache of the colo this isolate runs in. Only the resolved value is shared, never a
 * pending promise, because Workers must not await I/O started by a different request. A found colo
 * is kept for the life of the isolate; a failure is cached for TRACE_RETRY_MS so a broken lookup
 * costs at most one timeout per isolate per minute.
 */
export function coloLookup(fetcher: TraceFetcher = defaultFetcher, now: () => number = Date.now) {
  let colo: string | null | undefined;
  let retryAt = 0;
  return async (url: string): Promise<string | null> => {
    if (typeof colo === "string" || (colo === null && now() < retryAt)) return colo;
    colo = await traceColo(url, fetcher);
    if (colo === null) retryAt = now() + TRACE_RETRY_MS;
    return colo;
  };
}
