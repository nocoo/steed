#!/usr/bin/env bun
/**
 * Coverage gate script
 * Verifies that test coverage meets the threshold
 * Run after vitest to check coverage/coverage-summary.json
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

// Thresholds: 95% for lines/statements/functions; branches at 90%
// (v8 counts every TS optional-chain/nullish branch, undercounting reach).
const THRESHOLDS = {
  lines: 95,
  statements: 95,
  functions: 95,
  branches: 90,
};
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
  { name: "lines", pct: lines.pct, threshold: THRESHOLDS.lines },
  { name: "statements", pct: statements.pct, threshold: THRESHOLDS.statements },
  { name: "functions", pct: functions.pct, threshold: THRESHOLDS.functions },
  { name: "branches", pct: branches.pct, threshold: THRESHOLDS.branches },
];

const belowThreshold = metrics.filter((m) => m.pct < m.threshold);

if (belowThreshold.length > 0) {
  console.error("❌ Coverage below threshold:");
  for (const m of belowThreshold) {
    console.error(`   ${m.name}: ${m.pct.toFixed(2)}% < ${m.threshold}%`);
  }
  process.exit(1);
}

console.log("✅ Coverage gate passed");
for (const m of metrics) {
  console.log(`   ${m.name}: ${m.pct.toFixed(2)}% (threshold: ${m.threshold}%)`);
}
