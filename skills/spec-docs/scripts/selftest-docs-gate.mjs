#!/usr/bin/env node
/**
 * docs-gate 自测：在临时目录构造一个完整证据链的最小项目，验证门禁通过与各类失败路径。
 *
 * 用法: node scripts/selftest-docs-gate.mjs
 * 退出码: 0 = 全部断言通过；1 = 有断言失败。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, "..");
const INIT = join(SKILL_ROOT, "scripts", "init-docs.mjs");

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const fixture = join(tmpdir(), `spec-docs-gate-selftest-${Date.now()}`);

const failures = [];
function assert(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function run(cmd, args, options = {}) {
  try {
    const stdout = execFileSync(cmd, args, { cwd: fixture, encoding: "utf8", ...options });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout || "", stderr: error.stderr || "" };
  }
}

const gate = (args = []) => {
  const result = run("node", ["scripts/docs-gate.mjs", "--json", ...args]);
  let parsed = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = null;
  }
  return { ...result, parsed, codes: (parsed?.errors || []).map((e) => e.code) };
};

const writeJson = (path, data) => writeFileSync(join(fixture, path), JSON.stringify(data, null, 2) + "\n", "utf8");

mkdirSync(fixture, { recursive: true });
console.log("[selftest] 无配置时由 docs-gate --init 初始化现有文档项目");
{
  const bootstrap = join(tmpdir(), `spec-docs-gate-bootstrap-${Date.now()}`);
  mkdirSync(bootstrap, { recursive: true });
  const initProject = run("node", [INIT, "--target", bootstrap, "--no-gate"]);
  const initGate = run("node", [join(SKILL_ROOT, "scripts", "docs-gate.mjs"), "--repo", bootstrap, "--init"]);
  assert("--init 从无 gate 配置创建文件", initProject.code === 0 && initGate.code === 0 && existsSync(join(bootstrap, "docs-gate.json")) && existsSync(join(bootstrap, "docs-evidence.json")));
  rmSync(bootstrap, { recursive: true, force: true });
}

/* ---------- 构造夹具 ---------- */

console.log(`[selftest] 夹具目录：${fixture}`);
mkdirSync(fixture, { recursive: true });
const init = run("node", [INIT, "--target", fixture, "--name", "Gate 自测", "--version", "V1", "--tier", "l"]);
if (init.code !== 0) {
  console.error(init.stderr || init.stdout);
  process.exit(1);
}

const featureDoc = "docs/03-功能规格/V1/01-领域/01-功能主文档.md";
mkdirSync(join(fixture, "tests"), { recursive: true });
writeFileSync(join(fixture, "tests/ac01.test.js"), "// ac01 fixture\nconsole.log('ok');\n", "utf8");
writeFileSync(join(fixture, "tests/perf-profile.json"), "{\"virtual_users\":10,\"duration_seconds\":30}\n", "utf8");
appendFileSync(
  join(fixture, featureDoc),
  "\n| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 初始资产状态 |\n| --- | --- | --- | --- | --- | --- |\n| AC01 | 正常 | Unit | `tests/ac01.test.js` | `node tests/ac01.test.js` | 本地通过 |\n",
  "utf8",
);

const gateConfigPath = join(fixture, "docs-gate.json");
const gateConfig = JSON.parse(readFileSync(gateConfigPath, "utf8"));
gateConfig.requiredReports = ["development", "e2e", "performance", "release"];
gateConfig.commandRegistry = ["node tests/ac01.test.js"];
writeJson("docs-gate.json", gateConfig);

/* 报告、manifest 与证据清单绑定被测源码提交；其自身可以在提交后追加。 */
run("git", ["init", "-q"]);
run("git", ["add", "-A"]);
run("git", ["-c", "user.email=selftest@example.com", "-c", "user.name=selftest", "commit", "-qm", "fixture"]);
const commit = run("git", ["rev-parse", "HEAD"]).stdout.trim();

