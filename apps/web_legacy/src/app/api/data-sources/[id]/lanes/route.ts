import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";
import { bffErrorResponse } from "@/lib/bff-errors";
import { setLanesSchema } from "@/lib/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = setLanesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = await workerApi.dataSources.setLanes(id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return bffErrorResponse(error);
  }
}
