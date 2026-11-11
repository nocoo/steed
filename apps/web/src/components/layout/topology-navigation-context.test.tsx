import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTopologyNavigation } from "./topology-navigation-context";

function DefaultNavigationHarness() {
  const navigation = useTopologyNavigation();
  return (
  <>
    <button type="button" onClick={() => navigation.toggleHidden()}>
      Default toggle hidden
    </button>
    <button type="button" onClick={() => navigation.toggleExpanded()}>
      Default toggle expanded
    </button>
    <button type="button" onClick={() => navigation.revealRail()}>
      Default reveal rail
    </button>
    <button type="button" onClick={() => navigation.setFullscreenActive(true)}>
      Default fullscreen
    </button>
  </>
  );
}

describe("useTopologyNavigation", () => {
  it("keeps default callbacks safe outside a provider", () => {
    render(<DefaultNavigationHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Default toggle hidden" }));
    fireEvent.click(screen.getByRole("button", { name: "Default toggle expanded" }));
    fireEvent.click(screen.getByRole("button", { name: "Default reveal rail" }));
    fireEvent.click(screen.getByRole("button", { name: "Default fullscreen" }));
    expect(screen.getByRole("button", { name: "Default toggle hidden" })).toBeInTheDocument();
  });
});
