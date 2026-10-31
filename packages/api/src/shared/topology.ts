import { z } from "zod";
import { findSecretLike, matchesAllowlistedAttrType, type AllowlistedAttrType, type SecretLikePath } from "./secret-scan";

function topologyStrictObject<T extends z.core.$ZodLooseShape>(shape: T) {
  return z.strictObject(shape, { error: "Invalid topology structure." });
}

export const TOPOLOGY_LIMITS = {
  layers: 64,
  types: 128,
  boundaries: 256,
  nodes: 2000,
  edges: 10_000,
  views: 64,
  pinsPerView: 2000,
  bytes: 4 * 1024 * 1024,
  operations: 1000,
} as const;

export const topologyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,95}$/);
export const topologyColorSchema = z.union([
  z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
]);
export const topologyProvenanceSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export const topologyPointSchema = topologyStrictObject({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
});

export const topologyBorderStyleSchema = topologyStrictObject({
  color: topologyColorSchema.optional(),
  style: z.enum(["solid", "dashed", "dotted", "double"]).optional(),
  width: z.number().int().min(0).max(4).optional(),
});
export const topologyNodeStyleSchema = topologyStrictObject({
  shape: z.enum(["rect", "rounded", "pill", "hexagon", "cylinder", "diamond", "circle", "cloud"]).optional(),
  size: z.enum(["s", "m", "l"]).optional(),
  color: topologyColorSchema.optional(),
  border: topologyBorderStyleSchema.optional(),
  icon: z.string().min(1).max(64).optional(),
});
export const topologyEdgeStyleSchema = topologyStrictObject({
  dash: z.enum(["solid", "dashed", "dotted"]).optional(),
  width: z.number().int().min(1).max(4).optional(),
  animated: z.boolean().optional(),
});
export const topologyBoundaryStyleSchema = topologyStrictObject({
  color: topologyColorSchema.optional(),
  border: topologyBorderStyleSchema.optional(),
  icon: z.string().min(1).max(64).optional(),
});

export const topologyLayerSchema = topologyStrictObject({
  id: topologyIdSchema,
  label: z.string().trim().min(1).max(160),
  provider: z.string().trim().min(1).max(160),
  order: z.number().int().min(0).max(10_000),
  color: topologyColorSchema.optional(),
  icon: z.string().min(1).max(64).optional(),
  url: z.url({ protocol: /^https?$/ }).max(2048).optional(),
  description: z.string().max(4000).default(""),
  provenance: topologyProvenanceSchema.optional(),
});

export const topologyAttrDefSchema = topologyStrictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  label: z.string().trim().min(1).max(160),
  valueType: z.enum(["string", "number", "boolean", "enum", "public_key", "fingerprint", "identifier"]),
  unit: z.string().max(32).optional(),
  enumValues: z.array(z.string().min(1).max(256)).max(64).optional(),
  badge: z.boolean(),
  order: z.number().int().min(0).max(10_000),
  required: z.boolean(),
  provenance: topologyProvenanceSchema.optional(),
}).superRefine((attr, ctx) => {
  if (attr.valueType === "enum" && (!attr.enumValues || attr.enumValues.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["enumValues"], message: "Enum attributes require enumValues.", params: { topologyCode: "enum_values_required" } });
  }
  if (attr.valueType !== "enum" && attr.enumValues !== undefined) {
    ctx.addIssue({ code: "custom", path: ["enumValues"], message: "enumValues is valid only for enum attributes.", params: { topologyCode: "enum_values_not_allowed" } });
  }
});

export const topologyTypeDefSchema = topologyStrictObject({
  id: topologyIdSchema,
  label: z.string().trim().min(1).max(160),
  defaultLayerId: topologyIdSchema.optional(),
  shape: z.enum(["rect", "rounded", "pill", "hexagon", "cylinder", "diamond", "circle", "cloud"]),
  icon: z.string().min(1).max(64).optional(),
  color: topologyColorSchema.optional(),
  description: z.string().max(4000).default(""),
  attrs: z.array(topologyAttrDefSchema).max(32).default([]),
  provenance: topologyProvenanceSchema.optional(),
});

