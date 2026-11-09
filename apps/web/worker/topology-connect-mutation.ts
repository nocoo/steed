import {
  topologyIdSchema,
  topologyOperationBatchSchema,
  topologyOperationSchema,
  TopologyOperationError,
  topologyValidationIssues,
  type Topology,
  type TopologyConnectOperation,
} from "@steed/api/shared";
import { HttpError } from "./http";
import { planTopologyOperations, planTopologyReplacement } from "./topology-mutation-plan";

const singular = {
  layers: "layer", types: "type", boundaries: "boundary",
  nodes: "node", edges: "edge", views: "view",
} as const;

export function planTopologyConnectMutation(
  before: Topology,
  operation: TopologyConnectOperation,
  params: Record<string, string>,
  input: unknown,
) {
  if (operation.id === "topology.put") return planTopologyReplacement(before, input);
  if (operation.id === "topology.validate" && !(input && typeof input === "object" && "operations" in input)) {
    return planTopologyReplacement(before, input);
  }
  if (operation.id === "topology.operations" || operation.id === "topology.validate") {
    const result = topologyOperationBatchSchema.safeParse(input);
    if (!result.success) throw new TopologyOperationError("invalid_topology", topologyValidationIssues(result.error));
    return planTopologyOperations(before, result.data.operations);
  }
  const collection = operation.collection;
  if (!collection || !operation.mutates) throw new Error("Not a topology mutation operation.");
  const id = topologyIdSchema.safeParse(params.entityId);
  if (!id.success) throw new HttpError(400, "invalid_id", "The topology ID is invalid.");
  if (operation.method === "DELETE") {
    if (!before[collection].some((entity) => entity.id === id.data)) throw new HttpError(404, "not_found", "Topology entity not found.");
    const parsed = topologyOperationSchema.parse({ op: `remove_${singular[collection]}`, id: id.data });
    return planTopologyOperations(before, [parsed]);
  }
  const parsed = topologyOperationSchema.safeParse({ op: `put_${singular[collection]}`, value: input });
  // Paths are relative to the entity body, so drop the synthetic operation's `value` prefix.
  if (!parsed.success) throw new TopologyOperationError("invalid_topology", topologyValidationIssues(parsed.error, ["value"]));
  if (!("value" in parsed.data) || parsed.data.value.id !== id.data) {
    throw new HttpError(422, "id_mismatch", "The entity ID must match its path.");
  }
  try {
    return planTopologyOperations(before, [parsed.data]);
  } catch (error) {
    // The body is the entity, so issues on it are relative to the body, like its structural errors.
    if (!(error instanceof TopologyOperationError)) throw error;
    throw new TopologyOperationError(error.code, error.issues.map((issue) => {
      const [head, index, value, ...rest] = issue.path;
      return head === "operations" && index === 0 && value === "value" ? { ...issue, path: rest } : issue;
    }));
  }
}
