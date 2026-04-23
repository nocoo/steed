import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const host_id = searchParams.get("host_id");
  const lane_id = searchParams.get("lane_id");
  const status = searchParams.get("status");
  const limitStr = searchParams.get("limit");
  const cursor = searchParams.get("cursor");

  try {
    const result = await workerApi.agents.list({
      ...(host_id && { host_id }),
      ...(lane_id && { lane_id }),
      ...(status && { status }),
      ...(limitStr && { limit: Number(limitStr) }),
      ...(cursor && { cursor }),
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
