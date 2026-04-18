import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";
import { bffErrorResponse } from "@/lib/bff-errors";

interface RouteParams {
  params: Promise<{ agent_id: string; data_source_id: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { agent_id, data_source_id } = await params;

  try {
    await workerApi.bindings.delete(agent_id, data_source_id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return bffErrorResponse(error);
  }
}
