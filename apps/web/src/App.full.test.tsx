import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/diagram-client", () => ({ diagramClient: { list: vi.fn().mockResolvedValue({ data: [], nextCursor: null }) } }));

import { App } from "./App";
import { router } from "./router";

describe("App", () => {
  it("renders the live router", async () => {
    await act(() => router.navigate("/diagrams"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "Diagrams" })[0]).toBeInTheDocument();
    });
  });
});