export const topologyBoundarySchema = topologyStrictObject({
  id: topologyIdSchema,
  label: z.string().trim().min(1).max(160),
  kind: z.enum(["trust", "site", "network", "account"]),
  parentId: topologyIdSchema.optional(),
  style: topologyBoundaryStyleSchema.optional(),
  description: z.string().max(4000).default(""),
  provenance: topologyProvenanceSchema.optional(),
});

const topologyAttrScalarSchema = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().min(1).max(256)).max(16),
]);

export const topologyNodeSchema = topologyStrictObject({
  id: topologyIdSchema,
  type: topologyIdSchema,
  label: z.string().trim().min(1).max(160),
  layerId: topologyIdSchema,
  boundaryIds: z.array(topologyIdSchema).max(8).default([]),
  parentId: topologyIdSchema.optional(),
  role: z.enum(["service", "subresource"]).optional(),
  lifecycle: z.enum(["active", "planned", "deprecated", "retired"]).default("active"),
  url: z.url({ protocol: /^https?$/ }).max(2048).optional(),
  description: z.string().max(4000).default(""),
  tags: z.array(z.string().min(1).max(100)).max(20).default([]),
  attrs: z.record(z.string(), topologyAttrScalarSchema).default({}),
  style: topologyNodeStyleSchema.optional(),
  provenance: topologyProvenanceSchema.optional(),
}).superRefine((node, ctx) => {
  const keys = Object.keys(node.attrs);
  if (keys.length > 32) ctx.addIssue({ code: "custom", path: ["attrs"], message: "Too many node attrs.", params: { topologyCode: "attrs_limit" } });
  for (const key of keys) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(key)) ctx.addIssue({ code: "custom", path: ["attrs"], message: "Invalid attr key.", params: { topologyCode: "invalid_attr_key" } });
    const values = Array.isArray(node.attrs[key]) ? node.attrs[key] : [node.attrs[key]];
    for (const value of values) {
      if (typeof value === "string" && value.length > 1024) ctx.addIssue({ code: "custom", path: ["attrs"], message: "Attr string exceeds 1024 characters.", params: { topologyCode: "attr_string_limit" } });
    }
  }
  if ((node.parentId !== undefined) !== (node.role !== undefined)) {
    ctx.addIssue({ code: "custom", path: node.parentId === undefined ? ["role"] : ["parentId"], message: "Satellite nodes require parentId and role together.", params: { topologyCode: "satellite_role_required" } });
  }
});

export const topologyEdgeSchema = topologyStrictObject({
  id: topologyIdSchema,
  source: topologyIdSchema,
  target: topologyIdSchema,
  kind: z.enum(["traffic", "dns", "binding", "deploy", "auth", "monitor", "uses", "tunnel"]),
  label: z.string().max(160).default(""),
  protocol: z.string().min(1).max(100).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  direction: z.enum(["uni", "bi"]),
  evidence: z.enum(["documented", "inferred"]),
  description: z.string().max(4000).default(""),
  tags: z.array(z.string().min(1).max(100)).max(20).default([]),
  style: topologyEdgeStyleSchema.optional(),
  provenance: topologyProvenanceSchema.optional(),
}).superRefine((edge, ctx) => {
  if (edge.source === edge.target) ctx.addIssue({ code: "custom", path: ["target"], message: "Edge endpoints must differ.", params: { topologyCode: "self_loop_edge" } });
});

export const topologyViewSchema = topologyStrictObject({
  id: topologyIdSchema,
  label: z.string().trim().min(1).max(160),
  description: z.string().max(4000).default(""),
  filter: topologyStrictObject({
    layerIds: z.array(topologyIdSchema).max(TOPOLOGY_LIMITS.layers).default([]),
    typeIds: z.array(topologyIdSchema).max(TOPOLOGY_LIMITS.types).default([]),
    boundaryIds: z.array(topologyIdSchema).max(TOPOLOGY_LIMITS.boundaries).default([]),
    tags: z.array(z.string().min(1).max(100)).max(20).default([]),
  }),
  focusLayerId: topologyIdSchema.optional(),
  pins: z.record(z.string(), topologyPointSchema).default({}),
  provenance: topologyProvenanceSchema.optional(),
});

