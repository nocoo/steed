import type { ReactNode } from "react";
import {
  LinkProvider,
  ThemeProvider,
  TooltipProvider,
} from "@nocoo/basalt";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import { AppLink } from "./app-link";

const STEED_PRIMARY = {
  primary: { light: "175 70% 38%", dark: "175 65% 45%" },
} as const;

export function ShellProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AccentProvider
        defaultAccent="primary"
        persist={false}
        paletteOverrides={STEED_PRIMARY}
      >
        <LinkProvider render={AppLink}>
          <TooltipProvider>{children}</TooltipProvider>
        </LinkProvider>
      </AccentProvider>
    </ThemeProvider>
  );
}
