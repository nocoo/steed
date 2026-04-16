import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "./scheduler.js";

describe("Scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("uses default interval of 10 minutes", () => {
      const scheduler = new Scheduler();
      expect(scheduler.getIntervalMs()).toBe(600_000);
    });

    it("accepts custom interval", () => {
      const scheduler = new Scheduler(30_000);
      expect(scheduler.getIntervalMs()).toBe(30_000);
    });
  });

  describe("start", () => {
    it("begins interval execution", async () => {
      const scheduler = new Scheduler(1000);
      const callback = vi.fn().mockResolvedValue(undefined);

      scheduler.start(callback);
      expect(scheduler.isRunning()).toBe(true);

      // First interval triggers callback
      vi.advanceTimersByTime(1000);
      await Promise.resolve(); // Flush microtasks
      expect(callback).toHaveBeenCalledTimes(1);

      // Second interval
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });

    it("does nothing if already running", async () => {
      const scheduler = new Scheduler(1000);
      const callback1 = vi.fn().mockResolvedValue(undefined);
      const callback2 = vi.fn().mockResolvedValue(undefined);

      scheduler.start(callback1);
      scheduler.start(callback2); // Should be ignored

      vi.advanceTimersByTime(1000);
      await Promise.resolve();

      // Only first callback should be called
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).not.toHaveBeenCalled();

      scheduler.stop();
    });
  });

  describe("stop", () => {
    it("clears interval", async () => {
      const scheduler = new Scheduler(1000);
      const callback = vi.fn().mockResolvedValue(undefined);

      scheduler.start(callback);
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);

      // No more callbacks after stop
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(0);
    });

    it("does nothing if not running", () => {
      const scheduler = new Scheduler();
      expect(() => scheduler.stop()).not.toThrow();
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("runOnce", () => {
    it("executes callback immediately", async () => {
      const scheduler = new Scheduler();
      const callback = vi.fn().mockResolvedValue(undefined);

      await scheduler.runOnce(callback);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("waits for callback to complete", async () => {
      vi.useRealTimers(); // Use real timers for this test
      const scheduler = new Scheduler();
      let completed = false;

      const callback = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        completed = true;
      });

      await scheduler.runOnce(callback);

      expect(completed).toBe(true);
    });
  });

  describe("isRunning", () => {
    it("returns correct state", () => {
      const scheduler = new Scheduler();

      expect(scheduler.isRunning()).toBe(false);

      scheduler.start(vi.fn().mockResolvedValue(undefined));
      expect(scheduler.isRunning()).toBe(true);

      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("overlap prevention", () => {
    it("prevents overlapping runs by checking inFlight flag", async () => {
      const scheduler = new Scheduler(100);
      let callCount = 0;

      // Callback that takes time to complete
      const callback = vi.fn().mockImplementation(async () => {
        callCount++;
        // Simulate async work without setTimeout
        await Promise.resolve();
      });

      scheduler.start(callback);

      // First interval triggers callback
      vi.advanceTimersByTime(100);
      // Flush multiple microtasks to ensure callback completes
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(callCount).toBe(1);

      // Verify inFlight is reset after completion
      expect(scheduler.isInFlight()).toBe(false);

      scheduler.stop();
    });

    it("allows next run after previous completes", async () => {
      const scheduler = new Scheduler(100);
      const callback = vi.fn().mockResolvedValue(undefined);

      scheduler.start(callback);

      // First interval
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(scheduler.isInFlight()).toBe(false);

      // Second interval
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });
  });

  describe("error handling", () => {
    it("resets inFlight flag after callback error", async () => {
      const scheduler = new Scheduler(100);
      let callCount = 0;

      const callback = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("First call fails");
        }
      });

      scheduler.start(callback);

      // First call (throws)
      vi.advanceTimersByTime(100);
      // Flush microtasks to handle the error
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(1);
      expect(scheduler.isInFlight()).toBe(false); // Should be reset after error

      // Second call (succeeds)
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
      expect(callback).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });
  });
});
