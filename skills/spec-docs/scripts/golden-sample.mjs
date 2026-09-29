#!/usr/bin/env node
/** Read-only conformance checks against a real project documentation corpus. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(HERE, "..");
const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const sample = resolve(value("--sample", ""));
const json = argv.includes("--json");
if (!sample || !existsSync(sample)) {
  console.error("[golden-sample] 必须提供存在的 --sample <文档库目录>");
  process.exit(2);
}
function read(path) { return existsSync(path) ? readFileSync(path, "utf8") : ""; }
function check(id, condition, message) { return { id, pass: Boolean(condition), message }; }
const rootReadme = read(join(sample, "README.md"));
const matrix = read(join(sample, "03-功能规格/V1/00-V1需求追踪矩阵.md"));
const e2e = read(join(sample, "05-测试与发布/端到端验收/V1-端到端验收规范.md"));
const implementation = read(join(sample, "02-产品与版本/当前版本/V1-实现状态.md"));
const decisions = read(join(sample, "06-决策记录/V1-冻结决策.md"));
const audit = spawnSync(process.execPath, [join(skillRoot, "scripts/compatibility-audit.mjs"), "--repo", sample, "--json"], { encoding: "utf8" });
let auditReport = null;
try { auditReport = JSON.parse(audit.stdout); } catch {}
const contracts = spawnSync(process.execPath, [join(skillRoot, "scripts/contract-index.mjs"), "--dir", sample, "--json"], { encoding: "utf8" });
let contractReport = null;
try { contractReport = JSON.parse(contracts.stdout); } catch {}
const checks = [
  check("task-navigation", rootReadme.includes("按任务查找"), "根 README 应提供任务导航"),
  check("authority-table", rootReadme.includes("权威来源"), "根 README 应声明权威来源"),
  check("traceability-matrix", matrix.includes("V1-FR-001") && matrix.includes("V1-E2E-01"), "需求矩阵应连接功能和 E2E"),
  check("e2e-gwt", /^Given /m.test(e2e) && /^When /m.test(e2e) && /^Then /m.test(e2e), "E2E 规范应包含 Given/When/Then"),
  check("evidence-boundary", e2e.includes("local-mock") && e2e.includes("真实微信"), "E2E 应区分替身和真实依赖证据"),
  check("implementation-boundary", implementation.includes("不能作为真实") && implementation.includes("当前主要差距"), "实现状态应区分当前事实和遗留差距"),
  check("decision-history", decisions.includes("已被") && decisions.includes("状态"), "冻结决策应保留状态和取代关系"),
  check("compatibility-audit", audit.status === 0 && auditReport?.summary?.files >= 1 && auditReport?.read_only === true, "兼容审计应识别真实样例且保持只读"),
  check("contract-index", contracts.status === 0 && contractReport?.coverage?.operations > 0 && contractReport?.contracts?.some((entry) => entry.type === "http"), "契约索引应发现 OpenAPI operation"),
];
const result = { schema: "spec-docs/golden-sample/v1", read_only: true, sample, checks, compatibility: auditReport?.summary || null, contracts: contractReport?.coverage || null, ok: checks.every((item) => item.pass) };
if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`[golden-sample] ${result.ok ? "PASS" : "FAIL"}: ${sample}`);
  for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.id}: ${item.message}`);
}
process.exit(result.ok ? 0 : 1);
