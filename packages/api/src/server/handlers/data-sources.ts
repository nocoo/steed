import { jsonOk, jsonError } from "../router";
import type { Handler } from "../router";
import { dataSourceUpdateSchema, setLanesSchema } from "../../shared/schemas";

export const listDataSources: Handler = async (req, { workerClient }) => {
  const url = new URL(req.url);
  const params = {
    host_id: url.searchParams.get("host_id") ?? undefined,
    lane_id: url.searchParams.get("lane_id") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit")
      ? Number(url.searchParams.get("limit"))
      : undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  };
  const data = await workerClient.dataSources.list(params);
  return jsonOk(data);
};

export const getDataSource: Handler = async (
  _req,
  { workerClient, params }
) => {
  const data = await workerClient.dataSources.get(params.id ?? "");
  return jsonOk(data);
};

export const updateDataSource: Handler = async (
  req,
  { workerClient, params }
) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_request", "Invalid JSON body", 400);
  }

  const parsed = dataSourceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("invalid_request", "Invalid request body", 400, parsed.error.issues);
  }

  const patch = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  );
  const data = await workerClient.dataSources.update(params.id ?? "", patch);
  return jsonOk(data);
};

export const setDataSourceLanes: Handler = async (
  req,
  { workerClient, params }
) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_request", "Invalid JSON body", 400);
  }

  const parsed = setLanesSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("invalid_request", "Invalid request body", 400, parsed.error.issues);
  }

  const data = await workerClient.dataSources.setLanes(params.id ?? "", parsed.data);
  return jsonOk(data);
};
