import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LaneChips } from "./lane-chips";

describe("LaneChips", () => {
  describe("single mode", () => {
    it("renders all lane options", () => {
      render(<LaneChips mode="single" value={null} onChange={vi.fn()} />);

      expect(screen.getByLabelText("Work")).toBeInTheDocument();
      expect(screen.getByLabelText("Life")).toBeInTheDocument();
      expect(screen.getByLabelText("Learning")).toBeInTheDocument();
    });

    it("shows selected lane as active", () => {
      render(
        <LaneChips mode="single" value="lane_work" onChange={vi.fn()} />
      );

      expect(screen.getByLabelText("Work")).toHaveAttribute("data-state", "on");
      expect(screen.getByLabelText("Life")).toHaveAttribute("data-state", "off");
    });

    it("calls onChange with lane id when clicked", () => {
      const onChange = vi.fn();
      render(<LaneChips mode="single" value={null} onChange={onChange} />);

      fireEvent.click(screen.getByLabelText("Life"));
      expect(onChange).toHaveBeenCalledWith("lane_life");
    });

    it("calls onChange with null when clicking active lane", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="single" value="lane_work" onChange={onChange} />
      );

      fireEvent.click(screen.getByLabelText("Work"));
      expect(onChange).toHaveBeenCalledWith(null);
    });

    it("does not call onChange when disabled", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="single" value={null} onChange={onChange} disabled />
      );

      fireEvent.click(screen.getByLabelText("Work"));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("multi mode", () => {
    it("renders all lane options", () => {
      render(<LaneChips mode="multi" value={[]} onChange={vi.fn()} />);

      expect(screen.getByLabelText("Work")).toBeInTheDocument();
      expect(screen.getByLabelText("Life")).toBeInTheDocument();
    });

    it("shows multiple selected lanes as active", () => {
      render(
        <LaneChips
          mode="multi"
          value={["lane_work", "lane_life"]}
          onChange={vi.fn()}
        />
      );

      expect(screen.getByLabelText("Work")).toHaveAttribute("data-state", "on");
      expect(screen.getByLabelText("Life")).toHaveAttribute("data-state", "on");
      expect(screen.getByLabelText("Learning")).toHaveAttribute(
        "data-state",
        "off"
      );
    });

    it("adds lane to value when clicking unselected lane", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="multi" value={["lane_work"]} onChange={onChange} />
      );

      fireEvent.click(screen.getByLabelText("Life"));
      expect(onChange).toHaveBeenCalledWith(["lane_work", "lane_life"]);
    });

    it("removes lane from value when clicking selected lane", () => {
      const onChange = vi.fn();
      render(
        <LaneChips
          mode="multi"
          value={["lane_work", "lane_life"]}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByLabelText("Work"));
      expect(onChange).toHaveBeenCalledWith(["lane_life"]);
    });
  });
});
