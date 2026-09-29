#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scripts = join(fileURLToPath(import.meta.url), "..");
const skillRoot = join(scripts, "..");
const temp = mkdtempSync(join(tmpdir(), "spec-docs-spec-diff-"));
const factsPath = join(temp, "docs-facts.json");
const registry = (title = "账户") => ({
  $schema: "spec-docs/facts/v1",
  version: "V1",
  facts: [{ id: "V1-FR-001", type: "requirement", title, lifecycle: "active", spec_status: "ready", implementation_status: "in_progress", delivery_scope: "active", delivery_slice: "V1-core", authority: "docs/feature.md", references: [], evidence: [] }],
  slices: [{ id: "V1-core", version: "V1", status: "in_progress", authority: "docs/feature.md", features: ["V1-FR-001"], depends_on: [], evidence: [] }],
  relations: [],
});
const run = (...args) => JSON.parse(execFileSync(process.execPath, [join(skillRoot, "scripts", "spec-diff.mjs"), "--dir", temp, ...args], { encoding: "utf8" }));
try {
  mkdirSync(join(temp, "docs"), { recursive: true });
  writeFileSync(join(temp, "docs/feature.md"), "# 账户\n\n初始规格。\n");
  writeFileSync(factsPath, JSON.stringify(registry(), null, 2));
  const baseline = run("--version", "V1", "--write-baseline");
  if (baseline.action !== "baseline_written" || !existsSync(join(temp, ".spec-docs", "baselines", "V1.json"))) throw new Error("基线未生成");
  const clean = run("--version", "V1");
  if (clean.summary.changes !== 0 || clean.errors.length) throw new Error("干净基线不应产生差异");
  writeFileSync(factsPath, JSON.stringify(registry("账户更新"), null, 2));
  const diff = run("--version", "V1");
  if (!diff.changes.some((change) => change.kind === "modified" && change.id === "V1-FR-001")) throw new Error("事实修改未识别");
  writeFileSync(join(temp, "docs/feature.md"), "# 账户\n\n规格发生变化。\n");
  const authorityDiff = run("--version", "V1");
  if (!authorityDiff.changes.some((change) => change.kind === "authority_changed" && change.path === "docs/feature.md")) throw new Error("权威文档摘要变化未识别");
  if (!diff.governance.affected_slices.includes("V1-core") || !diff.governance.required_writebacks.includes("facts_registry")) throw new Error("治理影响缺失");
  const unbound = registry("账户更新");
  unbound.facts[0].delivery_slice = null;
  writeFileSync(factsPath, JSON.stringify(unbound, null, 2));
  const strict = spawnSync(process.execPath, [join(skillRoot, "scripts", "spec-diff.mjs"), "--dir", temp, "--version", "V1", "--strict"], { encoding: "utf8" });
  if (strict.status === 0) throw new Error("严格模式未阻断未绑定切片的活动事实");
  writeFileSync(factsPath, JSON.stringify(registry("账户更新"), null, 2));
  const snapshotBefore = readFileSync(join(temp, ".spec-docs", "baselines", "V1.json"), "utf8");
  run("--version", "V1");
  if (readFileSync(join(temp, ".spec-docs", "baselines", "V1.json"), "utf8") !== snapshotBefore) throw new Error("只读运行修改了基线");
  const tampered = JSON.parse(snapshotBefore);
  tampered.facts[0].title = "被篡改";
  writeFileSync(join(temp, ".spec-docs", "baselines", "V1.json"), JSON.stringify(tampered));
  const invalid = run("--version", "V1");
  if (!invalid.errors.some((error) => error.code === "BASELINE_DIGEST")) throw new Error("未捕获基线摘要篡改");
  const initTarget = join(temp, "initialized");
  const init = spawnSync(process.execPath, [join(skillRoot, "scripts", "init-docs.mjs"), "--target", initTarget, "--tier", "s"], { encoding: "utf8" });
  if (init.status !== 0 || !existsSync(join(initTarget, "scripts", "spec-diff.mjs"))) throw new Error("初始化未生成 spec-diff.mjs");
  console.log("selftest-spec-diff: PASS");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
