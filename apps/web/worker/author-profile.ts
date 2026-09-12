import { z } from "zod";
import { userProfileSchema, type UserProfile } from "@steed/api/shared";

const authorSchema = z.object({
  name: userProfileSchema.shape.name.nullable().catch(null),
  avatar: userProfileSchema.shape.avatar.catch(null),
});

export async function getUserProfile(
  verifiedEmail: string,
  fetcher: typeof fetch = fetch
): Promise<UserProfile> {
  const email = verifiedEmail.trim().toLowerCase();
  const fallback: UserProfile = {
    email: email || null,
    name: email.split("@")[0] || "User",
    avatar: null,
  };
  if (!email) return fallback;

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const response = await fetcher(`https://lizheng.blog/api/authors/profile?hash=${hash}`, {
      signal: AbortSignal.timeout(2500),
      redirect: "error",
    });
    if (!response.ok || !response.body) return fallback;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) return fallback;
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel();
    }
    const profile = authorSchema.safeParse(JSON.parse(text));
    if (!profile.success) return fallback;
    return { ...fallback, name: profile.data.name ?? fallback.name, avatar: profile.data.avatar };
  } catch {
    return fallback;
  }
}
