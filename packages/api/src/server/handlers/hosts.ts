import { jsonOk } from "../router";
import type { Handler } from "../router";

export const listHosts: Handler = async (_req, { workerClient }) => {
  const data = await workerClient.hosts.list();
  return jsonOk(data);
};
