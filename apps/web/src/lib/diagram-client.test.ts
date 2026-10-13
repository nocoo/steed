import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDiagram } from "@steed/api/shared";
import { diagramClient, diagramRequest, downloadDiagram } from "./diagram-client";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("diagram client", () => {
  async function expectDiagramError(body: unknown, message: string) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(body, { status: 412 })));
    await expect(diagramRequest("/api/diagrams/example")).rejects.toMatchObject({ message });
  }

  it("preserves remote concurrency errors", async () => {
    await expectDiagramError({ error: { message: "Changed remotely" } }, "Changed remotely");
  });

  it("preserves validation errors", async () => {
    await expectDiagramError(
      { error: { message: "Invalid", issues: [{ path: ["nodes", 0, "id"], message: "Duplicate" }] } },
      "nodes.0.id: Duplicate",
    );
  });

  it("preserves generic HTTP errors", async () => {
    await expectDiagramError({}, "Request failed (412).");
  });

  it("sends same-origin requests with revision preconditions", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    await diagramClient.list("after-me");
    await diagramClient.get("example");
    await diagramClient.save("example", emptyDiagram(), null);
    await diagramClient.save("example", emptyDiagram(), 2);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await diagramClient.delete("example", 3);
    expect(fetcher.mock.calls[0]?.[0]).toContain("cursor=after-me");
    expect(fetcher.mock.calls[2]?.[1].headers.get("If-None-Match")).toBe("*");
    expect(fetcher.mock.calls[3]?.[1].headers.get("If-Match")).toBe('"example:2"');
    expect(fetcher.mock.calls[4]?.[1].headers.get("If-Match")).toBe('"example:3"');
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store" });
    expect(fetcher.mock.calls[2]?.[1].headers.get("X-Steed-Request")).toBe("1");
  });

  it("exports the complete document, including views and geometry", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:example");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const diagram = emptyDiagram("A diagram / test");
    downloadDiagram(diagram);
    expect(createObjectURL.mock.calls[0]?.[0].type).toBe("application/json");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:example");
    expect(click.mock.instances[0]?.download).toBe("A_diagram___test.json");
    downloadDiagram(emptyDiagram(""));
    expect(click.mock.instances[1]?.download).toBe("architecture.json");
  });
});
