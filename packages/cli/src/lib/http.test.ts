import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HttpClient,
  NetworkError,
  ApiError,
  AuthError,
  verifyApiKey,
} from "./http.js";

// Store original fetch
const originalFetch = globalThis.fetch;

describe("HttpClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("get", () => {
    it("makes GET request and returns data", async () => {
      const mockResponse = { data: "test" };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const client = new HttpClient("https://api.example.com");
      const result = await client.get<{ data: string }>("/test");

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });
  });

  describe("post", () => {
    it("makes POST request with body", async () => {
      const mockResponse = { success: true };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const client = new HttpClient("https://api.example.com");
      const result = await client.post<{ success: boolean }>("/submit", {
        foo: "bar",
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/submit",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ foo: "bar" }),
        })
      );
    });
  });

  describe("auth header", () => {
    it("sets Authorization header when apiKey provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      const client = new HttpClient(
        "https://api.example.com",
        "sk_host_test123"
      );
      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sk_host_test123",
          }),
        })
      );
    });

    it("does not set Authorization header when no apiKey", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      const client = new HttpClient("https://api.example.com");
      await client.get("/test");

      const callArgs = mockFetch.mock.calls[0];
      const headers = (callArgs?.[1]?.headers ?? {}) as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("throws AuthError on 401 response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({
            error: { code: "unauthorized", message: "Invalid token" },
          }),
      } as Response);

      const client = new HttpClient("https://api.example.com");
      await expect(client.get("/test")).rejects.toThrow(AuthError);
    });

    it("throws ApiError on 500 response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            error: { code: "internal_error", message: "Server error" },
          }),
      } as Response);

      const client = new HttpClient("https://api.example.com");

      try {
        await client.get("/test");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(500);
        expect((err as ApiError).code).toBe("internal_error");
      }
    });

    it("throws NetworkError on fetch failure", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const client = new HttpClient("https://api.example.com");
      await expect(client.get("/test")).rejects.toThrow(NetworkError);
    });

    it("throws NetworkError on timeout", async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((_, reject) => {
            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            setTimeout(() => reject(abortError), 10);
          })
      );

      const client = new HttpClient("https://api.example.com", undefined, 5);
      await expect(client.get("/test")).rejects.toThrow(NetworkError);
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("Not JSON")),
      } as Response);

      const client = new HttpClient("https://api.example.com");

      try {
        await client.get("/test");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).message).toContain("HTTP 503");
      }
    });

    it("handles non-Error rejection", async () => {
      mockFetch.mockRejectedValue("string error");

      const client = new HttpClient("https://api.example.com");
      await expect(client.get("/test")).rejects.toThrow(NetworkError);
    });
  });

  describe("URL handling", () => {
    it("removes trailing slash from baseUrl", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      const client = new HttpClient("https://api.example.com/");
      await client.get("/test");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/test",
        expect.anything()
      );
    });
  });
});

describe("verifyApiKey", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns host info on success", async () => {
    const mockResponse = {
      valid: true,
      host_id: "host_abc123",
      host_name: "Test Host",
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const result = await verifyApiKey(
      "https://api.example.com",
      "sk_host_test"
    );

    expect(result.valid).toBe(true);
    expect(result.host_id).toBe("host_abc123");
    expect(result.host_name).toBe("Test Host");
  });

  it("throws AuthError on 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({
          error: { code: "unauthorized", message: "Invalid API key" },
        }),
    } as Response);

    await expect(
      verifyApiKey("https://api.example.com", "sk_host_invalid")
    ).rejects.toThrow(AuthError);
  });
});
