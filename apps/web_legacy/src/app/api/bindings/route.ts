import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";
import { bffErrorResponse } from "@/lib/bff-errors";
import { createBindingSchema } from "@/lib/schemas";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const agent_id = url.searchParams.get("agent_id") ?? undefined;
  const data_source_id =
    url.searchParams.get("data_source_id") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }

  try {
    const result = await workerApi.bindings.list({
      ...(agent_id !== undefined ? { agent_id } : {}),
      ...(data_source_id !== undefined ? { data_source_id } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
    return NextResponse.json(result);
  } catch (error) {
    return bffErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createBindingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const binding = await workerApi.bindings.create(parsed.data);
    return NextResponse.json(binding, { status: 201 });
  } catch (error) {
    return bffErrorResponse(error);
  }
}
