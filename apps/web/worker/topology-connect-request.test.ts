import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { topologyCollectionQuery, topologyIfMatch } from "./topology-connect-request";

const request = (headers: Record<string, string>) => new Request("https://example.com/api/v1/topology", { headers });
const url = (query: string) => new URL(`https://example.com/api/v1/topology/nodes${query}`);

describe("topology Connect request parsing", () => {
  it("requires a single exact topology ETag, strong or weak, including revision zero", () => {
    expect(topologyIfMatch(request({ "If-Match": '"topology:0"' }))).toBe(0);
    expect(topologyIfMatch(request({ "If-Match": '"topology:12"' }))).toBe(12);
    expect(topologyIfMatch(request({ "If-Match": 'W/"topology:35"' }))).toBe(35);
    expect(() => topologyIfMatch(request({}))).toThrow(expect.objectContaining({ status: 428, code: "precondition_required" }));
    for (const value of ['w/"topology:1"', 'W/ "topology:1"', 'W/"topology:01"', '"topology:01"', '"other:1"', "*", '"topology:9007199254740992"', '"topology:1", "topology:2"']) {
      expect(() => topologyIfMatch(request({ "If-Match": value }))).toThrow(expect.objectContaining({ status: 412, code: "version_conflict" }));
    }
    expect(() => topologyIfMatch(request({ "If-Match": '"topology:1"', "If-None-Match": "*" }))).toThrow(HttpError);
  });

  it("parses defaults, filtered node and edge queries, and bounded pages", () => {
    expect(topologyCollectionQuery(url(""), "layers")).toEqual({ cursor: "", limit: 50 });
    expect(topologyCollectionQuery(url("?cursor=a&limit=500&layer=cloud&type=host&tag=fixture&boundary=home&parent=root"), "nodes"))
      .toEqual({ cursor: "a", limit: 500, layer: "cloud", type: "host", tag: "fixture", boundary: "home", parent: "root" });
    expect(topologyCollectionQuery(url("?node=a&kind=uses"), "edges")).toEqual({ cursor: "", limit: 50, node: "a", kind: "uses" });
  });

  it("rejects unsupported, duplicate, malformed and out-of-range query values", () => {
    for (const query of ["?limit=0", "?limit=501", "?limit=-1", "?limit=x", "?limit=1&limit=2", "?cursor=INVALID", "?unknown=value", "?node=a"]) {
      expect(() => topologyCollectionQuery(url(query), "nodes")).toThrow(expect.objectContaining({ status: 400, code: "invalid_query" }));
    }
    expect(() => topologyCollectionQuery(url("?layer=cloud"), "edges")).toThrow(HttpError);
  });
});
