import { jsonOk } from "../router";
import type { Handler } from "../router";

export const listLanes: Handler = async (_req, { workerClient }) => {
  const data = await workerClient.lanes.list();
  return jsonOk(data);
};