export const topologySchema = topologyStrictObject({
  schemaVersion: z.literal(2),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(12_000).default(""),
  revision: z.number().int().nonnegative().optional(),
  provenance: topologyProvenanceSchema.optional(),
  layers: z.array(topologyLayerSchema).max(TOPOLOGY_LIMITS.layers).default([]),
  types: z.array(topologyTypeDefSchema).max(TOPOLOGY_LIMITS.types).default([]),
  boundaries: z.array(topologyBoundarySchema).max(TOPOLOGY_LIMITS.boundaries).default([]),
  nodes: z.array(topologyNodeSchema).max(TOPOLOGY_LIMITS.nodes).default([]),
  edges: z.array(topologyEdgeSchema).max(TOPOLOGY_LIMITS.edges).default([]),
  views: z.array(topologyViewSchema).max(TOPOLOGY_LIMITS.views).default([]),
}).superRefine((topology, ctx) => {
  const fail = (path: (string | number)[], code: string, message: string) => {
    ctx.addIssue({ code: "custom", path, message, params: { topologyCode: code } });
  };

  if (new TextEncoder().encode(JSON.stringify(topology)).byteLength > TOPOLOGY_LIMITS.bytes) {
    fail([], "exceeds_size_limit", "Topology exceeds 4 MiB.");
  }

  const seenCollections: Record<string, Map<string, number>> = {};
  for (const collection of ["layers", "types", "boundaries", "nodes", "edges", "views"] as const) {
    const seen = new Map<string, number>();
    seenCollections[collection] = seen;
    topology[collection].forEach((item, index) => {
      if (seen.has(item.id)) fail([collection, index, "id"], "duplicate_id", "Duplicate ID within collection.");
      seen.set(item.id, index);
    });
  }
  for (const node of topology.nodes) {
    const nodeIndex = seenCollections["nodes"]?.get(node.id) ?? 0;
    if (seenCollections["boundaries"]?.has(node.id)) fail(["nodes", nodeIndex, "id"], "node_boundary_id_collision", "Node and boundary IDs must be distinct.");
  }

  const orders = new Map<number, number>();
  topology.layers.forEach((layer, index) => {
    if (orders.has(layer.order)) fail(["layers", index, "order"], "duplicate_layer_order", "Layer order must be unique.");
    orders.set(layer.order, index);
  });

  const layers = new Map(topology.layers.map((layer) => [layer.id, layer]));
  const types = new Map(topology.types.map((type) => [type.id, type]));
  const boundaries = new Map(topology.boundaries.map((boundary) => [boundary.id, boundary]));
  const nodes = new Map(topology.nodes.map((node) => [node.id, node]));

  topology.types.forEach((type, index) => {
    if (type.defaultLayerId !== undefined && !layers.has(type.defaultLayerId)) {
      fail(["types", index, "defaultLayerId"], "unknown_reference", "Unknown default layer.");
    }
    const attrKeys = new Set<string>();
    type.attrs.forEach((attr, attrIndex) => {
      if (attrKeys.has(attr.key)) fail(["types", index, "attrs", attrIndex, "key"], "duplicate_attr_key", "Duplicate attr key in TypeDef.");
      attrKeys.add(attr.key);
    });
  });

  topology.boundaries.forEach((boundary, index) => {
    if (boundary.parentId === undefined) return;
    const seen = new Set([boundary.id]);
    let current: string | undefined = boundary.parentId;
    while (current !== undefined) {
      if (!boundaries.has(current)) { fail(["boundaries", index, "parentId"], "unknown_reference", "Unknown boundary parent."); break; }
      if (seen.has(current)) { fail(["boundaries", index, "parentId"], "boundary_hierarchy_cycle", "Boundary hierarchy contains a cycle."); break; }
      seen.add(current);
      current = boundaries.get(current)?.parentId;
    }
  });

  topology.nodes.forEach((node, index) => {
    if (!types.has(node.type)) fail(["nodes", index, "type"], "unknown_reference", "Unknown node type.");
    if (!layers.has(node.layerId)) fail(["nodes", index, "layerId"], "unknown_reference", "Unknown node layer.");
    const boundarySeen = new Set<string>();
    node.boundaryIds.forEach((boundaryId, boundaryIndex) => {
      if (boundarySeen.has(boundaryId)) fail(["nodes", index, "boundaryIds", boundaryIndex], "duplicate_boundary_id", "Duplicate node boundary.");
      boundarySeen.add(boundaryId);
      if (!boundaries.has(boundaryId)) fail(["nodes", index, "boundaryIds", boundaryIndex], "unknown_reference", "Unknown node boundary.");
    });

    if (node.parentId !== undefined) {
      if (!nodes.has(node.parentId)) fail(["nodes", index, "parentId"], "unknown_reference", "Unknown parent node.");
      else {
        const seen = new Set([node.id]);
        let current: string | undefined = node.parentId;
        let hops = 0;
        while (current !== undefined) {
          hops++;
          if (seen.has(current)) { fail(["nodes", index, "parentId"], "satellite_hierarchy_cycle", "Satellite hierarchy contains a cycle."); break; }
          seen.add(current);
          if (hops > 2) { fail(["nodes", index, "parentId"], "satellite_depth", "Satellite depth exceeds 2."); break; }
          const parent = nodes.get(current);
          if (!parent?.parentId) break;
          current = parent.parentId;
        }
      }

      let root: typeof node = node;
      const seen = new Set([node.id]);
      let parentId: string | undefined = node.parentId;
      while (parentId !== undefined) {
        if (seen.has(parentId)) break;
        seen.add(parentId);
        const parent = nodes.get(parentId);
        if (!parent) break;
        root = parent;
        parentId = parent.parentId;
      }
      if (!seen.has(root.id)) root = node;
      if (node.layerId !== root.layerId) fail(["nodes", index, "layerId"], "satellite_layer", "Satellite layer must match its root host.");
      if (node.boundaryIds.length !== 0) fail(["nodes", index, "boundaryIds"], "satellite_boundaries", "Satellite boundaryIds must be empty.");
    }
  });

  topology.edges.forEach((edge, index) => {
    if (!nodes.has(edge.source)) fail(["edges", index, "source"], "unknown_reference", "Unknown edge source.");
    if (!nodes.has(edge.target)) fail(["edges", index, "target"], "unknown_reference", "Unknown edge target.");
  });

  topology.views.forEach((view, viewIndex) => {
    if (view.focusLayerId !== undefined && !layers.has(view.focusLayerId)) fail(["views", viewIndex, "focusLayerId"], "unknown_reference", "Unknown focus layer.");
    for (const [group, ids] of [["layerIds", view.filter.layerIds], ["typeIds", view.filter.typeIds], ["boundaryIds", view.filter.boundaryIds]] as const) {
      const seen = new Set<string>();
      ids.forEach((id, idIndex) => {
        if (seen.has(id)) fail(["views", viewIndex, "filter", group, idIndex], "duplicate_view_filter_id", "Duplicate view filter ID.");
        seen.add(id);
      });
    }
    for (const [group, ids] of [["layerIds", view.filter.layerIds], ["typeIds", view.filter.typeIds], ["boundaryIds", view.filter.boundaryIds]] as const) {
      ids.forEach((id, idIndex) => {
        const collection = group === "layerIds" ? layers : group === "typeIds" ? types : boundaries;
        if (!collection.has(id)) fail(["views", viewIndex, "filter", group, idIndex], "unknown_reference", "Unknown view filter ID.");
      });
    }
    if (Object.keys(view.pins).length > TOPOLOGY_LIMITS.pinsPerView) fail(["views", viewIndex, "pins"], "pins_limit", "Too many view pins.");
    for (const [nodeId] of Object.entries(view.pins)) {
      if (!/^[a-z0-9][a-z0-9_.-]{0,95}$/.test(nodeId)) fail(["views", viewIndex, "pins", nodeId], "invalid_pin_id", "Invalid pin node ID.");
      if (!nodes.has(nodeId)) fail(["views", viewIndex, "pins", nodeId], "unknown_reference", "Unknown pin node.");
    }
  });

  topology.nodes.forEach((node, nodeIndex) => {
    const type = types.get(node.type);
    if (!type) return;
    const definitions = new Map(type.attrs.map((attr) => [attr.key, attr]));
    for (const attr of type.attrs) {
      if (attr.required && !Object.prototype.hasOwnProperty.call(node.attrs, attr.key)) {
        fail(["nodes", nodeIndex, "attrs"], "required_attr_missing", "Required attr is missing.");
      }
    }
    for (const [key, rawValue] of Object.entries(node.attrs)) {
      const definition = definitions.get(key);
      if (typeof rawValue === "string" && rawValue.length > 256 && !(definition?.valueType === "public_key" && rawValue.length <= 1024)) {
        fail(["nodes", nodeIndex, "attrs"], "attr_string_limit", "Attr string exceeds the allowed limit.");
      }
      if (definition) {
        const typeMatches = definition.valueType === "string" ? typeof rawValue === "string"
          : definition.valueType === "number" ? typeof rawValue === "number"
          : definition.valueType === "boolean" ? typeof rawValue === "boolean"
          : definition.valueType === "enum" ? typeof rawValue === "string"
          : typeof rawValue === "string";
        if (!typeMatches || Array.isArray(rawValue)) {
          fail(["nodes", nodeIndex, "attrs"], "attr_type_mismatch", "Attr value does not match declared TypeDef type.");
        }
        if (typeof rawValue === "string") {
          if (definition.valueType === "enum" && definition.enumValues && !definition.enumValues.includes(rawValue)) fail(["nodes", nodeIndex, "attrs"], "attr_enum_mismatch", "Attr value is not an allowed enum value.");
          const declared = (["public_key", "fingerprint", "identifier"] as const).includes(definition.valueType as AllowlistedAttrType) ? definition.valueType as AllowlistedAttrType : undefined;
          if (declared && !matchesAllowlistedAttrType(declared, rawValue)) {
            fail(["nodes", nodeIndex, "attrs"], "attr_format_mismatch", "Attr value does not match strict allowlisted format.");
          }
        }
      }
    }
  });

  topology.nodes.forEach((node, _nodeIndex) => {
    if (node.parentId === undefined) return;
    if (node.role === undefined) return;
    let current: string | undefined = node.parentId;
    const ancestors = new Set<string>();
    while (current !== undefined && !ancestors.has(current)) {
      ancestors.add(current);
      const parent = nodes.get(current);
      if (!parent?.parentId) break;
      current = parent.parentId;
    }
    topology.edges.forEach((edge, edgeIndex) => {
      if (ancestors.has(edge.source) && edge.target === node.id || ancestors.has(edge.target) && edge.source === node.id) {
        fail(["edges", edgeIndex], "ancestor_edge", "Satellite edges may not connect to an ancestor.");
      }
    });
  });

  scanTopologyStrings(topology, ctx);
});

