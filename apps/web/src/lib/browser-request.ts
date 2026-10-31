export async function browserRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Steed-Request", "1");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (response.status === 204) return undefined as T;
  const body = await response.json() as { error?: { message: string; issues?: { path: (string | number)[]; message: string }[] } };
  if (!response.ok) {
    const error = body.error;
    throw new Error(error?.issues ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n")
      : error?.message ?? `Request failed (${response.status}).`);
  }
  return body as T;
}
