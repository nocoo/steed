import { jsonOk, jsonError } from "../router";
import type { Handler } from "../router";

export const listBindings: Handler = async (req, { workerClient }) => {
  const url = new URL(req.url);
  const params = {
    agent_id: url.searchParams.get("agent_id") ?? undefined,
    data_source_id: url.searchParams.get("data_source_id") ?? undefined,
    limit: url.searchParams.get("limit")
      ? Number(url.searchParams.get("limit"))
      : undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  };
  const data = await workerClient.bindings.list(params);
  return jsonOk(data);
};

export const createBinding: Handler = async (req, { workerClient }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_request", "Invalid JSON body", 400);
  }
  const data = await workerClient.bindings.create(
    body as { agent_id: string; data_source_id: string }
  );
  return jsonOk(data, 201);
};

export const deleteBinding: Handler = async (_req, { workerClient, params }) => {
  await workerClient.bindings.delete(params.agentId ?? "", params.dataSourceId ?? "");
  return new Response(null, { status: 204 });
};
