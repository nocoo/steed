/**
 * Scheduler for periodic heartbeat execution
 */

/**
 * Heartbeat callback function type
 */
export type HeartbeatCallback = () => Promise<void>;

/**
 * Scheduler for running heartbeat at regular intervals
 */
export class Scheduler {
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private inFlight = false;

  /**
   * Create a new scheduler
   * @param intervalMs Interval between heartbeats in milliseconds (default: 10 minutes)
   */
  constructor(intervalMs: number = 600_000) {
    this.intervalMs = intervalMs;
  }

  /**
   * Start the scheduler
   * @param callback Function to run on each interval
   */
  start(callback: HeartbeatCallback): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Set up interval
    this.timer = setInterval(() => {
      void this.executeCallback(callback);
    }, this.intervalMs);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run the callback once immediately
   * @param callback Function to run
   */
  async runOnce(callback: HeartbeatCallback): Promise<void> {
    await this.executeCallback(callback);
  }

  /**
   * Check if the scheduler is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Check if a callback is currently in flight
   */
  isInFlight(): boolean {
    return this.inFlight;
  }

  /**
   * Get the interval in milliseconds
   */
  getIntervalMs(): number {
    return this.intervalMs;
  }

  /**
   * Execute callback with overlap prevention
   */
  private async executeCallback(callback: HeartbeatCallback): Promise<void> {
    // Prevent overlapping runs
    if (this.inFlight) {
      return;
    }

    this.inFlight = true;
    try {
      await callback();
    } catch {
      // Errors are logged by the callback itself
      // Scheduler continues running regardless
    } finally {
      this.inFlight = false;
    }
  }
}
