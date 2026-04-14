/**
 * Generate a prefixed UUID
 * @param prefix - The prefix for the ID (e.g., "host", "agent", "ds")
 * @returns A string in the format "{prefix}_{uuid}"
 */
export function generateId(prefix: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}_${uuid}`;
}
