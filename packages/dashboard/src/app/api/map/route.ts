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

    // DataSource list omits lane_ids; fetch detail per id.
    // Sequential (not Promise.all) to avoid TLS handshake storms against
    // the Worker — observed ECONNRESET when issuing N parallel detail
    // fetches alongside the 5 list calls above. v1 has < 200 nodes so the
    // extra latency is acceptable.
    const dataSources: DataSourceWithLanes[] = [];
    for (const ds of dsResp.data) {
      try {
        dataSources.push(await workerApi.dataSources.get(ds.id));
      } catch (err) {
        console.error(`[/api/map] dataSources.get(${ds.id}) failed:`, err);
        dataSources.push({
          ...ds,
          metadata: {},
          lane_ids: [],
        } satisfies DataSourceWithLanes);
      }
    }

    const payload: MapPayload = {
      hosts,
      agents: agentsResp.data,
      data_sources: dataSources,
      bindings: bindingsResp.data,
      lanes: lanesResp.data,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[/api/map] aggregate failed:", error);
    return bffErrorResponse(error);
  }
}
