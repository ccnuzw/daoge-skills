#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scripts = join(fileURLToPath(import.meta.url), "..");
const skillRoot = join(scripts, "..");
const temp = mkdtempSync(join(tmpdir(), "spec-docs-evidence-freshness-"));
const run = (...args) => JSON.parse(execFileSync(process.execPath, [join(scripts, "evidence-freshness.mjs"), "--dir", temp, ...args], { encoding: "utf8" }));
try {
  writeFileSync(join(temp, "docs-facts.json"), JSON.stringify({
    $schema: "spec-docs/facts/v1",
    facts: [
      { id: "V1-FR-001", type: "requirement", lifecycle: "active", evidence: [{ id: "fresh", path: "evidence/fresh.json", max_age_days: 30 }] },
      { id: "V1-OP-001", type: "operation", lifecycle: "active", evidence: [{ id: "stale", path: "evidence/stale.json", max_age_days: 1 }] },
      { id: "V1-E-001", type: "entity", lifecycle: "active", evidence: [] },
    ],
    slices: [],
    relations: [{ from: "V1-FR-001", to: "V1-OP-001", type: "defines_operation" }, { from: "V1-OP-001", to: "V1-E-001", type: "writes_entity" }],
  }, null, 2));
  const evidenceDir = join(temp, "evidence");
  execFileSync("mkdir", ["-p", evidenceDir]);
  writeFileSync(join(evidenceDir, "fresh.json"), JSON.stringify({ generatedAt: "2026-09-29T00:00:00Z", status: "passed", commit: "abc123" }));
  writeFileSync(join(evidenceDir, "stale.json"), JSON.stringify({ generatedAt: "2026-09-01T00:00:00Z", status: "passed", commit: "def456" }));
  const report = run("--now", "2026-09-30T00:00:00Z");
  if (report.summary.evidence !== 2 || report.summary.valid !== 1 || report.summary.stale !== 1) throw new Error("freshness summary mismatch");
  if (!report.affected.some((entry) => entry.node === "V1-FR-001") || !report.affected.some((entry) => entry.node === "V1-E-001")) throw new Error("stale evidence did not propagate");
  const strict = spawnSync(process.execPath, [join(skillRoot, "scripts", "evidence-freshness.mjs"), "--dir", temp, "--now", "2026-09-30T00:00:00Z", "--strict"], { encoding: "utf8" });
  if (strict.status === 0) throw new Error("strict freshness did not reject stale evidence");
  const initTarget = join(temp, "initialized");
  const init = spawnSync(process.execPath, [join(skillRoot, "scripts", "init-docs.mjs"), "--target", initTarget, "--tier", "s"], { encoding: "utf8" });
  if (init.status !== 0 || !existsSync(join(initTarget, "scripts", "evidence-freshness.mjs"))) throw new Error("initializer missed evidence-freshness.mjs");
  console.log("selftest-evidence-freshness: PASS");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
