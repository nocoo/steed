import {
  applyTopologyOperations,
  diffTopology,
  topologyWarnings,
  validateTopology,
  TopologyOperationError,
  type Topology,
  type TopologyOperation,
} from "@steed/api/shared";

function normalized(topology: Topology): Topology {
  return { ...topology, nodes: topology.nodes.map((node) => ({ ...node, boundaryIds: [...node.boundaryIds].sort() })) };
}

function plan(before: Topology, after: Topology, dangerous: boolean) {
  const result = normalized({ ...after, revision: before.revision });
  const items = diffTopology(normalized(before), result);
  const changed = Object.fromEntries(["metadata", "layers", "types", "boundaries", "nodes", "edges", "views"]
    .map((collection) => [collection, items.filter((item) => item.collection === collection).length]));
  return { after: result, items, changed, dangerous, warnings: topologyWarnings(result) };
}

export function planTopologyOperations(before: Topology, operations: TopologyOperation[]) {
  const after = applyTopologyOperations(before, operations);
  return plan(before, after, operations.some((operation) => operation.op.startsWith("remove_")));
}

export function planTopologyReplacement(before: Topology, input: unknown) {
  const result = validateTopology(input);
  if (!result.data) throw new TopologyOperationError("invalid_topology", result.issues);
  const prepared = plan(before, result.data, false);
  return { ...prepared, dangerous: prepared.items.some((item) => item.collection !== "metadata" && item.after === null) };
}
