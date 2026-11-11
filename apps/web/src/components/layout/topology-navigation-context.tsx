import { createContext, useContext, type ReactNode } from "react";

export type TopologyNavigationState = "rail" | "hidden" | "expanded";

export interface TopologyNavigation {
  state: TopologyNavigationState;
  fullscreenActive: boolean;
  toggleHidden: (moveFocus?: boolean) => void;
  toggleExpanded: () => void;
  revealRail: (moveFocus?: boolean) => void;
  setFullscreenActive: (active: boolean) => void;
}

const noopNavigation = () => undefined;

const defaultNavigation: TopologyNavigation = {
  state: "rail",
  fullscreenActive: false,
  toggleHidden: noopNavigation,
  toggleExpanded: noopNavigation,
  revealRail: noopNavigation,
  setFullscreenActive: noopNavigation,
};

const TopologyNavigationContext = createContext<TopologyNavigation>(defaultNavigation);

export function TopologyNavigationProvider({ children, value }: { children: ReactNode; value: TopologyNavigation }) {
  return <TopologyNavigationContext.Provider value={value}>{children}</TopologyNavigationContext.Provider>;
}

export function useTopologyNavigation() {
  return useContext(TopologyNavigationContext);
}
