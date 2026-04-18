import { NextResponse } from "next/server";
import { WorkerApiError } from "@/lib/worker-api";

/**
 * Translate any error thrown out of a BFF route into a NextResponse.
 *
 * - WorkerApiError: surface the Worker's status code (404/409/...),
 *   so the browser can react meaningfully instead of seeing a
 *   blanket 500.
 * - Other Error: 500 with the message.
 * - Anything else: 500 with "Unknown error".
 */
export function bffErrorResponse(error: unknown): NextResponse {
  if (error instanceof WorkerApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ error: "Unknown error" }, { status: 500 });
}
