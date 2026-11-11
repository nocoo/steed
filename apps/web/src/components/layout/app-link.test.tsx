import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("forwards click handlers to internal routes", () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter>
        <AppLink href="/connect" onClick={onClick}>
          Connect
        </AppLink>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Connect" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("forwards aria-current to internal routes", () => {
    render(
      <MemoryRouter>
        <AppLink href="/connect" aria-current="page">
          Connect
        </AppLink>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Connect" })).toHaveAttribute("aria-current", "page");
  });

  it("forwards click handlers to external links", () => {
    const onClick = vi.fn();
    render(
      <AppLink href="https://example.com" onClick={onClick}>
        Example
      </AppLink>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Example" }));
    expect(onClick).toHaveBeenCalled();
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
