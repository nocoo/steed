import type { DataSourceWithLanes } from "@steed/shared";
import { jsonOk } from "../router";
import type { Handler } from "../router";
import { buildGraph, type MapInput } from "../../shared/lane-map";

export const getMap: Handler = async (_req, { workerClient }) => {
  const [hostsRes, agentsRes, dataSourcesRes, bindingsRes, lanesRes] =
    await Promise.all([
      workerClient.hosts.list(),
      workerClient.agents.list({ limit: 1000 }),
      workerClient.dataSources.list({ limit: 1000 }),
      workerClient.bindings.list({ limit: 5000 }),
      workerClient.lanes.list(),
    ]);

  const dataSources: DataSourceWithLanes[] = await Promise.all(
    dataSourcesRes.data.map(async (ds) => {
      try {
        return await workerClient.dataSources.get(ds.id);
      } catch {
        return { ...ds, metadata: {}, lane_ids: [] };
      }
    })
  );

  const input: MapInput = {
    hosts: hostsRes,
    agents: agentsRes.data,
    data_sources: dataSources,
    bindings: bindingsRes.data,
    lanes: lanesRes.data,
  };

  const graph = buildGraph(input);

  return jsonOk({
    hosts: input.hosts,
    agents: input.agents,
    data_sources: input.data_sources,
    bindings: input.bindings,
    lanes: input.lanes,
    graph,
  });
};
