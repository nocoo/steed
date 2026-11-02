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

const defaultNavigation: TopologyNavigation = {
  state: "rail",
  fullscreenActive: false,
  toggleHidden: () => undefined,
  toggleExpanded: () => undefined,
  revealRail: () => undefined,
  setFullscreenActive: () => undefined,
};

const TopologyNavigationContext = createContext<TopologyNavigation>(defaultNavigation);

export function TopologyNavigationProvider({ children, value }: { children: ReactNode; value: TopologyNavigation }) {
  return <TopologyNavigationContext.Provider value={value}>{children}</TopologyNavigationContext.Provider>;
}

export function useTopologyNavigation() {
  return useContext(TopologyNavigationContext);
}
