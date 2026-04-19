import { NextResponse } from "next/server";
import type {
  AgentListItem,
  Binding,
  DataSourceWithLanes,
  HostWithStatus,
  Lane,
} from "@steed/shared";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";
import { bffErrorResponse } from "@/lib/bff-errors";

export interface MapPayload {
  hosts: HostWithStatus[];
  agents: AgentListItem[];
  data_sources: DataSourceWithLanes[];
  bindings: Binding[];
  lanes: Lane[];
}

const MAP_LIMIT = 200;

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [hosts, agentsResp, dsResp, bindingsResp, lanesResp] =
      await Promise.all([
        workerApi.hosts.list(),
        workerApi.agents.list({ limit: MAP_LIMIT }),
        workerApi.dataSources.list({ limit: MAP_LIMIT }),
        workerApi.bindings.list({ limit: MAP_LIMIT }),
        workerApi.lanes.list(),
      ]);

    // DataSource list omits lane_ids; fetch detail per id (v1: < 200 nodes).
    const dataSources: DataSourceWithLanes[] = await Promise.all(
      dsResp.data.map((ds) => workerApi.dataSources.get(ds.id))
    );

    const payload: MapPayload = {
      hosts,
      agents: agentsResp.data,
      data_sources: dataSources,
      bindings: bindingsResp.data,
      lanes: lanesResp.data,
    };
    return NextResponse.json(payload);
  } catch (error) {
    return bffErrorResponse(error);
  }
}
