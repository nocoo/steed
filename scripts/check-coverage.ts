#!/usr/bin/env bun
/**
 * Coverage gate script
 * Verifies that test coverage meets the 90% threshold
 * Run after vitest to check coverage/coverage-summary.json
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

const THRESHOLD = 90;
const coveragePath = join(import.meta.dirname, "..", "coverage", "coverage-summary.json");

interface CoverageSummary {
  total: {
    lines: { pct: number };
    statements: { pct: number };
    functions: { pct: number };
    branches: { pct: number };
  };
}

if (!existsSync(coveragePath)) {
  console.log("⏭️  No coverage data found (skipped)");
  console.log("   Run 'bun run test' first to generate coverage");
  process.exit(0);
}

const content = readFileSync(coveragePath, "utf-8");
const summary = JSON.parse(content) as CoverageSummary;
const { lines, statements, functions, branches } = summary.total;

const metrics = [
  { name: "lines", pct: lines.pct },
  { name: "statements", pct: statements.pct },
  { name: "functions", pct: functions.pct },
  { name: "branches", pct: branches.pct },
];

const belowThreshold = metrics.filter((m) => m.pct < THRESHOLD);

if (belowThreshold.length > 0) {
  console.error("❌ Coverage below threshold:");
  for (const m of belowThreshold) {
    console.error(`   ${m.name}: ${m.pct.toFixed(2)}% < ${THRESHOLD}%`);
  }
  process.exit(1);
}

console.log("✅ Coverage gate passed");
for (const m of metrics) {
  console.log(`   ${m.name}: ${m.pct.toFixed(2)}%`);
}
