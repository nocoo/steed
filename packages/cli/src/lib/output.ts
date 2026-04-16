import chalk from "chalk";
import Table from "cli-table3";
import ora, { type Ora } from "ora";

/**
 * Print success message (green ✓)
 */
export function success(message: string): void {
  console.log(chalk.green("✓") + " " + message);
}

/**
 * Print error message (red ✗)
 */
export function error(message: string): void {
  console.error(chalk.red("✗") + " " + message);
}

/**
 * Print warning message (yellow ⚠)
 */
export function warn(message: string): void {
  console.warn(chalk.yellow("⚠") + " " + message);
}

/**
 * Print info message (blue ℹ)
 */
export function info(message: string): void {
  console.log(chalk.blue("ℹ") + " " + message);
}

/**
 * Print ASCII table
 */
export function table(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): void {
  const t = new Table({
    head: headers.map((h) => chalk.bold(h)),
    style: {
      head: [],
      border: [],
    },
  });

  for (const row of rows) {
    t.push(row.map((cell) => (cell == null ? "" : String(cell))));
  }

  console.log(t.toString());
}

/**
 * Print formatted JSON
 */
export function json(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Create and return a spinner
 */
export function spinner(message: string): Ora {
  return ora(message);
}

/**
 * Format duration as human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 5) {
    return "just now";
  }

  if (seconds < 60) {
    return `${seconds} seconds ago`;
  }

  if (minutes < 60) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }

  if (hours < 24) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }

  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * Format ISO timestamp as relative duration
 */
export function formatTimestamp(isoTimestamp: string | null): string {
  if (!isoTimestamp) {
    return "never";
  }

  const date = new Date(isoTimestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  return formatDuration(diff);
}
