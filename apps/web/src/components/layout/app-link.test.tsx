import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppLink } from "./app-link";

describe("AppLink", () => {
  it("renders internal href through the router", () => {
    render(
      <MemoryRouter>
        <AppLink href="/hosts">Hosts</AppLink>
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Hosts" })).toHaveAttribute(
      "href",
      "/hosts"
    );
  });

  it("renders http(s) as a native anchor", () => {
    render(
      <AppLink href="https://github.com/nocoo/steed">GitHub</AppLink>
    );
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/nocoo/steed"
    );
  });
});
