import { useEffect, useState } from "react";
import { userProfileSchema, type UserProfile } from "@steed/api/shared";

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/me", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    })
      .then((response) => response.ok ? response.json() : null)
      .then((body: unknown) => {
        const result = userProfileSchema.safeParse(body);
        if (!controller.signal.aborted && result.success) setProfile(result.data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return profile;
}
