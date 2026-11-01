import {
  Bot,
  Box,
  CircleDot,
  Cloud,
  Cpu,
  Database,
  GitBranch,
  Globe,
  HardDrive,
  Key,
  Laptop,
  Monitor,
  Network,
  Server,
  Shield,
  type LucideIcon,
} from "lucide-react";

export const TOPOLOGY_ICON_TABLE = {
  server: Server,
  database: Database,
  globe: Globe,
  cloud: Cloud,
  network: Network,
  laptop: Laptop,
  monitor: Monitor,
  "hard-drive": HardDrive,
  bot: Bot,
  "git-branch": GitBranch,
  shield: Shield,
  key: Key,
  box: Box,
  cpu: Cpu,
  "circle-dot": CircleDot,
} as const satisfies Record<string, LucideIcon>;

export const TOPOLOGY_FIXED_ICON_TABLE = TOPOLOGY_ICON_TABLE;

export function resolveTopologyIconComponent(icon: string): LucideIcon {
  return Object.prototype.hasOwnProperty.call(TOPOLOGY_ICON_TABLE, icon)
    ? TOPOLOGY_ICON_TABLE[icon as keyof typeof TOPOLOGY_ICON_TABLE]
    : TOPOLOGY_ICON_TABLE["circle-dot"];
}
