import { describe, expect, it } from "vitest";
import {
  TOPOLOGY_LIMITS,
  emptyTopology,
  topologyEtag, topologyChangesEtag,
  topologySchema,
  topologyAttrDefSchema,
  topologyNodeSchema,
  topologyWarnings,
  validateTopology,
  type Topology,
} from "./topology";

const runtime = (...parts: string[]) => parts.join("");

it("rejects enum values on a non-enum attribute definition", () => {
  const result = topologyAttrDefSchema.safeParse({ key: "region", label: "Region", valueType: "string", enumValues: ["test"], badge: false, order: 0, required: false });
  expect(result.success).toBe(false);
});

it("rejects malformed attribute keys and a satellite role without a parent", () => {
  const result = topologyNodeSchema.safeParse({ id: "fixture", type: "host", label: "Fixture", layerId: "cloud", role: "service", attrs: { "Invalid key": 1 } });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.map((issue) => issue.params?.topologyCode)).toEqual(expect.arrayContaining(["invalid_attr_key", "satellite_role_required"]));
});

it("keeps repeated secret values and attribute keys independently validated", () => {
  const graph = clone(sample());
  const secret = runtime("steed", "c_", "A".repeat(43));
  graph.nodes[0].description = secret;
  graph.nodes[1].description = secret;
  graph.nodes[0].attrs.token = "safe";
  const issues = validateTopology(graph).issues;
  expect(issues.filter((issue) => issue.rule === "known_prefix")).toHaveLength(2);
  expect(issues.some((issue) => issue.rule === "key_name")).toBe(true);
  expect(JSON.stringify(issues)).not.toContain(secret);
});

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Fixture topology",
    description: "Synthetic diagram",
    revision: 4,
    provenance: "manual",
    layers: [{ id: "compute", label: "Compute", provider: "Fixture cloud", order: 0, description: "Compute providers", provenance: "manual" }],
    types: [{
      id: "host",
      label: "Host",
      defaultLayerId: "compute",
      shape: "rounded",
      description: "Fixture host",
      provenance: "manual",
      attrs: [
        { key: "region", label: "Region", valueType: "enum", enumValues: ["test-a"], badge: true, order: 0, required: false, provenance: "manual" },
        { key: "commit", label: "Commit", valueType: "identifier", badge: true, order: 1, required: false, provenance: "manual" },
      ],
    }],
    boundaries: [{ id: "home", label: "Home", kind: "trust", description: "Fixture trust boundary", provenance: "manual" }],
    nodes: [
      { id: "root", type: "host", label: "Root host", layerId: "compute", boundaryIds: ["home"], lifecycle: "active", description: "Root", tags: [], attrs: { region: "test-a", commit: "a".repeat(40) }, style: { shape: "rounded" }, provenance: "manual" },
      { id: "root-peer", type: "host", label: "Peer host", layerId: "compute", boundaryIds: [], lifecycle: "active", description: "Peer", tags: [], attrs: {}, provenance: "manual" },
    ],
    edges: [{ id: "peer-link", source: "root", target: "root-peer", kind: "traffic", label: "Fixture link", direction: "bi", evidence: "documented", description: "Fixture-only connection", tags: [], provenance: "manual" }],
    views: [{ id: "overview", label: "Overview", description: "Fixture view", filter: { layerIds: ["compute"], typeIds: ["host"], boundaryIds: ["home"], tags: [] }, focusLayerId: "compute", pins: { root: { x: 0, y: 0 } }, provenance: "manual" }],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function codes(result: ReturnType<typeof topologySchema.safeParse>): string[] {
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const params = issue.params as { topologyCode?: string; rule?: string } | undefined;
    return params?.rule ?? params?.topologyCode ?? issue.message;
  });
}