/* 报告与 manifest */
const reports = "docs/05-测试与发布/端到端验收/报告";
mkdirSync(join(fixture, reports), { recursive: true });
const devReport = `${reports}/dev-20260922.json`;
const e2eReport = `${reports}/e2e-20260922.json`;
const perfReport = `${reports}/perf-20260922.json`;
const releaseReport = `${reports}/release-20260922.json`;

writeJson(devReport, {
  kind: "development",
  environment: "local",
  clean_checkout: true,
  steps: [{ command: "node tests/ac01.test.js", exit_code: 0 }],
  services: [{ name: "api", url: "http://127.0.0.1:3000", http_status: 200, ready: true }],
});
writeJson(e2eReport, {
  kind: "e2e",
  environment: "local-mock",
  command: "pnpm e2e",
  stats: { expected: 3, passed: 3, failed: 0, skipped: 0, unexpected: 0, flaky: 0 },
});
writeJson(perfReport, {
  kind: "performance",
  environment: "staging",
  profile: {
    id: "perf-v1",
    path: "tests/perf-profile.json",
    sha256: sha256(readFileSync(join(fixture, "tests/perf-profile.json"), "utf8")),
    approved_by: "tech-lead",
    approved_at: "2026-09-01T10:00:00+08:00",
  },
  scenarios: [{ id: "PERF03", metric: "p95_ms", unit: "ms", comparator: "lte", threshold: 100, measured: 87.2 }],
});
writeJson(releaseReport, {
  kind: "release",
  environment: "production-gate",
  commit,
  artifact: { id: "build-1", digest: "sha256:abc" },
  checks: { migration: true, backup: true, recovery: true, security: true, smoke: true, observation: true, rollback: true },
  approvals: { product: "pm", technical: "tech", release_manager: "rm" },
  e2e_report: e2eReport,
  performance_report: perfReport,
  known_risks: [],
});
function writeManifest(reportPath, kind, command, extraAssets = {}) {
  const reportName = reportPath.split("/").pop();
  const manifestPath = reportPath.replace(/\.json$/, "-manifest.json");
  writeJson(manifestPath, {
    run_id: `${kind}-20260922-100000-local-selftest`,
    environment: kind === "development" ? "local" : kind === "performance" ? "staging" : kind === "release" ? "production-gate" : "local-mock",
    code_version: commit,
    commit,
    command,
    working_directory: ".",
    exit_code: 0,
    stats: { expected: 3, passed: 3, failed: 0, skipped: 0, unexpected: 0, flaky: 0 },
    started_at: "2026-09-22T10:00:00+08:00",
    test_report: reportName,
    asset_sha256: {
      "tests/ac01.test.js": sha256(readFileSync(join(fixture, "tests/ac01.test.js"), "utf8")),
      ...extraAssets,
    },
    cleanup: "none needed",
    sanitization: "synthetic only",
    scope: `selftest ${kind}`,
    limitations: "fixture only",
    prior_attempts: [],
  });
}
writeManifest(devReport, "development", "node tests/ac01.test.js");
writeManifest(e2eReport, "e2e", "pnpm e2e");
writeManifest(perfReport, "performance", "pnpm perf", {
  "tests/perf-profile.json": sha256(readFileSync(join(fixture, "tests/perf-profile.json"), "utf8")),
});
writeManifest(releaseReport, "release", "release selftest");

const digestResult = run("node", ["scripts/docs-gate.mjs", "--authority-digest", "--json"]);
const digestOutput = JSON.parse(digestResult.stdout);
const digest = digestOutput.digest;
assert("有效权威文档摘要成功返回", digestResult.code === 0 && digestOutput.ok === true && /^sha256:[a-f0-9]{64}$/.test(digest));

