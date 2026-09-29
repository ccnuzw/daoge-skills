#!/usr/bin/env node
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = join(fileURLToPath(import.meta.url), "..");
const skillRoot = join(here, "..");
const temp = mkdtempSync(join(tmpdir(), "spec-docs-change-tools-"));
const docs = join(temp, "docs");
const scripts = join(temp, "scripts");
try {
  const slice = join(docs, "07-变更切片", "V1", "V1-CS-001-api.md");
  const feature = join(docs, "03-功能规格", "V1", "01-账户.md");
  const contract = join(docs, "04-技术架构", "当前版本", "V1-接口契约.md");
  for (const path of [slice, feature, contract]) {
    const dir = path.slice(0, path.lastIndexOf("/"));
    const mkdir = spawnSync("mkdir", ["-p", dir]);
    if (mkdir.status !== 0) throw new Error(mkdir.stderr.toString());
  }
  writeFileSync(slice, "# V1-CS-001\n主功能 V1-FR-001\noperationId: updateAccount\nPOST /accounts/{id}\n实体：Account\n## 元数据\n## 基线与目标\n## 影响清单\n## 验收与证据\n## 回写清单\n");
  writeFileSync(feature, "# V1-FR-001\noperationId: updateAccount\n");
  writeFileSync(contract, "# contract\noperationId: updateAccount\nPOST /accounts/{id}\n实体：Account\n");
  writeFileSync(join(temp, "docs-policy.json"), JSON.stringify({ root: "docs", tier: "m", facts: { enabled: true, file: "docs-facts.json" } }));
  writeFileSync(join(temp, "docs-facts.json"), JSON.stringify({
    $schema: "spec-docs/facts/v1",
    version: "V1",
    facts: [
      { id: "V1-FR-001", type: "requirement", title: "账户", lifecycle: "active", spec_status: "ready", implementation_status: "in_progress", delivery_scope: "active", delivery_slice: "V1-core", authority: "docs/03-功能规格/V1/01-账户.md", references: [], evidence: [] },
      { id: "V1-OP-001", type: "operation", title: "更新账户", lifecycle: "active", spec_status: "ready", implementation_status: "in_progress", delivery_scope: "active", delivery_slice: "V1-core", authority: "docs/04-技术架构/当前版本/V1-接口契约.md", references: [], evidence: [] },
      { id: "V1-E-001", type: "entity", title: "Account", lifecycle: "active", spec_status: "ready", implementation_status: "in_progress", delivery_scope: "active", delivery_slice: "V1-core", authority: "docs/04-技术架构/当前版本/V1-接口契约.md", references: [], evidence: [] }
    ],
    relations: [
      { from: "V1-FR-001", to: "V1-OP-001", type: "defines_operation", authority: "docs/04-技术架构/当前版本/V1-接口契约.md" },
      { from: "V1-OP-001", to: "V1-E-001", type: "writes_entity", authority: "docs/04-技术架构/当前版本/V1-接口契约.md" }
    ],
    slices: [{ id: "V1-core", version: "V1", status: "in_progress", authority: "docs/03-功能规格/V1/01-账户.md", features: ["V1-FR-001"], depends_on: [], evidence: [] }]
  }, null, 2));
  const before = readFileSync(join(temp, "docs-policy.json"), "utf8");
  const run = (script, ...args) => {
    const result = spawnSync(process.execPath, [join(skillRoot, "scripts", script), "--dir", temp, ...args], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${script}: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  const impact = run("change-impact.mjs", "--slice", "V1-CS-001");
  if (impact.read_only !== true || impact.anchor.ids.indexOf("V1-CS-001") < 0 || !impact.anchor.operationIds.includes("updateAccount")) throw new Error("change impact output mismatch");
  if (impact.graph.mode !== "explicit+text" || !impact.graph.edges.some((edge) => edge.type === "defines_operation")) throw new Error("explicit relation graph missing");
  const featureImpact = run("change-impact.mjs", "--feature", "V1-FR-001");
  if (!featureImpact.anchor.files.length) throw new Error("feature impact did not select files");
  if (!featureImpact.graph.nodes.some((node) => node.id === "V1-OP-001") || !featureImpact.graph.nodes.some((node) => node.id === "V1-E-001")) throw new Error("feature graph propagation missing");
  const traceability = run("traceability-report.mjs");
  if (traceability.read_only !== true || traceability.coverage.slice_coverage !== 1) throw new Error("traceability report mismatch");
  const context = run("context-pack.mjs", "--feature", "V1-FR-001");
  if (!context.relations.some((relation) => relation.type === "defines_operation") || !context.facts.some((fact) => fact.id === "V1-E-001")) throw new Error("context relation propagation missing");
  const invalidRegistry = JSON.parse(readFileSync(join(temp, "docs-facts.json"), "utf8"));
  invalidRegistry.relations.push({ from: "V1-FR-001", to: "V1-MISSING", type: "depends_on" });
  writeFileSync(join(temp, "docs-facts.json"), JSON.stringify(invalidRegistry));
  const invalidTrace = run("traceability-report.mjs");
  if (!invalidTrace.errors.some((error) => error.code === "RELATION_ENDPOINT")) throw new Error("broken graph endpoint not reported");
  const calibration = run("policy-calibrate.mjs");
  if (calibration.read_only !== true || !Array.isArray(calibration.recommendations)) throw new Error("calibration output mismatch");
  if (readFileSync(join(temp, "docs-policy.json"), "utf8") !== before) throw new Error("policy was modified");

  writeFileSync(join(temp, "docs-policy.json"), JSON.stringify({ root: "specs", tier: "m" }));
  cpSync(docs, join(temp, "specs"), { recursive: true });
  const customImpact = run("change-impact.mjs", "--slice", "V1-CS-001");
  if (!customImpact.anchor.files.length) throw new Error("custom policy root was not used");
  if (!Array.isArray(customImpact.diagnostics.broken_links)) throw new Error("link diagnostics missing");
  const rootImpact = spawnSync(process.execPath, [join(skillRoot, "scripts", "change-impact.mjs"), "--dir", temp, "--docs-root", "docs", "--slice", "V1-CS-001"], { encoding: "utf8" });
  if (rootImpact.status !== 0 || !JSON.parse(rootImpact.stdout).anchor.files.length) throw new Error("docs-root override failed");

  const initTarget = join(temp, "project");
  const init = spawnSync(process.execPath, [join(skillRoot, "scripts", "init-docs.mjs"), "--target", initTarget, "--version", "V1", "--tier", "s"], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`init: ${init.stderr}`);
  for (const file of ["change-impact.mjs", "policy-calibrate.mjs"]) {
    if (!existsSync(join(initTarget, "scripts", file))) throw new Error(`missing generated ${file}`);
  }
  console.log("selftest-change-tools: PASS");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