export interface TopologyValidationIssue {
  path: SecretLikePath;
  code: string;
  message: string;
  rule?: string;
}

export interface TopologyWarning {
  code: "trust_boundary_crossing" | "duplicate_edge" | "isolated_node";
  path: (string | number)[];
  message: string;
}

function addSecretIssue(ctx: z.RefinementCtx, issue: ReturnType<typeof findSecretLike>, code: string): void {
  if (!issue) return;
  ctx.addIssue({
    code: "custom",
    path: Array.isArray(issue.path) ? [...issue.path] : [],
    message: `${code}:${issue.rule}`,
    params: { topologyCode: code, rule: issue.rule },
  });
}

function scanTopologyStrings(topology: z.infer<typeof topologySchema>, ctx: z.RefinementCtx): void {
  const scan = (value: string, path: SecretLikePath, options?: { declaredAttrType?: AllowlistedAttrType; attrKey?: boolean }) => {
    const issue = findSecretLike(value, path, options);
    if (issue) addSecretIssue(ctx, issue, "secret_like_value");
  };

  scan(topology.title, ["title"]); scan(topology.description, ["description"]); if (topology.provenance) scan(topology.provenance, ["provenance"]);
  topology.layers.forEach((layer, i) => {
    scan(layer.id, ["layers", i, "id"]); scan(layer.label, ["layers", i, "label"]); scan(layer.provider, ["layers", i, "provider"]); scan(layer.description, ["layers", i, "description"]);
    if (layer.provenance) scan(layer.provenance, ["layers", i, "provenance"]); if (layer.url) scan(layer.url, ["layers", i, "url"]); if (layer.icon) scan(layer.icon, ["layers", i, "icon"]); if (layer.color) scan(layer.color, ["layers", i, "color"]);
  });
  topology.types.forEach((type, i) => {
    scan(type.id, ["types", i, "id"]); scan(type.label, ["types", i, "label"]); scan(type.description, ["types", i, "description"]);
    if (type.defaultLayerId) scan(type.defaultLayerId, ["types", i, "defaultLayerId"]); if (type.icon) scan(type.icon, ["types", i, "icon"]); if (type.color) scan(type.color, ["types", i, "color"]); if (type.provenance) scan(type.provenance, ["types", i, "provenance"]);
    type.attrs.forEach((attr, ai) => {
      scan(attr.key, ["types", i, "attrs", ai, "key"], { attrKey: true }); scan(attr.label, ["types", i, "attrs", ai, "label"]);
      if (attr.valueType) scan(attr.valueType, ["types", i, "attrs", ai, "valueType"]); if (attr.unit) scan(attr.unit, ["types", i, "attrs", ai, "unit"]); if (attr.provenance) scan(attr.provenance, ["types", i, "attrs", ai, "provenance"]);
      attr.enumValues?.forEach((value, ei) => scan(value, ["types", i, "attrs", ai, "enumValues", ei]));
    });
  });
  topology.boundaries.forEach((boundary, i) => {
    scan(boundary.id, ["boundaries", i, "id"]); scan(boundary.label, ["boundaries", i, "label"]); scan(boundary.kind, ["boundaries", i, "kind"]); scan(boundary.description, ["boundaries", i, "description"]);
    if (boundary.parentId) scan(boundary.parentId, ["boundaries", i, "parentId"]); if (boundary.provenance) scan(boundary.provenance, ["boundaries", i, "provenance"]);
    if (boundary.style?.color) scan(boundary.style.color, ["boundaries", i, "style", "color"]); if (boundary.style?.border?.color) scan(boundary.style.border.color, ["boundaries", i, "style", "border", "color"]); if (boundary.style?.border?.style) scan(boundary.style.border.style, ["boundaries", i, "style", "border", "style"]); if (boundary.style?.icon) scan(boundary.style.icon, ["boundaries", i, "style", "icon"]);
  });
  topology.nodes.forEach((node, i) => {
    scan(node.id, ["nodes", i, "id"]); scan(node.type, ["nodes", i, "type"]); scan(node.label, ["nodes", i, "label"]); scan(node.layerId, ["nodes", i, "layerId"]); scan(node.lifecycle, ["nodes", i, "lifecycle"]); scan(node.description, ["nodes", i, "description"]);
    if (node.role) scan(node.role, ["nodes", i, "role"]); if (node.parentId) scan(node.parentId, ["nodes", i, "parentId"]); node.boundaryIds.forEach((boundaryId, bi) => scan(boundaryId, ["nodes", i, "boundaryIds", bi]));
    if (node.url) scan(node.url, ["nodes", i, "url"]); node.tags.forEach((tag, ti) => scan(tag, ["nodes", i, "tags", ti])); if (node.provenance) scan(node.provenance, ["nodes", i, "provenance"]);
    if (node.style?.shape) scan(node.style.shape, ["nodes", i, "style", "shape"]); if (node.style?.size) scan(node.style.size, ["nodes", i, "style", "size"]); if (node.style?.color) scan(node.style.color, ["nodes", i, "style", "color"]); if (node.style?.border?.color) scan(node.style.border.color, ["nodes", i, "style", "border", "color"]); if (node.style?.border?.style) scan(node.style.border.style, ["nodes", i, "style", "border", "style"]); if (node.style?.icon) scan(node.style.icon, ["nodes", i, "style", "icon"]);
    const type = topology.types.find((candidate) => candidate.id === node.type);
    for (const [key, rawValue] of Object.entries(node.attrs)) {
      scan(key, ["nodes", i, "attrs", key], { attrKey: true });
      const definition = type?.attrs.find((attr) => attr.key === key);
      const declared = definition && (["public_key", "fingerprint", "identifier"] as const).includes(definition.valueType as AllowlistedAttrType) ? definition.valueType as AllowlistedAttrType : undefined;
      if (typeof rawValue === "string") scan(rawValue, ["nodes", i, "attrs", key], declared ? { declaredAttrType: declared } : undefined);
      if (Array.isArray(rawValue)) rawValue.forEach((value, ai) => scan(value, ["nodes", i, "attrs", key, ai]));
    }
  });
  topology.edges.forEach((edge, i) => {
    scan(edge.id, ["edges", i, "id"]); scan(edge.source, ["edges", i, "source"]); scan(edge.target, ["edges", i, "target"]); scan(edge.kind, ["edges", i, "kind"]); scan(edge.label, ["edges", i, "label"]); scan(edge.direction, ["edges", i, "direction"]); scan(edge.evidence, ["edges", i, "evidence"]); scan(edge.description, ["edges", i, "description"]);
    if (edge.protocol) scan(edge.protocol, ["edges", i, "protocol"]); edge.tags.forEach((tag, ti) => scan(tag, ["edges", i, "tags", ti])); if (edge.provenance) scan(edge.provenance, ["edges", i, "provenance"]);
    if (edge.style?.dash) scan(edge.style.dash, ["edges", i, "style", "dash"]);
  });
  topology.views.forEach((view, i) => {
    scan(view.id, ["views", i, "id"]); scan(view.label, ["views", i, "label"]); scan(view.description, ["views", i, "description"]); if (view.focusLayerId) scan(view.focusLayerId, ["views", i, "focusLayerId"]); if (view.provenance) scan(view.provenance, ["views", i, "provenance"]);
    view.filter.layerIds.forEach((id, fi) => scan(id, ["views", i, "filter", "layerIds", fi])); view.filter.typeIds.forEach((id, fi) => scan(id, ["views", i, "filter", "typeIds", fi])); view.filter.boundaryIds.forEach((id, fi) => scan(id, ["views", i, "filter", "boundaryIds", fi])); view.filter.tags.forEach((tag, fi) => scan(tag, ["views", i, "filter", "tags", fi]));
    Object.keys(view.pins).forEach((nodeId) => scan(nodeId, ["views", i, "pins", nodeId]));
  });
}

