import { createRouter } from "./router";
import { getOverview } from "./handlers/overview";
import { listHosts } from "./handlers/hosts";
import { listLanes } from "./handlers/lanes";
import { listAgents, getAgent, updateAgent } from "./handlers/agents";
import {
  listDataSources,
  getDataSource,
  updateDataSource,
  setDataSourceLanes,
} from "./handlers/data-sources";
import {
  listBindings,
  createBinding,
  deleteBinding,
} from "./handlers/bindings";
import { getMap } from "./handlers/map";

export function createApiRouter() {
  const router = createRouter();

  router.get("/api/overview", getOverview);
  router.get("/api/hosts", listHosts);
  router.get("/api/lanes", listLanes);
  router.get("/api/agents", listAgents);
  router.get("/api/agents/:id", getAgent);
  router.patch("/api/agents/:id", updateAgent);
  router.get("/api/data-sources", listDataSources);
  router.get("/api/data-sources/:id", getDataSource);
  router.patch("/api/data-sources/:id", updateDataSource);
  router.put("/api/data-sources/:id/lanes", setDataSourceLanes);
  router.get("/api/bindings", listBindings);
  router.post("/api/bindings", createBinding);
  router.delete("/api/bindings/:agentId/:dataSourceId", deleteBinding);
  router.get("/api/map", getMap);

  return router;
}
