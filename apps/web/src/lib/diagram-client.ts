import { diagramEtag, type Diagram, type DiagramList, type DiagramRecord } from "@steed/api/shared";

import { browserRequest } from "./browser-request";

export const diagramClient = {
  list: (cursor = "") => browserRequest<DiagramList>(`/api/diagrams?limit=100&cursor=${encodeURIComponent(cursor)}`),
  get: (id: string) => browserRequest<DiagramRecord>(`/api/diagrams/${encodeURIComponent(id)}`),
  save: (id: string, document: Diagram, revision: number | null) => browserRequest<DiagramRecord>(`/api/diagrams/${encodeURIComponent(id)}`, {
    method: "PUT", body: JSON.stringify(document), headers: revision === null ? { "If-None-Match": "*" } : { "If-Match": diagramEtag(id, revision) },
  }),
  delete: (id: string, revision: number) => browserRequest<undefined>(`/api/diagrams/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "If-Match": diagramEtag(id, revision) } }),
};

export function downloadDiagram(document: Diagram) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${document.title.replace(/[^a-zA-Z0-9_-]/g, "_") || "architecture"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
