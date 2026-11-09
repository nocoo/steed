import type { Topology } from "@steed/api/shared";

export interface TopologySnapshotResponse {
  data: Topology;
  updatedAt: string;
  requestId?: string;
}

export interface TopologyGetOptions {
  signal?: AbortSignal;
}

export type TopologyFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createTopologyClient(fetcher: TopologyFetch = (input, init) => fetch(input, init)) {
  let cached: { snapshot: TopologySnapshotResponse; etag: string; sequence: number } | null = null;
  let requestSequence = 0;
  let cacheGeneration = 0;

  return {
    async get(options: TopologyGetOptions | AbortSignal = {}) {
      const signal = options instanceof AbortSignal ? options : options.signal;
      const sequence = ++requestSequence;
      const generation = cacheGeneration;
      const sent = cached === null ? null : { snapshot: cached.snapshot, etag: cached.etag };
      const headers = new Headers();
      headers.set("X-Steed-Request", "1");
      if (sent) headers.set("If-None-Match", sent.etag);
      const response = await fetcher("/api/topology", {
        method: "GET",
        headers,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (response.status === 304) {
        if (!sent) throw new Error("Topology was not modified, but no snapshot is cached.");
        const responseEtag = response.headers.get("ETag");
        if (responseEtag && responseEtag !== sent.etag) throw new Error("Topology 304 ETag does not match the requested snapshot.");
        if (generation === cacheGeneration && cached && cached.etag === sent.etag && sequence >= cached.sequence) {
          cached = { ...cached, sequence };
        }
        return sent.snapshot;
      }
      const body = await response.json() as TopologySnapshotResponse & { error?: { message: string; issues?: { path: (string | number)[]; message: string }[] } };
      if (!response.ok) {
        throw new Error(body.error?.issues ? body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n")
          : body.error?.message ?? `Request failed (${response.status}).`);
      }
      const etag = response.headers.get("ETag");
      const snapshot: TopologySnapshotResponse = { data: body.data, updatedAt: body.updatedAt, ...(body.requestId === undefined ? {} : { requestId: body.requestId }) };
      if (etag && generation === cacheGeneration && (!cached || sequence >= cached.sequence)) {
        cached = { snapshot, etag, sequence };
      }
      return snapshot;
    },
    clearCache() {
      cached = null;
      cacheGeneration++;
    },
  };
}

export const topologyClient = createTopologyClient();

export function downloadTopology(topology: Topology, filename?: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(topology, null, 2)], { type: "application/json" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename ?? `${topology.title.replace(/[^a-zA-Z0-9_-]/g, "_") || "topology"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