export function topologyWarnings(topology: z.infer<typeof topologySchema>): TopologyWarning[] {
  const warnings: TopologyWarning[] = [];
  const boundaryMap = new Map(topology.boundaries.map((boundary) => [boundary.id, boundary]));

  const trustSetForNode = (node: z.infer<typeof topologyNodeSchema>): Set<string> => {
    let root = node;
    const seen = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = topology.nodes.find((candidate) => candidate.id === parentId);
      if (!parent) break;
      root = parent;
      parentId = parent.parentId;
    }
    const result = new Set<string>();
    for (const boundaryId of root.boundaryIds) {
      let current: string | undefined = boundaryId;
      const boundarySeen = new Set<string>();
      while (current && !boundarySeen.has(current)) {
        boundarySeen.add(current);
        const boundary = boundaryMap.get(current);
        if (boundary?.kind === "trust") result.add(current);
        current = boundary?.parentId;
      }
    }
    return result;
  };

  topology.edges.forEach((edge, index) => {
    const source = topology.nodes.find((node) => node.id === edge.source);
    const target = topology.nodes.find((node) => node.id === edge.target);
    if (source && target && edge.description.trim() === "") {
      const sourceTrust = trustSetForNode(source);
      const targetTrust = trustSetForNode(target);
      if ([...sourceTrust].some((id) => !targetTrust.has(id)) || [...targetTrust].some((id) => !sourceTrust.has(id))) {
        warnings.push({ code: "trust_boundary_crossing", path: ["edges", index, "description"], message: "Edge crosses trust boundaries without a description." });
      }
    }
  });

  const edgeKeys = new Set<string>();
  topology.edges.forEach((edge, index) => {
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.kind}`;
    if (edgeKeys.has(key)) warnings.push({ code: "duplicate_edge", path: ["edges", index], message: "Duplicate source, target and kind edge." });
    edgeKeys.add(key);
  });

  const connected = new Set<string>();
  topology.edges.forEach((edge) => { connected.add(edge.source); connected.add(edge.target); });
  topology.nodes.forEach((node, index) => {
    if (!node.parentId && !connected.has(node.id)) warnings.push({ code: "isolated_node", path: ["nodes", index], message: "Node has no edges and no parent." });
  });
  return warnings;
}

function sanitizeTopologyIssuePath(path: readonly PropertyKey[]): (string | number)[] {
  return path.flatMap((segment): (string | number)[] => {
    if (typeof segment === "number") return [segment];
    if (typeof segment !== "string") return ["[redacted]"];
    const issue = findSecretLike(segment, [segment], { attrKey: true });
    return issue ? ["[redacted]"] : [segment];
  });
}

export function validateTopology(input: unknown): { data?: Topology; issues: TopologyValidationIssue[]; warnings: TopologyWarning[] } {
  const result = topologySchema.safeParse(input);
  if (result.success) {
    return { data: result.data, issues: [], warnings: topologyWarnings(result.data) };
  }
  const issues = result.error.issues.map((rawIssue) => {
    const issue = rawIssue as unknown as { path: PropertyKey[]; message: string; params?: { topologyCode?: string; rule?: string } };
    return {
      path: sanitizeTopologyIssuePath(issue.path),
      code: issue.params?.topologyCode ?? "invalid_topology",
      message: "Invalid topology structure.",
      rule: issue.params?.rule,
    };
  });
  return { issues, warnings: [] };
}

export function emptyTopology(title = "Untitled topology"): Topology {
  return { schemaVersion: 2, title, description: "", revision: 0, layers: [], types: [], boundaries: [], nodes: [], edges: [], views: [] };
}

export const topologyEtag = (revision: number) => `"topology:${revision}"`;

export type Topology = z.infer<typeof topologySchema>;
export type TopologyLayer = z.infer<typeof topologyLayerSchema>;
export type TopologyTypeDef = z.infer<typeof topologyTypeDefSchema>;
export type TopologyAttrDef = z.infer<typeof topologyAttrDefSchema>;
export type TopologyBoundary = z.infer<typeof topologyBoundarySchema>;
export type TopologyNode = z.infer<typeof topologyNodeSchema>;
export type TopologyEdge = z.infer<typeof topologyEdgeSchema>;
export type TopologyView = z.infer<typeof topologyViewSchema>;
export type TopologyPoint = z.infer<typeof topologyPointSchema>;
