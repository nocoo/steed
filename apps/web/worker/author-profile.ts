import { avatarSchema, type UserProfile } from "@steed/api/shared";

export const AUTHOR_PROFILE_ORIGIN = "https://lizheng.blog";
/** Cache lifetimes in seconds: a found profile, a known-empty profile, an upstream failure. */
export const AUTHOR_PROFILE_TTL = { found: 86_400, empty: 3_600, failure: 300 } as const;
const MAX_BODY_BYTES = 24_576;

/** Calls `fetch` through a wrapper; a bare `fetch` reference throws Illegal invocation in Workers. */
export type ProfileFetcher = { fetch(input: string, init: RequestInit): Promise<Response> };
export type ProfileCache = Pick<Cache, "match" | "put">;
export type ProfileOptions = {
  /** Host of the incoming request; the synthetic cache key lives on it. */
  host: string;
  fetcher?: ProfileFetcher;
  cache?: ProfileCache;
  /** Upstream origin override, only for the local E2E stub. */
  origin?: string;
};
type Author = { name: string | null; avatar: string | null };

const defaultFetcher: ProfileFetcher = { fetch: (input, init) => fetch(input, init) };
// Workers expose `caches.default`; the DOM CacheStorage type used for type-checking lacks it.
const defaultCache = (): ProfileCache | undefined =>
  typeof caches === "undefined" ? undefined : (caches as unknown as { default: ProfileCache }).default;

export async function emailHash(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function author(data: unknown): Author {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { name: null, avatar: null };
  const value = data as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 200) || null : null;
  const avatar = avatarSchema.safeParse(value.avatar);
  return { name, avatar: avatar.success ? avatar.data : null };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("empty body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error("body too large");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel();
  }
  return JSON.parse(text);
}

/** Fetches the upstream author, returning it with the cache lifetime its outcome earns. */
async function fetchAuthor(hash: string, fetcher: ProfileFetcher, origin: string): Promise<[Author, number]> {
  try {
    const response = await fetcher.fetch(`${origin}/api/authors/profile?hash=${hash}`, {
      headers: { Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) {
      console.warn("author profile unavailable", { status: response.status });
      return [{ name: null, avatar: null }, AUTHOR_PROFILE_TTL.failure];
    }
    const found = author(await readJson(response));
    return [found, found.name || found.avatar ? AUTHOR_PROFILE_TTL.found : AUTHOR_PROFILE_TTL.empty];
  } catch (error) {
    console.warn("author profile unavailable", { kind: error instanceof Error ? error.name : "unknown" });
    return [{ name: null, avatar: null }, AUTHOR_PROFILE_TTL.failure];
  }
}

export async function getUserProfile(verifiedEmail: string, options: ProfileOptions): Promise<UserProfile> {
  const email = verifiedEmail.trim().toLowerCase();
  const fallback: UserProfile = { email: email || null, name: email.split("@")[0] || "User", avatar: null };
  if (!email) return fallback;

  const hash = await emailHash(email);
  const cache = options.cache ?? defaultCache();
  const key = `https://${options.host}/_author-profiles/v2/${hash}`;
  let found: Author | undefined;
  const cached = await cache?.match(key).catch(() => undefined);
  if (cached) found = await cached.json().then(author, () => undefined);
  if (!found) {
    const [fresh, maxAge] = await fetchAuthor(hash, options.fetcher ?? defaultFetcher, options.origin ?? AUTHOR_PROFILE_ORIGIN);
    found = fresh;
    await cache?.put(key, Response.json(fresh, { headers: { "Cache-Control": `public, max-age=${maxAge}` } })).catch(() => undefined);
  }
  return { ...fallback, name: found.name ?? fallback.name, avatar: found.avatar };
}
