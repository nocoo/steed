import { afterEach, describe, expect, it, vi } from "vitest";
import { apiResponse, readJson, readText } from "./http";

const request = (body: ReadableStream<Uint8Array>, method = "PUT") => {
  const init = { method, body, duplex: "half", headers: { "Content-Type": "application/json" } };
  return new Request("https://steed.example/api/diagrams/example", init);
};
afterEach(() => vi.useRealTimers());

describe("bounded HTTP bodies", () => {
  it("accepts an empty streamed DELETE just like a request with no body", async () => {
    const streamed = request(new ReadableStream({ start(controller) { controller.close(); } }), "DELETE");
    expect(streamed.body).not.toBeNull();
    expect(await readText(streamed, 1024)).toBe("");
    expect(await readText(new Request("https://steed.example", { method: "DELETE" }), 1024)).toBe("");
  });

  it("decodes split UTF-8 sequences and applies limits to bytes, not character counts", async () => {
    const value = { title: "架构 🐎" }; const bytes = new TextEncoder().encode(JSON.stringify(value));
    const stream = () => new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    expect(await readJson(request(stream()), bytes.length)).toEqual(value);
    await expect(readJson(request(stream()), bytes.length - 1)).rejects.toMatchObject({ status: 413, code: "body_too_large" });
  });

  it("cancels stalled bodies and returns a structured timeout with no partial write", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const response = apiResponse(async () => Response.json(await readJson(request(new ReadableStream({ cancel })), 1024)));
    await vi.advanceTimersByTimeAsync(5000);
    const result = await response; expect(result.status).toBe(408);
    expect(await result.json()).toHaveProperty("error.code", "body_timeout");
    expect(cancel).toHaveBeenCalledOnce(); expect(result.headers.get("Cache-Control")).toBe("no-store");
  });
});
