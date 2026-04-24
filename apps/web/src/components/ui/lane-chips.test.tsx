import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LaneChips } from "./lane-chips";

describe("LaneChips", () => {
  describe("single mode", () => {
    it("renders all lane options", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="single" value={null} onChange={onChange} />
      );

      expect(screen.getByRole("radio", { name: "Work" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Life" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Learning" })).toBeInTheDocument();
    });

    it("shows selected lane as active", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="single" value="lane_work" onChange={onChange} />
      );

      expect(screen.getByRole("radio", { name: "Work" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
      expect(screen.getByRole("radio", { name: "Life" })).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });

    it("calls onChange with lane id when clicked", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="single" value={null} onChange={onChange} />
      );

      fireEvent.click(screen.getByRole("radio", { name: "Life" }));
      expect(onChange).toHaveBeenCalledWith("lane_life");
    });

    it("calls onChange with null when clicking active lane", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="single" value="lane_work" onChange={onChange} />
      );

      fireEvent.click(screen.getByRole("radio", { name: "Work" }));
      expect(onChange).toHaveBeenCalledWith(null);
    });

    it("does not call onChange when disabled", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="single" value={null} onChange={onChange} disabled />
      );

      fireEvent.click(screen.getByRole("radio", { name: "Work" }));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("multi mode", () => {
    it("renders checkboxes for multi mode", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="multi" value={[]} onChange={onChange} />
      );

      expect(screen.getByRole("checkbox", { name: "Work" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Life" })).toBeInTheDocument();
    });

    it("shows multiple selected lanes as active", () => {
      const onChange = vi.fn();
      render(
        <LaneChips
          mode="multi"
          value={["lane_work", "lane_life"]}
          onChange={onChange}
        />
      );

      expect(screen.getByRole("checkbox", { name: "Work" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
      expect(screen.getByRole("checkbox", { name: "Life" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
      expect(screen.getByRole("checkbox", { name: "Learning" })).toHaveAttribute(
        "aria-checked",
        "false"
      );
    });

    it("adds lane to value when clicking unselected lane", () => {
      const onChange = vi.fn();
      render(
        <LaneChips mode="multi" value={["lane_work"]} onChange={onChange} />
      );

      fireEvent.click(screen.getByRole("checkbox", { name: "Life" }));
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

      fireEvent.click(screen.getByRole("checkbox", { name: "Work" }));
      expect(onChange).toHaveBeenCalledWith(["lane_life"]);
    });
  });
});
