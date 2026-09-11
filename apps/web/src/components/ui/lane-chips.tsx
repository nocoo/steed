import { ToggleGroup, ToggleGroupItem } from "@nocoo/basalt/components/toggle-group";
import { LANE_IDS, type LaneId } from "@steed/shared";

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

  if (props.mode === "single") {
    return (
      <ToggleGroup
        type="single"
        value={props.value ?? ""}
        onValueChange={(next) => {
          props.onChange(next === "" ? null : (next as LaneId));
        }}
        disabled={disabled}
        className={className}
        aria-label="Lane"
      >
        {LANE_OPTIONS.map((opt) => (
          <ToggleGroupItem
            key={opt.id}
            value={opt.id}
            aria-label={opt.label}
            disabled={disabled}
          >
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }

  return (
    <ToggleGroup
      type="multiple"
      value={props.value}
      onValueChange={(next) => {
        props.onChange(next as LaneId[]);
      }}
      disabled={disabled}
      className={className}
      aria-label="Lanes"
    >
      {LANE_OPTIONS.map((opt) => (
        <ToggleGroupItem
          key={opt.id}
          value={opt.id}
          aria-label={opt.label}
          disabled={disabled}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
