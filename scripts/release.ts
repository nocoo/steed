#!/usr/bin/env bun
/**
 * Automated release script for Steed monorepo.
 *
 * Usage:
 *   bun run release              — Z+1 patch (default)
 *   bun run release -- minor     — Y+1 minor
 *   bun run release -- major     — X+1 major
 *   bun run release -- 1.0.0     — explicit version
 *   bun run release -- --dry-run — preview mode
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const PROJECT_ROOT = pathResolve(import.meta.dirname as string, "..");
const PACKAGE_JSON = pathResolve(PROJECT_ROOT, "package.json");
const CHANGELOG_MD = pathResolve(PROJECT_ROOT, "CHANGELOG.md");

interface VersionTarget {
  path: string;
  pattern: "json-version" | "test-assertion" | "sidebar-test";
}

const VERSION_TARGETS: VersionTarget[] = [
  { path: "package.json", pattern: "json-version" },
  { path: "apps/web/package.json", pattern: "json-version" },
  { path: "apps/web_legacy/package.json", pattern: "json-version" },
  { path: "packages/api/package.json", pattern: "json-version" },
  { path: "packages/cli/package.json", pattern: "json-version" },
  { path: "packages/shared/package.json", pattern: "json-version" },
  { path: "packages/worker/package.json", pattern: "json-version" },
  { path: "apps/web/src/lib/version.test.ts", pattern: "test-assertion" },
  { path: "apps/web/worker/index.test.ts", pattern: "test-assertion" },
  { path: "packages/worker/src/index.test.ts", pattern: "test-assertion" },
  { path: "packages/cli/src/index.test.ts", pattern: "test-assertion" },
  { path: "apps/web/src/components/layout/app-sidebar.test.tsx", pattern: "sidebar-test" },
];

const BUMP_TYPES = ["patch", "minor", "major"] as const;
type BumpType = (typeof BUMP_TYPES)[number];

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CONVENTIONAL_RE = /^(\w+)(?:\(.+?\))?!?:\s*(.+)$/;

const COMMIT_TYPE_MAP: Record<string, "added" | "changed" | "fixed"> = {
  feat: "added",
  fix: "fixed",
  refactor: "changed",
  chore: "changed",
  docs: "changed",
  test: "changed",
  perf: "changed",
  style: "changed",
  ci: "changed",
  build: "changed",
};

interface Commit {
  hash: string;
  subject: string;
}

interface ChangelogSections {
  added: string[];
  changed: string[];
  fixed: string[];
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; inherit?: boolean },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd ?? PROJECT_ROOT,
      stdio: opts?.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (!opts?.inherit) {
      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
    }

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runOrDie(
  cmd: string,
  args: string[],
  errorMsg: string,
): Promise<string> {
  const result = await run(cmd, args);
  if (result.code !== 0) {
    console.error(`❌ ${errorMsg}`);
    if (result.stderr.trim()) console.error(result.stderr.trim());
    process.exit(1);
  }
  return result.stdout.trim();
}

function parseSemver(version: string): [number, number, number] {
  if (!SEMVER_RE.test(version)) {
    console.error(`❌ Invalid semver: "${version}"`);
    process.exit(1);
  }
  return version.split(".").map(Number) as [number, number, number];
}

function compareSemver(a: string, b: string): number {
  const [a0, a1, a2] = parseSemver(a);
  const [b0, b1, b2] = parseSemver(b);
  if (a0 !== b0) return a0 - b0;
  if (a1 !== b1) return a1 - b1;
  return a2 - b2;
}

function determineAutoBump(current: string, commits: Commit[], lastTagDate?: Date): string {
  const [major, minor, patch] = parseSemver(current);
  const daysSinceLast = lastTagDate ? (Date.now() - lastTagDate.getTime()) / (1000 * 60 * 60 * 24) : 0;
  
  if (daysSinceLast > 3) {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function bumpVersion(current: string, bumpArg: string | undefined, commits: Commit[], lastTagDate?: Date): string {
  if (bumpArg && SEMVER_RE.test(bumpArg)) {
    if (compareSemver(bumpArg, current) <= 0) {
      console.error(`❌ Explicit version ${bumpArg} must be greater than current ${current}`);
      process.exit(1);
    }
    return bumpArg;
  }

  const [major, minor, patch] = parseSemver(current);

  if (!bumpArg) {
    return determineAutoBump(current, commits, lastTagDate);
  }

  if (!BUMP_TYPES.includes(bumpArg as BumpType)) {
    console.error(`❌ Invalid bump type: "${bumpArg}". Use: patch | minor | major | X.Y.Z`);
    process.exit(1);
  }

  switch (bumpArg as BumpType) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function readCurrentVersion(): string {
  const raw = readFileSync(PACKAGE_JSON, "utf-8");
  return JSON.parse(raw).version;
}

function updateVersionInFile(target: VersionTarget, oldVer: string, newVer: string): boolean {
  const abs = pathResolve(PROJECT_ROOT, target.path);
  const content = readFileSync(abs, "utf-8");
  let updated: string;

  if (target.pattern === "json-version") {
    const pattern = `"version": "${oldVer}"`;
    const replacement = `"version": "${newVer}"`;
    if (!content.includes(pattern)) {
      console.error(`  ✗ ${target.path} — pattern not found: ${pattern}`);
      return false;
    }
    updated = content.replace(pattern, replacement);
  } else if (target.pattern === "sidebar-test") {
    const pattern = `/v${oldVer.replace(/\./g, "\\.")}/`;
    const replacement = `/v${newVer.replace(/\./g, "\\.")}/`;
    if (!content.includes(pattern)) {
      console.error(`  ✗ ${target.path} — pattern not found: ${pattern}`);
      return false;
    }
    updated = content.replace(pattern, replacement);
  } else {
    const pattern = `"${oldVer}"`;
    const replacement = `"${newVer}"`;
    if (!content.includes(pattern)) {
      console.error(`  ✗ ${target.path} — version "${oldVer}" not found`);
      return false;
    }
    updated = content.replaceAll(pattern, replacement);
  }

  writeFileSync(abs, updated, "utf-8");
  console.log(`  ✓ ${target.path}`);
  return true;
}

async function getLastTag(): Promise<string | undefined> {
  const result = await run("git", ["describe", "--tags", "--abbrev=0"]);
  if (result.code !== 0) return undefined;
  return result.stdout.trim();
}

async function getCommitsSinceTag(tag: string | undefined): Promise<Commit[]> {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const stdout = await runOrDie("git", ["log", range, "--format=%H|||%s"], "Failed to read git log");
  if (!stdout) return [];
  return stdout
    .split("\n")
    .filter((l) => l.includes("|||"))
    .map((l) => {
      const idx = l.indexOf("|||");
      return { hash: l.slice(0, idx), subject: l.slice(idx + 3) };
    })
    .filter((c) => !c.subject.startsWith("chore(release):"));
}

function classifyCommits(commits: Commit[]): ChangelogSections {
  const sections: ChangelogSections = { added: [], changed: [], fixed: [] };

  for (const { subject } of commits) {
    if (subject.startsWith("Merge ")) continue;

    let desc: string;
    let sec: keyof ChangelogSections;

    const match = CONVENTIONAL_RE.exec(subject);
    if (match) {
      const type = (match[1] as string).toLowerCase();
      desc = (match[2] as string).trim();
      sec = COMMIT_TYPE_MAP[type] ?? "changed";
    } else {
      desc = subject.trim();
      sec = "changed";
    }

    if (desc && !sections[sec].includes(desc)) {
      sections[sec].push(desc);
    }
  }

  return sections;
}

function formatChangelogSection(version: string, sections: ChangelogSections): string {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`## [${version}] - ${today}`];

  const order: [keyof ChangelogSections, string][] = [
    ["added", "Added"],
    ["changed", "Changed"],
    ["fixed", "Fixed"],
  ];

  for (const [key, heading] of order) {
    const items = sections[key];
    if (items.length > 0) {
      lines.push("", `### ${heading}`);
      for (const item of items) {
        lines.push(`- ${item}`);
      }
    }
  }

  return lines.join("\n");
}

function updateChangelog(newSection: string): void {
  const content = readFileSync(CHANGELOG_MD, "utf-8");
  const marker = "## [";
  const idx = content.indexOf(marker);

  let updated: string;
  if (idx === -1) {
    updated = `${content.trimEnd()}\n\n${newSection}\n`;
  } else {
    updated = `${content.slice(0, idx)}${newSection}\n\n${content.slice(idx)}`;
  }

  writeFileSync(CHANGELOG_MD, updated);
}

async function main() {
  const rawArgs = process.argv.slice(2).filter((a) => a !== "--");
  const isDryRun = rawArgs.includes("--dry-run");
  const bumpArg = rawArgs.find((a) => a !== "--dry-run");

  if (isDryRun) {
    console.log("🏜️  Dry-run mode — no changes will be written\n");
  }

  if (!isDryRun) {
    const status = await runOrDie("git", ["status", "--porcelain"], "Failed to check git status");
    if (status) {
      console.error("❌ Working tree is not clean. Commit or stash changes first.");
      console.error(status);
      process.exit(1);
    }
  }

  const currentVersion = readCurrentVersion();
  const lastTag = await getLastTag();
  const commits = await getCommitsSinceTag(lastTag);

  let lastTagDate: Date | undefined;
  if (lastTag) {
    const tagDateStr = await runOrDie("git", ["log", "-1", "--format=%aI", lastTag], "Failed to get tag date");
    if (tagDateStr) lastTagDate = new Date(tagDateStr);
  }

  const newVersion = bumpVersion(currentVersion, bumpArg, commits, lastTagDate);

  console.log("📦 Steed Release");
  console.log(`   Current version: ${currentVersion}`);
  console.log(`   New version:     ${newVersion}`);
  console.log(`   Target files:    ${VERSION_TARGETS.length}`);
  console.log(`   Last tag:        ${lastTag ?? "(none)"}`);
  console.log("");

  console.log(`📝 Phase 1: Updating versions in ${VERSION_TARGETS.length} files...\n`);
  if (isDryRun) {
    for (const t of VERSION_TARGETS) console.log(`   [dry-run] Would update ${t.path}`);
  } else {
    for (const t of VERSION_TARGETS) {
      const ok = updateVersionInFile(t, currentVersion, newVersion);
      if (!ok) {
        console.error("Aborting. Revert changes with `git checkout .`");
        process.exit(1);
      }
    }
    console.log("\n   🔄 Running bun install to sync lockfile...");
    await runOrDie("bun", ["install"], "bun install failed");
    console.log("   ✅ Lockfile synced");
  }
  console.log("");

  console.log("📝 Phase 2: Generating CHANGELOG...\n");
  const sections = classifyCommits(commits);
  const changelogSection = formatChangelogSection(newVersion, sections);
  console.log(changelogSection);
  console.log("");

  if (isDryRun) {
    console.log("   [dry-run] Would update CHANGELOG.md");
  } else {
    updateChangelog(changelogSection);
    console.log("   ✅ CHANGELOG.md updated");
  }
  console.log("");

  console.log("💾 Phase 3: Committing, Tagging, and Pushing...\n");
  const commitMsg = `chore(release): publish v${newVersion}`;
  if (isDryRun) {
    console.log(`   [dry-run] Would commit: ${commitMsg}`);
    console.log(`   [dry-run] Would create tag: v${newVersion}`);
    console.log("   [dry-run] Would push to git and create gh release");
    return;
  }

  await runOrDie("git", ["add", "-A"], "Failed to stage changes");
  const commitResult = await run("git", ["commit", "-m", commitMsg], { inherit: true });
  if (commitResult.code !== 0) {
    console.error("❌ Commit failed");
    process.exit(1);
  }

  console.log("\n   🚀 Pushing branch...");
  await runOrDie("git", ["push", "origin", "main"], "git push failed");

  console.log(`   🏷️  Creating tag v${newVersion}...`);
  await runOrDie("git", ["tag", "-a", `v${newVersion}`, "-m", `Release v${newVersion}`], "Tag creation failed");
  await runOrDie("git", ["push", "origin", `v${newVersion}`], "Pushing tag failed");

  console.log("   🌐 Creating GitHub Release...");
  await run("gh", ["release", "create", `v${newVersion}`, "--title", `v${newVersion}`, "--notes", changelogSection], { inherit: true });

  console.log("\n🎉 Release completed! Remember to monitor CI status:");
  console.log("   gh run list --limit 5\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
