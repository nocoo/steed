import { jsonOk, jsonError } from "../router";
import type { Handler } from "../router";
import { createBindingSchema } from "../../shared/schemas";

export const listBindings: Handler = async (req, { workerClient }) => {
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    return jsonError("invalid_request", "Invalid limit", 400);
  }
  const params = {
    agent_id: url.searchParams.get("agent_id") ?? undefined,
    data_source_id: url.searchParams.get("data_source_id") ?? undefined,
    limit,
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

  const parsed = createBindingSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("invalid_request", "Invalid request body", 400, parsed.error.issues);
  }

  const data = await workerClient.bindings.create(parsed.data);
  return jsonOk(data, 201);
};

export const deleteBinding: Handler = async (_req, { workerClient, params }) => {
  await workerClient.bindings.delete(params.agentId ?? "", params.dataSourceId ?? "");
  return new Response(null, { status: 204 });
};
