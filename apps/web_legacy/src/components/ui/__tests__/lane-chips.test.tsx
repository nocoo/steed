import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LANE_IDS } from "@steed/shared";
import { LaneChips } from "../lane-chips";

afterEach(() => {
  cleanup();
});

describe("LaneChips", () => {
  it("renders three preset lanes", () => {
    render(<LaneChips mode="single" value={null} onChange={() => {}} />);
    expect(screen.getByLabelText("Work")).toBeDefined();
    expect(screen.getByLabelText("Life")).toBeDefined();
    expect(screen.getByLabelText("Learning")).toBeDefined();
  });

  describe("single mode", () => {
    it("marks the active lane with aria-checked=true", () => {
      render(
        <LaneChips mode="single" value={LANE_IDS.work} onChange={() => {}} />
      );
      expect(screen.getByLabelText("Work").getAttribute("aria-checked")).toBe(
        "true"
      );
      expect(screen.getByLabelText("Life").getAttribute("aria-checked")).toBe(
        "false"
      );
    });

    it("calls onChange with the new lane when an inactive chip is clicked", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="single" value={null} onChange={onChange} />
      );
      screen.getByLabelText("Work").click();
      expect(onChange).toHaveBeenCalledWith(LANE_IDS.work);
    });

    it("calls onChange with null when the active chip is clicked again (clear)", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="single" value={LANE_IDS.work} onChange={onChange} />
      );
      screen.getByLabelText("Work").click();
      expect(onChange).toHaveBeenCalledWith(null);
    });
  });

  describe("multi mode", () => {
    it("marks each active lane with aria-checked=true", () => {
      render(
        <LaneChips
          mode="multi"
          value={[LANE_IDS.work, LANE_IDS.learning]}
          onChange={() => {}}
        />
      );
      expect(screen.getByLabelText("Work").getAttribute("aria-checked")).toBe(
        "true"
      );
      expect(
        screen.getByLabelText("Learning").getAttribute("aria-checked")
      ).toBe("true");
      expect(screen.getByLabelText("Life").getAttribute("aria-checked")).toBe(
        "false"
      );
    });

    it("appends a lane when an inactive chip is clicked", () => {
      const onChange = vi.fn();
      render(
        <LaneChips
          mode="multi"
          value={[LANE_IDS.work]}
          onChange={onChange}
        />
      );
      screen.getByLabelText("Life").click();
      expect(onChange).toHaveBeenCalledWith([LANE_IDS.work, LANE_IDS.life]);
    });

    it("removes a lane when an active chip is clicked", () => {
      const onChange = vi.fn();
      render(
        <LaneChips
          mode="multi"
          value={[LANE_IDS.work, LANE_IDS.life]}
          onChange={onChange}
        />
      );
      screen.getByLabelText("Work").click();
      expect(onChange).toHaveBeenCalledWith([LANE_IDS.life]);
    });

    it("supports clearing to an empty array", () => {
      const onChange = vi.fn();
      render(
        <LaneChips
          mode="multi"
          value={[LANE_IDS.work]}
          onChange={onChange}
        />
      );
      screen.getByLabelText("Work").click();
      expect(onChange).toHaveBeenCalledWith([]);
    });
  });

  describe("disabled", () => {
    it("does not invoke onChange when disabled", () => {
      const onChange = vi.fn();
      render(
        <LaneChips
          mode="single"
          value={null}
          onChange={onChange}
          disabled
        />
      );
      const chip = screen.getByLabelText("Work") as HTMLButtonElement;
      expect(chip.disabled).toBe(true);
      chip.click();
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
