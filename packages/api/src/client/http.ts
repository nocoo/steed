import { ApiHttpError } from "../server/errors";

export interface HttpClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  headers?: () => HeadersInit;
}

export interface HttpClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  const fetchFn = opts.fetch ?? globalThis.fetch;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${opts.baseUrl}${path}`;
    const headers = new Headers(opts.headers?.());
    headers.set("Content-Type", "application/json");

    const res = await fetchFn(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({
        error: { message: res.statusText },
      }));
      throw new ApiHttpError(
        res.status,
        errorBody,
        (errorBody as { error?: { message?: string } }).error?.message ??
          `HTTP ${res.status}`
      );
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return res.json() as Promise<T>;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
    delete: async (path: string): Promise<void> => {
      await request<undefined>("DELETE", path);
    },
  };
}
