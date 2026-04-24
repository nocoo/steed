import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "./router";
import { ApiClientProvider } from "./contexts/api-client";

function renderApp(initialPath = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return render(
    <ApiClientProvider>
      <RouterProvider router={router} />
    </ApiClientProvider>
  );
}

describe("App", () => {
  it("renders with ApiClientProvider and router", () => {
    renderApp("/overview");
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("renders sidebar navigation", () => {
    renderApp("/overview");
    expect(screen.getByText("Steed")).toBeInTheDocument();
  });
});
