import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function readText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new HttpError(408, "body_timeout", "The request body timed out."));
      void reader.cancel();
    }, 5000);
  });
  try {
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new HttpError(413, "body_too_large", `Maximum body size is ${maxBytes} bytes.`);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    clearTimeout(timer);
    await reader.cancel();
  }
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new HttpError(415, "invalid_content_type", "Send application/json.");
  }
  if (!request.body) throw new HttpError(400, "invalid_json", "A JSON body is required.");
  const text = await readText(request, maxBytes);
  try { return JSON.parse(text); }
  catch { throw new HttpError(400, "invalid_json", "The JSON body is invalid."); }
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "origin_denied", "A same-origin request is required.");
  }
  if (!["GET", "HEAD"].includes(request.method) &&
      (!origin || request.headers.get("X-Steed-Request") !== "1")) {
    throw new HttpError(403, "origin_denied", "A same-origin management request is required.");
  }
}

export function errorResponse(error: unknown, requestId: string): Response {
    if (error instanceof ZodError) {
      return Response.json({ error: { code: "invalid_document", message: "Validation failed.", requestId,
        issues: error.issues.map(({ path, message }) => ({ path, message })) } }, { status: 422 });
    } else {
      const failure = error instanceof HttpError ? error
        : new HttpError(503, "unavailable", "The service is unavailable. Check the current state before retrying a change.");
      return Response.json({ error: { code: failure.code, message: failure.message, requestId } }, { status: failure.status });
    }
}

export async function apiResponse(action: (requestId: string) => Promise<Response>): Promise<Response> {
  const requestId = crypto.randomUUID();
  let response: Response;
  try { response = await action(requestId); }
  catch (error) { response = errorResponse(error, requestId); }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Request-Id", requestId);
  return response;
}