const evidence = {
  activeVersion: "V1",
  commit,
  generatedAt: "2026-09-22T10:00:00+08:00",
  approvals: {
    proposal_id: "SELFTEST-1",
    authority_digest: digest,
    approved_by: { product: "pm", technical: "tech", release_manager: "rm" },
    approved_at: new Date().toISOString(),
  },
  reports: {
    development: { path: devReport, environment: "local" },
    e2e: { path: e2eReport, environment: "local-mock" },
    performance: { path: perfReport, environment: "staging" },
    release: { path: releaseReport, environment: "production-gate" },
  },
};
const evidencePath = join(fixture, "docs-evidence.json");
writeJson("docs-evidence.json", evidence);

/* ---------- 场景 ---------- */

console.log("\n[1] 完整证据链应通过");
{
  const result = gate();
  assert("门禁通过（exit 0）", result.code === 0, `codes=${result.codes.join(",")}`);
}

console.log("\n[2] 权威文档变化 → 审批失效");
{
  appendFileSync(join(fixture, "docs/02-产品与版本/当前版本/V1-版本总览.md"), "\n<!-- mutated -->\n", "utf8");
  const result = gate();
  assert("APPROVAL_STALE", result.codes.includes("APPROVAL_STALE"), result.codes.join(","));
  const original = readFileSync(join(fixture, "docs/02-产品与版本/当前版本/V1-版本总览.md"), "utf8");
  writeFileSync(
    join(fixture, "docs/02-产品与版本/当前版本/V1-版本总览.md"),
    original.replace("\n<!-- mutated -->\n", ""),
    "utf8",
  );
}

console.log("\n[3] 资产被改动 → manifest 摘要不匹配");
{
  appendFileSync(join(fixture, "tests/ac01.test.js"), "// changed\n", "utf8");
  const result = gate();
  assert("MANIFEST_ASSET_HASH", result.codes.includes("MANIFEST_ASSET_HASH"), result.codes.join(","));
  writeFileSync(join(fixture, "tests/ac01.test.js"), "// ac01 fixture\nconsole.log('ok');\n", "utf8");
}

console.log("\n[4] 性能断言不达标 → 门禁重算失败");
{
  const dataset = JSON.parse(readFileSync(join(fixture, perfReport), "utf8"));
  dataset.scenarios[0].measured = 120;
  writeJson(perfReport, dataset);
  const result = gate();
  assert("PERF_THRESHOLD", result.codes.includes("PERF_THRESHOLD"), result.codes.join(","));
  dataset.scenarios[0].measured = 87.2;
  writeJson(perfReport, dataset);
}

console.log("\n[5] 缺少审批角色 → 失败");
{
  const dataset = JSON.parse(readFileSync(evidencePath, "utf8"));
  delete dataset.approvals.approved_by.technical;
  writeJson("docs-evidence.json", dataset);
  const result = gate();
  assert("APPROVAL_ROLE_MISSING", result.codes.includes("APPROVAL_ROLE_MISSING"), result.codes.join(","));
  dataset.approvals.approved_by.technical = "tech";
  writeJson("docs-evidence.json", dataset);
}

console.log("\n[6] 证据含秘密 → 失败且不打印原值");
{
  const dataset = JSON.parse(readFileSync(join(fixture, devReport), "utf8"));
  dataset.note = "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345";
  writeJson(devReport, dataset);
  const result = gate();
  assert("SECRET_LEAK", result.codes.includes("SECRET_LEAK"), result.codes.join(","));
  assert("输出未回显秘密", !result.stdout.includes("abcdefghijklmnopqrstuvwxyz012345"));
  delete dataset.note;
  writeJson(devReport, dataset);
}

console.log("\n[7] 提交绑定不一致 → 失败");
{
  const dataset = JSON.parse(readFileSync(evidencePath, "utf8"));
  dataset.commit = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  writeJson("docs-evidence.json", dataset);
  const result = gate();
  assert("COMMIT_MISMATCH", result.codes.includes("COMMIT_MISMATCH"), result.codes.join(","));
  dataset.commit = commit;
  writeJson("docs-evidence.json", dataset);
}

