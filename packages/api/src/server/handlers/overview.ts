import { jsonOk } from "../router";
import type { Handler } from "../router";

export const getOverview: Handler = async (_req, { workerClient }) => {
  const data = await workerClient.overview.get();
  return jsonOk(data);
};
