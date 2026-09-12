import { diagramEtag, type Diagram, type DiagramList, type DiagramRecord } from "@steed/api/shared";

export async function diagramRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Steed-Request", "1");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (response.status === 204) return undefined as T;
  const body = await response.json() as { error?: { message: string; issues?: { path: (string | number)[]; message: string }[] } };
  if (!response.ok) {
    const error = body.error;
    throw new Error(error?.issues ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n")
      : error?.message ?? `Request failed (${response.status}).`);
  }
  return body as T;
}

export const diagramClient = {
  list: (cursor = "") => diagramRequest<DiagramList>(`/api/diagrams?limit=100&cursor=${encodeURIComponent(cursor)}`),
  get: (id: string) => diagramRequest<DiagramRecord>(`/api/diagrams/${encodeURIComponent(id)}`),
  save: (id: string, document: Diagram, revision: number | null) => diagramRequest<DiagramRecord>(`/api/diagrams/${encodeURIComponent(id)}`, {
    method: "PUT", body: JSON.stringify(document), headers: revision === null ? { "If-None-Match": "*" } : { "If-Match": diagramEtag(id, revision) },
  }),
  delete: (id: string, revision: number) => diagramRequest<undefined>(`/api/diagrams/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "If-Match": diagramEtag(id, revision) } }),
};

export function downloadDiagram(document: Diagram) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${document.title.replace(/[^a-zA-Z0-9_-]/g, "_") || "architecture"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