console.log("\n[8] 发布模式：AC 未闭环 → 失败");
{
  const docPath = join(fixture, featureDoc);
  const original = readFileSync(docPath, "utf8");
  const config = JSON.parse(readFileSync(join(fixture, "docs-gate.json"), "utf8"));
  writeFileSync(docPath, original.replace("| 本地通过 |", "| 未执行 |"), "utf8");
  const normal = gate();
  assert("普通模式仅告警", normal.code === 0 || normal.codes.length === 0, normal.codes.join(","));
  const release = gate(["--release"]);
  assert("发布模式 AC_PENDING", release.codes.includes("AC_PENDING"), release.codes.join(","));
  config.release.enforce = true;
  writeJson("docs-gate.json", config);
  const enforced = gate();
  assert("release.enforce 常开发布门禁", enforced.code === 1 && enforced.codes.includes("AC_PENDING"), enforced.codes.join(","));
  config.release.enforce = false;
  writeJson("docs-gate.json", config);
  writeFileSync(docPath, original, "utf8");
}

console.log("\n[9] 发布模式：全部 E2E 跳过必须失败");
{
  const original = JSON.parse(readFileSync(join(fixture, e2eReport), "utf8"));
  writeJson(e2eReport, { ...original, stats: { expected: 3, passed: 0, failed: 0, skipped: 3, unexpected: 0, flaky: 0 } });
  const result = gate(["--release"]);
  assert("全部跳过不放行", result.code === 1 && result.codes.includes("E2E_NO_PASSED") && result.codes.includes("E2E_SKIPPED"), result.codes.join(","));
  writeJson(e2eReport, original);
}

console.log("\n[10] 短 commit 与缺审批时间必须失败");
{
  const dataset = JSON.parse(readFileSync(evidencePath, "utf8"));
  dataset.commit = commit.slice(0, 1);
  dataset.approvals.approved_at = "";
  writeJson("docs-evidence.json", dataset);
  const result = gate();
  assert("commit 长度校验", result.codes.includes("COMMIT_FORMAT"));
  assert("审批时间必填", result.codes.includes("APPROVAL_DATE_INVALID"));
  dataset.commit = commit;
  dataset.approvals.approved_at = new Date().toISOString();
  writeJson("docs-evidence.json", dataset);
}

console.log("\n[11] 缺 manifest 必须失败");
{
  const manifest = join(fixture, e2eReport.replace(/\.json$/, "-manifest.json"));
  const saved = readFileSync(manifest, "utf8");
  rmSync(manifest);
  const result = gate(["--release"]);
  assert("manifest 是必需项", result.codes.includes("MANIFEST_MISSING"));
  writeFileSync(manifest, saved, "utf8");
}

console.log("\n[12] 报告 stats 与 manifest 必须一致");
{
  const original = JSON.parse(readFileSync(join(fixture, e2eReport), "utf8"));
  writeJson(e2eReport, { ...original, stats: { ...original.stats, passed: 2, failed: 1 } });
  const result = gate(["--release"]);
  assert("统计不一致不放行", result.codes.includes("MANIFEST_STATS_MISMATCH"));
  writeJson(e2eReport, original);
}

console.log("\n[13] 被测源码提交后变化即使重算摘要也不得发布");
{
  const paths = [devReport, e2eReport, perfReport, releaseReport].map((path) => join(fixture, path.replace(/\.json$/, "-manifest.json")));
  const saved = paths.map((path) => readFileSync(path, "utf8"));
  const testPath = join(fixture, "tests/ac01.test.js");
  appendFileSync(testPath, "// changed after source commit\n", "utf8");
  for (const path of paths) {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.asset_sha256["tests/ac01.test.js"] = sha256(readFileSync(testPath, "utf8"));
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  }
  const result = gate(["--release"]);
  assert("重算 asset hash 不能掩盖源码晚改", result.codes.includes("SOURCE_CHANGED_SINCE_COMMIT"));
  writeFileSync(testPath, "// ac01 fixture\nconsole.log('ok');\n", "utf8");
  paths.forEach((path, index) => writeFileSync(path, saved[index], "utf8"));
}

