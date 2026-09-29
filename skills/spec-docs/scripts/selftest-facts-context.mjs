#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptsRoot = join(fileURLToPath(import.meta.url), "..");
const skillRoot = join(scriptsRoot, "..");
const init = join(scriptsRoot, "init-docs.mjs");
const temp = mkdtempSync(join(tmpdir(), "spec-docs-facts-context-"));
const run = (script, args = []) => execFileSync(process.execPath, [join(scriptsRoot, script), ...args], { cwd: temp, encoding: "utf8" });
try {
  execFileSync(process.execPath, [init, "--target", temp, "--tier", "s"], { encoding: "utf8" });
  if (!existsSync(join(temp, "docs-facts.json")) || !existsSync(join(temp, "scripts", "context-pack.mjs")) || !existsSync(join(temp, "scripts", "facts-utils.mjs")) || !existsSync(join(temp, "scripts", "traceability-report.mjs"))) throw new Error("初始化未生成事实资产");
  const policyPath = join(temp, "docs-policy.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.facts = { enabled: true, file: "docs-facts.json", strict: true };
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  const check = execFileSync(process.execPath, [join(temp, "scripts", "check-docs.mjs"), "--quiet"], { cwd: temp, encoding: "utf8" });
  if (!check.includes("0 errors")) throw new Error(`事实注册表检查未通过：${check}`);
  const context = JSON.parse(run("context-pack.mjs", ["--slice", "V1-core"]));
  if (context.read_only !== true || context.selector.slice !== "V1-core" || !context.facts.some((entry) => entry.id === "V1-FR-001")) throw new Error("上下文包内容不完整");
  const trace = JSON.parse(run("traceability-report.mjs", ["--profile", "sdd"]));
  if (!trace.coverage.by_type.requirement || !Array.isArray(trace.coverage.uncovered_by_type)) throw new Error("追踪报告缺少按类型覆盖率");
  const facts = JSON.parse(readFileSync(join(temp, "docs-facts.json"), "utf8"));
  facts.facts.push({ id: "V1-FR-999", type: "requirement", title: "孤立事实", lifecycle: "active", spec_status: "draft", implementation_status: "planned", delivery_scope: "active", delivery_slice: null, authority: "docs/孤立.md", references: [], evidence: [] });
  writeFileSync(join(temp, "docs-facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
  let traceRejected = false;
  try { execFileSync(process.execPath, [join(temp, "scripts", "traceability-report.mjs"), "--profile", "sdd", "--strict"], { cwd: temp, encoding: "utf8" }); } catch { traceRejected = true; }
  if (!traceRejected) throw new Error("SDD 严格追踪未拒绝孤立事实");
  facts.facts[0].implementation_status = "completed";
  facts.facts[0].delivery_scope = "future";
  writeFileSync(join(temp, "docs-facts.json"), `${JSON.stringify(facts, null, 2)}\n`);
  let rejected = false;
  try { execFileSync(process.execPath, [join(temp, "scripts", "check-docs.mjs"), "--quiet"], { cwd: temp, encoding: "utf8" }); } catch { rejected = true; }
  if (!rejected) throw new Error("未拒绝 future/completed 冲突");
  console.log("selftest-facts-context: PASS");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
