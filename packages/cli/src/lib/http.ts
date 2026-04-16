import type { VerifyAuthResponse } from "@steed/shared";

/**
 * Network error (connection failed, timeout, etc.)
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * API error (non-2xx response)
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Authentication error (401)
 */
export class AuthError extends ApiError {
  constructor(message: string) {
    super(401, "unauthorized", message);
    this.name = "AuthError";
  }
}

/**
 * HTTP client for Worker API communication
 */
export class HttpClient {
  private baseUrl: string;
  private apiKey: string | undefined;
  private timeout: number;

  constructor(baseUrl: string, apiKey?: string, timeout: number = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = apiKey;
    this.timeout = timeout;
  }

  /**
   * Make a GET request
   */
  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  /**
   * Make a POST request
   */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  /**
   * Make an HTTP request
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMessage =
          (errorBody as { error?: { message?: string } }).error?.message ??
          `HTTP ${response.status}`;
        const errorCode =
          (errorBody as { error?: { code?: string } }).error?.code ?? "error";

        if (response.status === 401) {
          throw new AuthError(errorMessage);
        }

        throw new ApiError(response.status, errorCode, errorMessage);
      }

      return (await response.json()) as T;
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof AuthError || err instanceof ApiError) {
        throw err;
      }

      if (err instanceof Error) {
        if (err.name === "AbortError") {
          throw new NetworkError(`Request timeout after ${this.timeout}ms`);
        }
        throw new NetworkError(err.message);
      }

      throw new NetworkError("Unknown network error");
    }
  }
}

/**
 * Verify Host API key with Worker
 */
export async function verifyApiKey(
  baseUrl: string,
  apiKey: string
): Promise<VerifyAuthResponse> {
  const client = new HttpClient(baseUrl, apiKey);
  return client.post<VerifyAuthResponse>("/api/v1/auth/verify", {});
}