console.log("\n[14] 已通过 AC 必须有资产、命令和状态");
{
  const docPath = join(fixture, featureDoc);
  const original = readFileSync(docPath, "utf8");
  writeFileSync(docPath, original.replace("| AC01 | 正常 | Unit | `tests/ac01.test.js` | `node tests/ac01.test.js` | 本地通过 |", "| AC01 | 正常 | Unit |  | `node tests/ac01.test.js` | 本地通过 |"), "utf8");
  assert("已通过 AC 缺目标资产失败", gate(["--release"]).codes.includes("AC_ASSET_MISSING"));
  writeFileSync(docPath, original.replace("| AC01 | 正常 | Unit | `tests/ac01.test.js` | `node tests/ac01.test.js` | 本地通过 |", "| AC01 | 正常 | Unit | `tests/ac01.test.js` |  | 本地通过 |"), "utf8");
  assert("已通过 AC 缺命令失败", gate(["--release"]).codes.includes("AC_COMMAND_MISSING"));
  writeFileSync(docPath, original.replace("| AC01 | 正常 | Unit | `tests/ac01.test.js` | `node tests/ac01.test.js` | 本地通过 |", "| AC01 | 正常 | Unit | `tests/ac01.test.js` | `node tests/ac01.test.js` |  |"), "utf8");
  assert("空 AC 状态在发布模式失败", gate(["--release"]).codes.includes("AC_PENDING"));
  writeFileSync(docPath, original, "utf8");
}

console.log("\n[15] 最终回归：恢复后应再次通过");
{
  const result = gate();
  assert("门禁通过（exit 0）", result.code === 0, `codes=${result.codes.join(",")}`);
}

console.log("\n[16] 权威摘要错误与证据路径越界必须失败");
{
  const configPath = join(fixture, "docs-gate.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const authorityFiles = config.authorityFiles;
  config.authorityFiles = ["docs/authority-does-not-exist.md"];
  writeJson("docs-gate.json", config);
  const invalidDigest = run("node", ["scripts/docs-gate.mjs", "--authority-digest", "--json"]);
  const invalidDigestOutput = JSON.parse(invalidDigest.stdout);
  assert("缺失权威文档摘要非零退出", invalidDigest.code === 1 && invalidDigestOutput.ok === false && invalidDigestOutput.errors.some((error) => error.code === "AUTHORITY_MISSING"));

  config.authorityFiles = authorityFiles;
  const outsideEvidence = join(tmpdir(), `spec-docs-outside-evidence-${Date.now()}.json`);
  const evidenceLink = join(fixture, "evidence-link.json");
  writeFileSync(outsideEvidence, "{}\n", "utf8");
  symlinkSync(outsideEvidence, evidenceLink);
  config.evidence = "evidence-link.json";
  writeJson("docs-gate.json", config);
  const escapedEvidence = run("node", ["scripts/docs-gate.mjs", "--json"]);
  assert("证据清单符号链接越界拒绝", escapedEvidence.code === 2 && escapedEvidence.stderr.includes("符号链接越界"));
  rmSync(evidenceLink, { force: true });
  rmSync(outsideEvidence, { force: true });
  config.evidence = "docs-evidence.json";
  writeJson("docs-gate.json", config);
}

/* ---------- 汇总 ---------- */

console.log(`\n[selftest] ${failures.length === 0 ? "全部通过" : `${failures.length} 项失败`}`);
if (failures.length > 0) {
  console.log(`  失败项：${failures.join(" / ")}`);
  process.exit(1);
}
if (!process.env.SPEC_DOCS_KEEP_FIXTURE) rmSync(fixture, { recursive: true, force: true });
console.log("[selftest] 夹具已清理（设 SPEC_DOCS_KEEP_FIXTURE=1 可保留）");