describe("topology v2 schema", () => {
  it("round trips a strict complete topology and exposes read-only revision and ETag", () => {
    const topology = sample();
    expect(topologySchema.parse(topology)).toEqual(topology);
    expect(topologySchema.parse(clone(topology))).toEqual(topology);
    expect(topologySchema.parse({ ...topology, revision: 99 }).revision).toBe(99);
    expect(emptyTopology("Fixture empty").schemaVersion).toBe(2);
    expect(topologyEtag(0)).toBe('"topology:0"');
    expect(topologyChangesEtag(510, 11)).toBe('"topology-changes:510:11"');
  });

  it("supports provenance on every entity and rejects secret-like values without echo", () => {
    const valid = sample();
    expect(topologySchema.safeParse(valid).success).toBe(true);
    expect(valid.nodes[0].provenance).toBe("manual");

    const fake = runtime("github", "_pat_fixture");
    const changes: Array<(value: Topology) => void> = [
      (value) => { value.provenance = fake; },
      (value) => { value.layers[0].provenance = fake; },
      (value) => { value.types[0].provenance = fake; },
      (value) => { value.types[0].attrs[0].provenance = fake; },
      (value) => { value.boundaries[0].provenance = fake; },
      (value) => { value.nodes[0].provenance = fake; },
      (value) => { value.edges[0].provenance = fake; },
      (value) => { value.views[0].provenance = fake; },
    ];
    for (const change of changes) {
      const candidate = clone(sample());
      change(candidate);
      const result = topologySchema.safeParse(candidate);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error)).not.toContain(fake);
      }
    }

    const malformed = clone(sample());
    malformed.nodes[0].provenance = "Cloudflare-Sync";
    expect(topologySchema.safeParse(malformed).success).toBe(false);
  });

  it("covers rich entity styles, provenance, attrs, validate responses and inherited warnings", () => {
    const topology = clone(sample());
    topology.layers[0].url = "https://fixture.example.test/health";
    topology.layers[0].icon = "cloud";
    topology.layers[0].color = "blue";
    topology.types[0].icon = "server";
    topology.types[0].color = "#123456";
    topology.types[0].attrs[0].unit = "region";
    topology.boundaries[0].style = { color: "#abcdef", border: { color: "blue", style: "solid", width: 2 }, icon: "shield" };
    topology.nodes[0].url = "https://fixture.example.test/root";
    topology.nodes[0].tags = ["fixture-tag"];
    topology.nodes[0].style = { shape: "cloud", size: "s", color: "blue", border: { color: "#123456", style: "dashed", width: 1 }, icon: "server" };
    topology.nodes[0].attrs.extra = ["alpha", "beta"];
    topology.nodes[0].attrs.boolean = true;
    topology.nodes[0].attrs.number = 42;
    topology.edges[0].protocol = "https";
    topology.edges[0].tags = ["fixture-edge"];
    topology.edges[0].style = { dash: "dashed", width: 2, animated: true };
    topology.views[0].filter.tags = ["fixture-view"];

    const validResult = validateTopology(topology);
    expect(validResult.issues).toEqual([]);
    expect(validResult.data?.schemaVersion).toBe(2);

    const invalidResult = validateTopology({ ...topology, title: "" });
    expect(invalidResult.data).toBeUndefined();
    expect(invalidResult.issues.length).toBeGreaterThan(0);

    topology.edges[0].description = "";
    topology.nodes[1].boundaryIds = ["home"];
    topology.nodes.push({ id: "service", type: "host", label: "Service", layerId: "compute", parentId: "root", role: "service", lifecycle: "active", boundaryIds: [], description: "Fixture", tags: [], attrs: {} });
    expect(topologyWarnings(topology).map((warning) => warning.code)).not.toContain("trust_boundary_crossing");

    const missingWarning = topologyWarnings({ ...topology, nodes: [] });
    expect(missingWarning).toEqual([]);
  });

  it("rejects unknown fields and malformed strict entity formats", () => {
    expect(topologySchema.safeParse({ ...sample(), unknownField: true }).success).toBe(false);
    expect(topologySchema.safeParse({ ...sample(), title: "" }).success).toBe(false);
    expect(topologySchema.safeParse({ ...sample(), nodes: [{ ...sample().nodes[0], unknownField: true }] }).success).toBe(false);
    expect(topologySchema.safeParse({ ...sample(), layers: [{ ...sample().layers[0], order: 1.5 }] }).success).toBe(false);
    expect(topologySchema.safeParse({ ...sample(), nodes: [{ ...sample().nodes[0], layerId: "BAD" }] }).success).toBe(false);
    expect(topologySchema.safeParse({ ...sample(), edges: [{ ...sample().edges[0], direction: "sideways" }] }).success).toBe(false);
  });

  it("enforces collection and node-boundary IDs, layer order, and limits", () => {
    const duplicate = clone(sample());
    duplicate.nodes.push(clone(duplicate.nodes[0]));
    expect(codes(topologySchema.safeParse(duplicate))).toContain("duplicate_id");

    const collision = clone(sample());
    collision.boundaries.push({ id: "root", label: "Collision", kind: "site", description: "Fixture" });
    expect(codes(topologySchema.safeParse(collision))).toContain("node_boundary_id_collision");

    const duplicateOrder = clone(sample());
    duplicateOrder.layers.push({ id: "peer", label: "Peer", provider: "Fixture", order: 0, description: "Fixture" });
    expect(codes(topologySchema.safeParse(duplicateOrder))).toContain("duplicate_layer_order");

    expect(topologySchema.safeParse({ ...sample(), nodes: Array.from({ length: TOPOLOGY_LIMITS.nodes + 1 }, (_, index) => ({ ...sample().nodes[0], id: `node-${index}` })) }).success).toBe(false);
  });

  it("validates references across every collection", () => {
    const cases: Array<(value: Topology) => Topology> = [
      (value) => ({ ...value, types: [{ ...value.types[0], defaultLayerId: "missing" }] }),
      (value) => ({ ...value, nodes: [{ ...value.nodes[0], type: "missing" }, value.nodes[1]] }),
      (value) => ({ ...value, nodes: [{ ...value.nodes[0], layerId: "missing" }, value.nodes[1]] }),
      (value) => ({ ...value, nodes: [{ ...value.nodes[0], boundaryIds: ["missing"] }, value.nodes[1]] }),
      (value) => ({ ...value, edges: [{ ...value.edges[0], source: "missing" }] }),
      (value) => ({ ...value, edges: [{ ...value.edges[0], target: "missing" }] }),
      (value) => ({ ...value, boundaries: [{ ...value.boundaries[0], parentId: "missing" }] }),
      (value) => ({ ...value, views: [{ ...value.views[0], focusLayerId: "missing" }] }),
      (value) => ({ ...value, views: [{ ...value.views[0], filter: { ...value.views[0].filter, layerIds: ["missing"] } }] }),
      (value) => ({ ...value, views: [{ ...value.views[0], pins: { missing: { x: 1, y: 1 } } }] }),
    ];
    for (const change of cases) expect(topologySchema.safeParse(change(clone(sample()))).success).toBe(false);
  });

  it("rejects boundary cycles and duplicate node boundary IDs", () => {
    const cycle = clone(sample());
    cycle.boundaries.push({ id: "child", label: "Child", kind: "site", parentId: "home", description: "Fixture" });
    cycle.boundaries[0].parentId = "child";
    expect(codes(topologySchema.safeParse(cycle))).toContain("boundary_hierarchy_cycle");

    const duplicateBoundary = clone(sample());
    duplicateBoundary.nodes[0].boundaryIds = ["home", "home"];
    expect(codes(topologySchema.safeParse(duplicateBoundary))).toContain("duplicate_boundary_id");
  });

  it("accepts satellite depth one and two and rejects depth three", () => {
    const depthOne = clone(sample());
    depthOne.nodes.push({ id: "service", type: "host", label: "Service", layerId: "compute", parentId: "root", role: "service", lifecycle: "active", boundaryIds: [], description: "Fixture", tags: [], attrs: {} });
    expect(topologySchema.safeParse(depthOne).success).toBe(true);

    const depthTwo = clone(sample());
    depthTwo.nodes.push({ id: "service", type: "host", label: "Service", layerId: "compute", parentId: "root", role: "service", lifecycle: "active", boundaryIds: [], description: "Fixture", tags: [], attrs: {} });
    depthTwo.nodes.push({ id: "port", type: "host", label: "Port", layerId: "compute", parentId: "service", role: "subresource", lifecycle: "active", boundaryIds: [], description: "Fixture", tags: [], attrs: {} });
    expect(topologySchema.safeParse(depthTwo).success).toBe(true);

    const depthThree = clone(depthTwo);
    depthThree.nodes.push({ id: "detail", type: "host", label: "Detail", layerId: "compute", parentId: "port", role: "subresource", lifecycle: "active", boundaryIds: [], description: "Fixture", tags: [], attrs: {} });
    expect(codes(topologySchema.safeParse(depthThree))).toContain("satellite_depth");
  });

  it("rejects parent cycles, same-layer violations, nonempty satellite boundaries and role mismatches", () => {
    const cycle = clone(sample());
    cycle.nodes[0].parentId = "root-peer";
    cycle.nodes[0].role = "service";
    cycle.nodes[1].parentId = "root";
    cycle.nodes[1].role = "service";
    expect(codes(topologySchema.safeParse(cycle))).toContain("satellite_hierarchy_cycle");

    const layer = clone(sample());
    layer.layers.push({ id: "other", label: "Other", provider: "Fixture", order: 1, description: "Fixture" });
    layer.nodes.push({ id: "service", type: "host", label: "Service", layerId: "other", parentId: "root", role: "service", lifecycle: "active", boundaryIds: [], description: "Fixture", tags: [], attrs: {} });
    expect(codes(topologySchema.safeParse(layer))).toContain("satellite_layer");

    const boundaries = clone(sample());
    boundaries.nodes.push({ id: "service", type: "host", label: "Service", layerId: "compute", parentId: "root", role: "service", lifecycle: "active", boundaryIds: ["home"], description: "Fixture", tags: [], attrs: {} });
    expect(codes(topologySchema.safeParse(boundaries))).toContain("satellite_boundaries");

    const roleMismatch = clone(sample());
    roleMismatch.nodes.push({ id: "service", type: "host", label: "Service", layerId: "compute", parentId: "root", lifecycle: "active", boundaryIds: [], description: "Fixture", tags: [], attrs: {} });
    expect(codes(topologySchema.safeParse(roleMismatch))).toContain("satellite_role_required");
  });

  it("rejects ancestor edges and self-loop edges", () => {
    const ancestor = clone(sample());
    ancestor.nodes.push({ id: "service", type: "host", label: "Service", layerId: "compute", parentId: "root", role: "service", lifecycle: "active", boundaryIds: [], description: "Fixture", tags: [], attrs: {} });
    ancestor.edges.push({ id: "host-service", source: "root", target: "service", kind: "traffic", label: "Fixture", direction: "uni", evidence: "inferred", description: "Fixture", tags: [] });
    expect(codes(topologySchema.safeParse(ancestor))).toContain("ancestor_edge");

    const loop = clone(sample());
    loop.edges[0].target = loop.edges[0].source;
    expect(codes(topologySchema.safeParse(loop))).toContain("self_loop_edge");
  });

  it("validates declared attrs, strict formats, requireds and enum values", () => {
    const enumMismatch = clone(sample());
    enumMismatch.nodes[0].attrs.region = "other";
    expect(codes(topologySchema.safeParse(enumMismatch))).toContain("attr_enum_mismatch");

    const required = clone(sample());
    required.types[0].attrs[0].required = true;
    delete required.nodes[0].attrs.region;
    expect(codes(topologySchema.safeParse(required))).toContain("required_attr_missing");

    const mismatch = clone(sample());
    mismatch.nodes[0].attrs.commit = 42;
    expect(codes(topologySchema.safeParse(mismatch))).toContain("attr_type_mismatch");

    const badIdentifier = clone(sample());
    badIdentifier.nodes[0].attrs.commit = "../fixture";
    expect(codes(topologySchema.safeParse(badIdentifier))).toContain("attr_format_mismatch");

    const arrayUnderDeclared = clone(sample());
    arrayUnderDeclared.nodes[0].attrs.region = ["test-a"];
    expect(codes(topologySchema.safeParse(arrayUnderDeclared)).length).toBeGreaterThan(0);

    const badDef = clone(sample());
    badDef.types[0].attrs[0].valueType = "enum";
    badDef.types[0].attrs[0].enumValues = [];
    expect(topologySchema.safeParse(badDef).success).toBe(false);
  });

  it("applies secret scan only to matching declared allowlist and never echoes values", () => {
    const identifier = "a".repeat(40);
    const valid = clone(sample());
    valid.nodes[0].attrs.commit = identifier;
    expect(topologySchema.safeParse(valid).success).toBe(true);

    const undeclared = clone(sample());
    undeclared.nodes[0].attrs.other = identifier;
    const undeclaredResult = topologySchema.safeParse(undeclared);
    expect(undeclaredResult.success).toBe(false);
    expect(JSON.stringify(undeclaredResult)).not.toContain(identifier);

    const keyValue = runtime("pass", "word");
    const keyTopology = clone(valid);
    keyTopology.types[0].attrs[0].key = keyValue;
    delete keyTopology.nodes[0].attrs.region;
    const keyResult = topologySchema.safeParse(keyTopology);
    expect(keyResult.success).toBe(false);
    if (!keyResult.success) {
      expect(JSON.stringify(keyResult.error)).not.toContain(keyValue);
      expect(codes(keyResult)).toContain("key_name");
    }

    const known = runtime("github", "_pat_fixture");
    const secretResult = topologySchema.safeParse({ ...valid, description: known });
    expect(secretResult.success).toBe(false);
    expect(JSON.stringify(secretResult)).not.toContain(known);

    const url = runtime("https://user:", "fixture@example.test");
    const urlResult = topologySchema.safeParse({ ...valid, title: url });
    expect(urlResult.success).toBe(false);
    expect(JSON.stringify(urlResult)).not.toContain("fixture@example.test");
  });

  it("scans IDs, references and pin keys and redacts validation errors", () => {
    const secret = runtime("gh", "p_fixture");
    const candidate = clone(sample());
    candidate.nodes[0].id = secret;
    candidate.edges[0].source = secret;
    candidate.views[0].pins = { [secret]: { x: 0, y: 0 } };
    const result = validateTopology(candidate);
    expect(result.issues.filter((issue) => issue.rule === "known_prefix").length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(result)).not.toContain(secret);

    const key = runtime("pass", "word");
    const invalid = clone(sample());
    invalid.types[0].attrs.push({ key, label: "Fixture", valueType: "number", badge: false, order: 4, required: false });
    invalid.nodes[0].attrs[key] = "not-a-number";
    const issues = validateTopology(invalid).issues;
    expect(issues.some((issue) => issue.code === "attr_type_mismatch")).toBe(true);
    expect(issues.some((issue) => issue.rule === "key_name")).toBe(true);
    expect(JSON.stringify(issues)).not.toContain(key);
    expect(JSON.stringify(validateTopology({ ...sample(), [secret]: "fixture" }))).not.toContain(secret);
  });

  it("enforces attr size limits and unique view filter IDs", () => {
    const many = clone(sample());
    many.nodes[0].attrs = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`value_${index}`, 1]));
    expect(codes(topologySchema.safeParse(many))).toContain("attrs_limit");

    const long = `${"x ".repeat(128)}x`;
    const undeclared = clone(sample());
    undeclared.nodes[0].attrs.note = long;
    expect(codes(topologySchema.safeParse(undeclared))).toContain("attr_string_limit");
    const declared = clone(sample());
    declared.types[0].attrs.push({ key: "note", label: "Note", valueType: "string", badge: false, order: 3, required: false });
    declared.nodes[0].attrs.note = long;
    expect(codes(topologySchema.safeParse(declared))).toContain("attr_string_limit");

    const duplicate = clone(sample());
    duplicate.views[0].filter.layerIds.push("compute");
    expect(codes(topologySchema.safeParse(duplicate))).toContain("duplicate_view_filter_id");
  });

  it("returns trust-crossing, duplicate-edge and isolated-node warnings", () => {
    const topology = clone(sample());
    topology.boundaries.push({ id: "office", label: "Office", kind: "trust", description: "Fixture" });
    topology.nodes[1].boundaryIds = ["office"];
    topology.edges[0].description = "";
    topology.edges.push({ ...topology.edges[0], id: "peer-link-duplicate" });
    topology.nodes.push({ id: "isolated", type: "host", label: "Isolated", layerId: "compute", lifecycle: "active", boundaryIds: [], description: "Fixture", tags: [], attrs: {} });

    const warnings = topologyWarnings(topology);
    expect(warnings.map((warning) => warning.code)).toContain("trust_boundary_crossing");
    expect(warnings.map((warning) => warning.code)).toContain("duplicate_edge");
    expect(warnings.map((warning) => warning.code)).toContain("isolated_node");
  });
});
