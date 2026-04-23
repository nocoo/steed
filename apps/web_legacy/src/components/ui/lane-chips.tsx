"use client";

import { LANE_IDS, type LaneId } from "@steed/shared";

import { cn } from "@/lib/utils";

const LANE_OPTIONS: { id: LaneId; label: string }[] = [
  { id: LANE_IDS.work, label: "Work" },
  { id: LANE_IDS.life, label: "Life" },
  { id: LANE_IDS.learning, label: "Learning" },
];

interface LaneChipsSingleProps {
  mode: "single";
  value: LaneId | null;
  onChange: (next: LaneId | null) => void;
  disabled?: boolean;
  className?: string;
}

interface LaneChipsMultiProps {
  mode: "multi";
  value: LaneId[];
  onChange: (next: LaneId[]) => void;
  disabled?: boolean;
  className?: string;
}

export type LaneChipsProps = LaneChipsSingleProps | LaneChipsMultiProps;

export function LaneChips(props: LaneChipsProps) {
  const { disabled, className } = props;

  const isActive = (id: LaneId): boolean => {
    if (props.mode === "single") return props.value === id;
    return props.value.includes(id);
  };

  const handleToggle = (id: LaneId) => {
    if (disabled) return;
    if (props.mode === "single") {
      props.onChange(props.value === id ? null : id);
      return;
    }
    if (props.value.includes(id)) {
      props.onChange(props.value.filter((v) => v !== id));
    } else {
      props.onChange([...props.value, id]);
    }
  };

  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      role={props.mode === "multi" ? "group" : "radiogroup"}
      aria-disabled={disabled || undefined}
    >
      {LANE_OPTIONS.map((opt) => {
        const active = isActive(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            role={props.mode === "multi" ? "checkbox" : "radio"}
            aria-checked={active}
            aria-label={opt.label}
            disabled={disabled}
            onClick={() => handleToggle(opt.id)}
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                : "border-input bg-background text-foreground hover:bg-accent"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
