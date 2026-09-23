#!/usr/bin/env node
/**
 * docs-gate：交付证据门禁。
 *
 * 与 check-docs 的分工：
 *   check-docs  → 结构自洽（目录、链接、编号、索引）
 *   docs-gate   → 交付就绪（AC→测试资产→命令→证据、审批与权威文档摘要绑定、当前提交绑定）
 *
 * 用法:
 *   node scripts/docs-gate.mjs                     # 校验当前证据是否足以交付
 *   node scripts/docs-gate.mjs --release           # 发布模式：未完成 AC 与待补项按错误处理
 *   node scripts/docs-gate.mjs --authority-digest  # 只读打印权威文档摘要（供审批引用）
 *   node scripts/docs-gate.mjs --init              # 生成 docs-gate.json 与 docs-evidence.json 模板
 *   node scripts/docs-gate.mjs --json --quiet
 *
 * 仓库根默认取脚本所在目录的上一级（脚本通常位于 <仓库根>/scripts/），可用 --repo 覆盖。
 * 退出码: 0 = 通过；1 = 未通过（缺证据、审批失效、断言不达标等）；2 = 配置/用法错误。
 *
 * 设计说明见 skill 的 references/docs-gate.md。本脚本不执行任何业务命令，只读文件与 git 状态。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/* ---------- CLI ---------- */

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(opt("--repo", scriptRoot));
const configPath = resolve(repoRoot, opt("--config", "docs-gate.json"));
const jsonOut = has("--json");
const quiet = has("--quiet");
let releaseMode = has("--release");

function usageError(msg) {
  console.error(`[docs-gate] ${msg}`);
  process.exit(2);
}

/* ---------- 结果收集 ---------- */

const results = [];
const add = (level, file, line, code, message) =>
  results.push({ level, file: file ? relative(repoRoot, file).split(sep).join("/") : "", line, code, message });

const rel = (abs) => relative(repoRoot, abs).split(sep).join("/");

function safeRepoLocation(path) {
  const abs = resolve(path);
  if (abs !== repoRoot && !abs.startsWith(repoRoot + sep)) return false;
  let existing = abs;
  while (!existsSync(existing) && existing !== dirname(existing)) existing = dirname(existing);
  try {
    const real = realpathSync(existing);
    const root = realpathSync(repoRoot);
    return real === root || real.startsWith(root + sep);
  } catch {
    return false;
  }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const abs = join(dir, entry);
    const info = lstatSync(abs);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const sha256Text = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const sha256File = (path) => (existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    add("error", path, 0, "JSON_PARSE", `无法解析 JSON：${error.message}`);
    return null;
  }
}

function insideRepo(path) {
  try {
    const abs = realpathSync(path);
    const root = realpathSync(repoRoot);
    return abs === root || abs.startsWith(root + sep);
  } catch {
    return false;
  }
}

/* ---------- 默认配置 ---------- */

const DEFAULT_SECRET_PATTERNS = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["bearer-token", /\bBearer\s+[A-Za-z0-9._-]{16,}/],
  ["api-key", /\bsk-[A-Za-z0-9]{16,}\b/],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ["signed-url", /https?:\/\/[^\s"']*[?&](signature|sig|token|access_key)=/i],
];

const DEFAULT_ALLOWED_ENVIRONMENTS = {
  development: ["local", "staging", "production"],
  e2e: ["local", "local-mock", "staging", "production-gate", "production"],
  performance: ["staging", "staging-gate", "production-gate", "production"],
  release: ["staging", "production-gate", "production"],
};

const DEFAULTS = {
  version: 1,
  policy: "docs-policy.json",
  evidence: "docs-evidence.json",
  authorityFiles: [],
  approvalMaxAgeDays: 30,
  requiredReports: ["development", "e2e", "release"],
  requiredApprovals: ["product", "technical", "release_manager"],
  allowedEnvironments: DEFAULT_ALLOWED_ENVIRONMENTS,
  commandRegistry: null,
  requireCommitBinding: true,
  requireManifest: true,
  release: { enforce: false, allowPendingACs: false },
  secretScan: { enabled: true, patterns: [], allowPaths: [] },
};

function loadConfig({ bootstrap = false } = {}) {
  if (!safeRepoLocation(configPath)) usageError("docs-gate 配置路径必须位于仓库内，且不能通过符号链接越界");
  if (!existsSync(configPath)) {
    if (bootstrap) {
      return {
        ...DEFAULTS,
        policy: opt("--policy", DEFAULTS.policy),
        evidence: "docs-evidence.json",
        release: { ...DEFAULTS.release },
        secretScan: { ...DEFAULTS.secretScan },
        allowedEnvironments: { ...DEFAULT_ALLOWED_ENVIRONMENTS },
      };
    }
    usageError(
      `找不到配置：${rel(configPath)}\n先运行 node scripts/docs-gate.mjs --init 生成模板，或通过 --config 指定。`,
    );
  }
  const raw = readJson(configPath);
  if (!raw) process.exit(2);
  if (typeof raw !== "object" || Array.isArray(raw)) usageError("docs-gate.json 根节点必须是 JSON 对象");
  if (raw.policy !== undefined && (typeof raw.policy !== "string" || !raw.policy.trim())) usageError("docs-gate.json policy 必须是非空路径字符串");
  if (raw.evidence !== undefined && (typeof raw.evidence !== "string" || !raw.evidence.trim())) usageError("docs-gate.json evidence 必须是非空路径字符串");
  if (!Array.isArray(raw.authorityFiles || DEFAULTS.authorityFiles)) usageError("docs-gate.json authorityFiles 必须是数组");
  if (!Array.isArray(raw.requiredReports || DEFAULTS.requiredReports)) usageError("docs-gate.json requiredReports 必须是数组");
  if (!Array.isArray(raw.requiredApprovals || DEFAULTS.requiredApprovals)) usageError("docs-gate.json requiredApprovals 必须是数组");
  if ((raw.requiredApprovals || DEFAULTS.requiredApprovals).some((role) => typeof role !== "string" || !role.trim())) usageError("docs-gate.json requiredApprovals 只能包含非空角色名");
  if ((raw.authorityFiles || []).some((file) => typeof file !== "string" || !file.trim())) usageError("docs-gate.json authorityFiles 只能包含非空路径字符串");
  if ((raw.requiredReports || DEFAULTS.requiredReports).some((kind) => !["development", "e2e", "performance", "release"].includes(kind))) usageError("docs-gate.json requiredReports 包含未知报告类型");
  if (!Number.isFinite(raw.approvalMaxAgeDays ?? DEFAULTS.approvalMaxAgeDays) || (raw.approvalMaxAgeDays ?? DEFAULTS.approvalMaxAgeDays) < 0) usageError("docs-gate.json approvalMaxAgeDays 必须是非负数字");
  if (raw.allowedEnvironments !== undefined && (typeof raw.allowedEnvironments !== "object" || raw.allowedEnvironments === null || Array.isArray(raw.allowedEnvironments) || Object.values(raw.allowedEnvironments).some((items) => !Array.isArray(items) || items.some((item) => typeof item !== "string")))) {
    usageError("docs-gate.json allowedEnvironments 必须是环境名到字符串数组的对象");
  }
  if (raw.commandRegistry !== undefined && raw.commandRegistry !== null && (!Array.isArray(raw.commandRegistry) || raw.commandRegistry.some((entry) => typeof entry !== "string" || !entry.trim()))) {
    usageError("docs-gate.json commandRegistry 必须是非空字符串数组或 null");
  }
  if (raw.secretScan !== undefined && (typeof raw.secretScan !== "object" || raw.secretScan === null || Array.isArray(raw.secretScan))) usageError("docs-gate.json secretScan 必须是对象");
  if (raw.secretScan?.patterns !== undefined && (!Array.isArray(raw.secretScan.patterns) || raw.secretScan.patterns.some((pattern) => !pattern || typeof pattern !== "object" || typeof pattern.pattern !== "string"))) {
    usageError("docs-gate.json secretScan.patterns 必须是带 pattern 字段的对象数组");
  }
  try {
    for (const pattern of raw.secretScan?.patterns || []) new RegExp(pattern.pattern);
  } catch (error) {
    usageError(`docs-gate.json secretScan 正则无效：${error.message}`);
  }
  if (raw.secretScan?.allowPaths !== undefined && (!Array.isArray(raw.secretScan.allowPaths) || raw.secretScan.allowPaths.some((path) => typeof path !== "string"))) {
    usageError("docs-gate.json secretScan.allowPaths 必须是字符串数组");
  }
  if (raw.release !== undefined && (typeof raw.release !== "object" || raw.release === null || Array.isArray(raw.release))) usageError("docs-gate.json release 必须是对象");
  if (raw.release?.enforce !== undefined && typeof raw.release.enforce !== "boolean") usageError("docs-gate.json release.enforce 必须是布尔值");
  if (raw.release?.allowPendingACs !== undefined && typeof raw.release.allowPendingACs !== "boolean") usageError("docs-gate.json release.allowPendingACs 必须是布尔值");
  return {
    ...DEFAULTS,
    ...raw,
    release: { ...DEFAULTS.release, ...(raw.release || {}) },
    secretScan: { ...DEFAULTS.secretScan, ...(raw.secretScan || {}) },
    allowedEnvironments: { ...DEFAULT_ALLOWED_ENVIRONMENTS, ...(raw.allowedEnvironments || {}) },
  };
}

function loadPolicy(config) {
  const path = resolve(repoRoot, config.policy);
  if (!safeRepoLocation(path)) usageError("docs-policy.json 必须位于仓库内，且不能通过符号链接越界");
  if (!existsSync(path)) usageError(`docs-gate 依赖结构策略：找不到 ${rel(path)}`);
  const raw = readJson(path);
  if (!raw) process.exit(2);
  return { path, data: raw };
}

/* ---------- 权威摘要与审批 ---------- */

function authorityDigest(config) {
  const entries = [];
  if (config.authorityFiles.length === 0) {
    add(releaseMode ? "error" : "warn", configPath, 0, "AUTHORITY_EMPTY", "未配置任何权威文档，审批摘要不能绑定范围与契约");
  }
  for (const file of config.authorityFiles) {
    const abs = resolve(repoRoot, file);
    if (!safeRepoLocation(abs)) {
      add("error", abs, 0, "AUTHORITY_OUTSIDE_REPO", "權威文档必须位于仓库内，且不能通过符号链接越界");
      continue;
    }
    const digest = sha256File(abs);
    if (digest === null) {
      add("error", abs, 0, "AUTHORITY_MISSING", "权威文档缺失，无法计算摘要");
      continue;
    }
    entries.push({ path: rel(abs), digest });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const canonical = ["spec-docs-gate/authority/v1", ...entries.map((e) => `${e.path}:${e.digest}`)].join("\n");
  return { digest: `sha256:${sha256Text(canonical)}`, entries };
}

function checkApproval(config, evidence) {
  const approval = evidence.approvals;
  if (!approval || typeof approval !== "object") {
    add("error", resolve(repoRoot, config.evidence), 0, "APPROVAL_MISSING", "证据清单缺少 approvals 审批记录");
    return;
  }
  const { digest } = authorityDigest(config);
  if (typeof approval.authority_digest !== "string" || !approval.authority_digest || approval.authority_digest.includes("<")) {
    add(
      "error",
      resolve(repoRoot, config.evidence),
      0,
      "APPROVAL_DIGEST_MISSING",
      "审批摘要未填写：运行 node scripts/docs-gate.mjs --authority-digest 后写入 approvals.authority_digest",
    );
  } else if (approval.authority_digest !== digest) {
    add(
      "error",
      resolve(repoRoot, config.evidence),
      0,
      "APPROVAL_STALE",
      `权威文档已变化，原审批失效（记录 ${approval.authority_digest.slice(0, 19)}…，当前 ${digest.slice(0, 19)}…）`,
    );
  }
  if (!approval.proposal_id) {
    add("error", resolve(repoRoot, config.evidence), 0, "APPROVAL_PROPOSAL_MISSING", "审批缺少 proposal_id");
  }
  const approvedBy = approval.approved_by || {};
  for (const role of config.requiredApprovals) {
    if (typeof approvedBy[role] !== "string" || !approvedBy[role].trim()) {
      add("error", resolve(repoRoot, config.evidence), 0, "APPROVAL_ROLE_MISSING", `缺少审批角色：${role}`);
    }
  }
  const approvedAt = Date.parse(approval.approved_at || "");
  if (!Number.isFinite(approvedAt) || approvedAt > Date.now()) {
    add("error", resolve(repoRoot, config.evidence), 0, "APPROVAL_DATE_INVALID", "审批时间缺失、格式错误或位于未来");
  } else if (config.approvalMaxAgeDays > 0) {
    const ageDays = (Date.now() - approvedAt) / 86400000;
    if (ageDays > config.approvalMaxAgeDays) {
      add(
        releaseMode ? "error" : "warn",
        resolve(repoRoot, config.evidence),
        0,
        "APPROVAL_EXPIRED",
        `审批已超过 ${config.approvalMaxAgeDays} 天（${Math.floor(ageDays)} 天前）`,
      );
    }
  }
}

/* ---------- 提交绑定 ---------- */

const GIT_STDIO = ["ignore", "pipe", "ignore"];

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", stdio: GIT_STDIO }).trim();
  } catch {
    return null;
  }
}

function changedPathsSince(commit) {
  try {
    const tracked = execFileSync("git", ["diff", "--name-only", "-z", commit], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: GIT_STDIO,
    });
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: GIT_STDIO,
    });
    return [...new Set(`${tracked}\0${untracked}`.split("\0").filter(Boolean))];
  } catch {
    return null;
  }
}

function checkCommitBinding(config, evidence) {
  if (config.requireCommitBinding === false) return;
  const head = currentCommit();
  if (!head) {
    add(releaseMode ? "error" : "warn", configPath, 0, "GIT_UNAVAILABLE", "不在 git 仓库或 git 不可用，无法验证提交绑定");
    return;
  }
  const declared = (evidence.commit || "").trim();
  if (!declared) {
    add("error", resolve(repoRoot, config.evidence), 0, "COMMIT_MISSING", "证据清单未声明 commit");
    return;
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(declared)) {
    add(
      "error",
      resolve(repoRoot, config.evidence),
      0,
      "COMMIT_FORMAT",
      "被测源码 commit 必须绑定完整 40 位或 64 位 commit SHA",
    );
    return;
  }
  let exists = false;
  let ancestor = false;
  try {
    execFileSync("git", ["cat-file", "-e", `${declared}^{commit}`], { cwd: repoRoot, stdio: GIT_STDIO });
    exists = true;
    execFileSync("git", ["merge-base", "--is-ancestor", declared, head], { cwd: repoRoot, stdio: GIT_STDIO });
    ancestor = true;
  } catch {
    // Invalid or unrelated source revisions are rejected below.
  }
  if (!exists || !ancestor) {
    add("error", resolve(repoRoot, config.evidence), 0, "COMMIT_MISMATCH", "被测源码 commit 必须存在于当前分支历史中");
    return;
  }

  const allowedEvidencePaths = new Set([resolve(repoRoot, config.evidence)]);
  for (const entry of Object.values(evidence.reports || {})) {
    if (!entry?.path) continue;
    const reportPath = isAbsolute(entry.path) ? resolve(entry.path) : resolve(repoRoot, entry.path);
    if (!insideRepo(reportPath)) continue;
    allowedEvidencePaths.add(reportPath);
    allowedEvidencePaths.add(reportPath.replace(/\.(json|txt|md)$/i, "") + "-manifest.json");
  }
  const changed = changedPathsSince(declared);
  if (changed === null) {
    add(releaseMode ? "error" : "warn", configPath, 0, "GIT_DIFF_UNAVAILABLE", "无法确认被测源码提交之后只有证据文件发生变化");
    return;
  }
  const sourceChanges = changed.filter((path) => !allowedEvidencePaths.has(resolve(repoRoot, path)));
  if (sourceChanges.length > 0) {
    add(
      releaseMode ? "error" : "warn",
      configPath,
      0,
      "SOURCE_CHANGED_SINCE_COMMIT",
      `被测 commit 之后存在非证据文件变化：${sourceChanges.slice(0, 5).join(", ")}`,
    );
  }
}

/* ---------- 报告校验 ---------- */

function num(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function compare(comparator, measured, threshold) {
  switch (comparator) {
    case "lte":
      return measured <= threshold;
    case "gte":
      return measured >= threshold;
    case "lt":
      return measured < threshold;
    case "gt":
      return measured > threshold;
    case "eq":
      return measured === threshold;
    default:
      return null;
  }
}

function checkDevelopmentReport(file, report) {
  const steps = Array.isArray(report.steps) ? report.steps : null;
  if (!steps || steps.length === 0) {
    add("error", file, 0, "DEV_STEPS_MISSING", "开发环境报告缺少 steps（命令与退出码）");
    return null;
  }
  let ok = true;
  if (report.clean_checkout !== true) {
    ok = false;
    add("error", file, 0, "DEV_DIRTY_CHECKOUT", "开发报告必须证明使用干净检出");
  }
  for (const step of steps) {
    if (!step || typeof step !== "object" || typeof step.command !== "string" || !step.command.trim() || step.exit_code !== 0) {
      ok = false;
      add("error", file, 0, "DEV_STEP_FAILED", `命令退出码非 0：${step.command || "<未记录命令>"}`);
    }
  }
  if (!Array.isArray(report.services) || report.services.length === 0) {
    ok = false;
    add("error", file, 0, "DEV_SERVICES_MISSING", "开发环境报告必须记录至少一个服务的就绪状态");
  }
  for (const service of report.services || []) {
    if (!service || typeof service !== "object") {
      ok = false;
      add("error", file, 0, "DEV_SERVICE_SHAPE", "服务状态项必须是对象");
      continue;
    }
    const status = service.http_status;
    if (!num(status) || status < 200 || status >= 400) {
      ok = false;
      add("error", file, 0, "DEV_SERVICE_FAILED", `服务 ${service.name || service.url || "?"} 状态异常：${status}`);
    }
    if (service.ready !== true) {
      ok = false;
      add("error", file, 0, "DEV_SERVICE_NOT_READY", `服务 ${service.name || service.url || "?"} 未就绪`);
    }
  }
  return ok;
}

function checkE2eReport(file, report) {
  const cases = Array.isArray(report.cases) ? report.cases : null;
  let ok = true;
  let skipped = 0;
  if (cases && cases.length > 0) {
    const seen = new Set();
    for (const item of cases) {
      if (!item || typeof item !== "object") {
        ok = false;
        add("error", file, 0, "E2E_CASE_SHAPE", "E2E 用例项必须是对象");
        continue;
      }
      const status = String(item.status || "").toLowerCase();
      if (typeof item.id !== "string" || !item.id.trim() || seen.has(item.id)) {
        ok = false;
        add("error", file, 0, "E2E_CASE_ID", `用例编号缺失或重复：${item.id || "?"}`);
      }
      seen.add(item.id);
      if (!["passed", "failed", "unexpected", "timedout", "interrupted", "skipped", "flaky"].includes(status)) {
        ok = false;
        add("error", file, 0, "E2E_CASE_STATUS", `用例 ${item.id || "?"} 状态无效：${item.status || "<缺失>"}`);
      } else if (["failed", "unexpected", "timedout", "interrupted", "flaky"].includes(status)) {
        ok = false;
        add("error", file, 0, "E2E_CASE_FAILED", `用例 ${item.id || "?"} 状态：${item.status}`);
      } else if (status === "skipped") {
        skipped += 1;
      }
    }
    if (ok && !cases.some((c) => String(c.status).toLowerCase() === "passed")) {
      ok = false;
      add("error", file, 0, "E2E_NO_PASSED", "E2E 报告没有任何通过用例");
    }
    if (report.stats && typeof report.stats === "object") {
      const outcomes = cases.reduce((counts, item) => {
        const status = String(item.status || "").toLowerCase();
        if (Object.hasOwn(counts, status)) counts[status] += 1;
        else if (["timedout", "interrupted"].includes(status)) counts.failed += 1;
        return counts;
      }, { passed: 0, failed: 0, skipped: 0, unexpected: 0, flaky: 0 });
      const stats = report.stats;
      if (stats.expected !== cases.length || Object.entries(outcomes).some(([key, count]) => stats[key] !== count)) {
        ok = false;
        add("error", file, 0, "E2E_CASE_STATS_MISMATCH", "E2E cases 与 stats 逐项统计不一致");
      }
    }
  } else if (report.stats && typeof report.stats === "object") {
    const stats = report.stats;
    const counts = [stats.expected, stats.passed, stats.failed, stats.skipped, stats.unexpected, stats.flaky];
    if (counts.some((value) => !Number.isInteger(value) || value < 0) || stats.expected <= 0) {
      ok = false;
      add("error", file, 0, "E2E_STATS_INVALID", "E2E 报告必须提供非负整数 expected/passed/failed/skipped/unexpected/flaky 统计，且 expected 大于 0");
    } else if (stats.expected !== stats.passed + stats.failed + stats.skipped + stats.unexpected + stats.flaky) {
      ok = false;
      add("error", file, 0, "E2E_STATS_MISMATCH", "E2E 各状态数量之和必须等于 expected");
    }
    if (stats.unexpected > 0) {
      ok = false;
      add("error", file, 0, "E2E_UNEXPECTED", `存在未预期失败：${stats.unexpected}`);
    }
    if (stats.failed > 0) {
      ok = false;
      add("error", file, 0, "E2E_FAILED", `存在失败用例：${stats.failed}`);
    }
    if (stats.flaky > 0) {
      ok = false;
      add("error", file, 0, "E2E_FLAKY", `存在 flaky 用例：${stats.flaky}`);
    }
    if (stats.skipped > 0) skipped = stats.skipped;
    if (stats.passed === 0) {
      ok = false;
      add("error", file, 0, "E2E_NO_PASSED", "E2E 报告没有任何通过用例");
    }
  } else {
    add("error", file, 0, "E2E_SHAPE", "E2E 报告缺少 cases 或 stats");
    return null;
  }
  if (skipped > 0) {
    add(releaseMode ? "error" : "warn", file, 0, "E2E_SKIPPED", `存在跳过用例 ${skipped} 条，不能计入通过`);
    if (releaseMode) ok = false;
  }
  return ok;
}

function checkPerformanceReport(file, report, config) {
  const profile = report.profile;
  if (!profile || !profile.id || !profile.path || !profile.sha256 || !profile.approved_by || !profile.approved_at) {
    add("error", file, 0, "PERF_PROFILE", "性能报告缺少已批准的负载配置（id/path/sha256/approved_by/approved_at）");
    return null;
  }
  const profilePath = resolve(repoRoot, profile.path);
  if (!insideRepo(profilePath)) {
    add("error", file, 0, "PERF_PROFILE_PATH", "负载配置必须位于仓库内，且不能通过符号链接越界");
    return null;
  }
  const actualProfileHash = sha256File(profilePath);
  if (!actualProfileHash || actualProfileHash !== profile.sha256) {
    add("error", file, 0, "PERF_PROFILE_HASH", "负载配置摘要缺失或与文件内容不一致");
    return null;
  }
  const approvedAt = Date.parse(profile.approved_at);
  if (!Number.isFinite(approvedAt) || approvedAt > Date.now() || typeof profile.approved_by !== "string") {
    add("error", file, 0, "PERF_PROFILE_APPROVAL", "负载配置审批人或审批时间无效");
    return null;
  }
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  if (scenarios.length === 0) {
    add("error", file, 0, "PERF_SCENARIOS", "性能报告缺少 scenarios");
    return null;
  }
  let ok = true;
  for (const scenario of scenarios) {
    if (!scenario || typeof scenario !== "object") {
      ok = false;
      add("error", file, 0, "PERF_SCENARIO_SHAPE", "性能场景必须是对象");
      continue;
    }
    const { metric, comparator, threshold, measured, unit } = scenario;
    if (!metric || !comparator || !num(threshold) || !num(measured)) {
      ok = false;
      add("error", file, 0, "PERF_FIELD", `场景 ${scenario.id || "?"} 缺少 metric/comparator/threshold/measured`);
      continue;
    }
    const passed = compare(comparator, measured, threshold);
    if (passed === null) {
      ok = false;
      add("error", file, 0, "PERF_COMPARATOR", `场景 ${scenario.id || "?"} 比较符不支持：${comparator}`);
    } else if (!passed) {
      ok = false;
      add(
        "error",
        file,
        0,
        "PERF_THRESHOLD",
        `场景 ${scenario.id || "?"} 未达标：${metric}=${measured}${unit || ""} 不满足 ${comparator} ${threshold}`,
      );
    }
  }
  return ok;
}

function checkReleaseReport(file, report, config, evidence) {
  let ok = true;
  if (report.commit !== evidence.commit) {
    ok = false;
    add("error", file, 0, "RELEASE_COMMIT", "发布报告 commit 必须与当前证据清单完全一致");
  }
  const requiredChecks = ["migration", "backup", "recovery", "security", "smoke", "observation", "rollback"];
  for (const key of requiredChecks) {
    if (report.checks?.[key] !== true) {
      ok = false;
      add("error", file, 0, "RELEASE_CHECK_MISSING", `发布检查项未通过或缺失：${key}`);
    }
  }
  if (!report.artifact || (!report.artifact.id && !report.artifact.digest)) {
    ok = false;
    add("error", file, 0, "RELEASE_ARTIFACT", "发布报告缺少制品标识（artifact.id 或 digest）");
  }
  const approvals = report.approvals || {};
  for (const role of config.requiredApprovals) {
    if (typeof approvals[role] !== "string" || !approvals[role].trim()) {
      ok = false;
      add("error", file, 0, "RELEASE_APPROVAL_MISSING", `发布报告缺少审批角色：${role}`);
    }
  }
  if (!Array.isArray(report.known_risks)) {
    ok = false;
    add("error", file, 0, "RELEASE_RISKS", "发布报告缺少 known_risks 数组（可以为空）");
  }
  for (const [kind, key] of [["e2e", "e2e_report"], ["performance", "performance_report"]]) {
    const declared = evidence.reports?.[kind]?.path;
    const bound = report[key];
    const required = kind === "e2e" || config.requiredReports.includes(kind);
    if (required && (!declared || !bound)) {
      ok = false;
      add("error", file, 0, "RELEASE_BINDING_MISSING", `发布报告必须绑定当前 ${kind} 报告`);
    } else if (declared && bound && resolve(repoRoot, bound) !== resolve(repoRoot, declared)) {
      ok = false;
      add("error", file, 0, "RELEASE_BINDING", `发布报告 ${key} 与当前证据清单不一致：${bound}`);
    }
  }
  return ok;
}

function checkReport(kind, config, evidence) {
  const entry = evidence.reports?.[kind];
  if (!entry || !entry.path) {
    add(
      "error",
      resolve(repoRoot, config.evidence),
      0,
      "REPORT_MISSING",
      `证据清单缺少 ${kind} 报告（${config.requiredReports.join(" / ")} 为必需）`,
    );
    return;
  }
  const file = isAbsolute(entry.path) ? entry.path : resolve(repoRoot, entry.path);
  if (!insideRepo(file)) {
    add("error", file, 0, "REPORT_OUTSIDE_REPO", "报告路径必须位于仓库内");
    return;
  }
  if (!existsSync(file)) {
    add("error", file, 0, "REPORT_NOT_FOUND", "报告文件不存在");
    return;
  }
  const allowed = config.allowedEnvironments[kind] || [];
  if (!entry.environment || !allowed.includes(entry.environment)) {
    add("error", file, 0, "ENV_NOT_ALLOWED", `${kind} 不接受环境：${entry.environment}（允许：${allowed.join(" / ")}）`);
  }
  const report = readJson(file);
  if (!report) return;
  if (report.kind !== kind) {
    add("error", file, 0, "REPORT_KIND", `报告 kind 与清单不一致：${report.kind} ≠ ${kind}`);
  }
  if (!report.environment || report.environment !== entry.environment) {
    add("error", file, 0, "ENV_MISMATCH", `报告环境与清单不一致：${report.environment} ≠ ${entry.environment}`);
  }
  let result = null;
  if (kind === "development") result = checkDevelopmentReport(file, report);
  else if (kind === "e2e") result = checkE2eReport(file, report);
  else if (kind === "performance") result = checkPerformanceReport(file, report, config);
  else if (kind === "release") result = checkReleaseReport(file, report, config, evidence);
  if (result === false && releaseMode) {
    add("error", file, 0, "REPORT_FAILED", `${kind} 报告重新计算结果为未通过`);
  }
  checkManifest(file, config, evidence, kind, report);
  scanSecrets(file, config);
}

/* ---------- manifest 与秘密扫描 ---------- */

function checkManifest(reportFile, config, evidence, kind, report) {
  const manifestPath = reportFile.replace(/\.(json|txt|md)$/i, "") + "-manifest.json";
  if (!existsSync(manifestPath)) {
    if (config.requireManifest !== false) {
      add("error", reportFile, 0, "MANIFEST_MISSING", "报告缺少配对 manifest");
    }
    return;
  }
  if (!insideRepo(manifestPath)) {
    add("error", manifestPath, 0, "MANIFEST_OUTSIDE_REPO", "manifest 必须位于仓库内，且不能通过符号链接越界");
    return;
  }
  const manifest = readJson(manifestPath);
  if (!manifest) return;
  for (const field of ["run_id", "environment", "code_version", "commit", "command", "working_directory", "exit_code", "stats", "started_at", "test_report", "asset_sha256", "cleanup", "sanitization", "scope", "limitations", "prior_attempts"]) {
    if (manifest[field] === undefined) {
      add("error", manifestPath, 0, "MANIFEST_FIELD", `manifest 缺少字段：${field}`);
    }
  }
  for (const field of ["run_id", "environment", "code_version", "commit", "command", "working_directory", "test_report", "cleanup", "sanitization", "scope", "limitations"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim() || manifest[field].includes("<")) {
      add("error", manifestPath, 0, "MANIFEST_VALUE", `manifest 字段无效或仍是占位符：${field}`);
    }
  }
  if (manifest.exit_code !== 0) {
    add("error", manifestPath, 0, "MANIFEST_EXIT", `批次退出码非 0：${manifest.exit_code}`);
  }
  const declaredCommit = (evidence.commit || "").trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(manifest.commit || "") || manifest.commit.toLowerCase() !== declaredCommit.toLowerCase()) {
    add("error", manifestPath, 0, "MANIFEST_COMMIT", "manifest commit 必须与证据清单中的完整 commit 一致");
  }
  if (!manifest.code_version || manifest.environment !== report.environment || manifest.environment !== evidence.reports?.[kind]?.environment) {
    add("error", manifestPath, 0, "MANIFEST_BINDING", "manifest 缺少代码版本，或环境与报告/证据清单不一致");
  }
  if (!manifest.stats || typeof manifest.stats !== "object" || Array.isArray(manifest.stats)) {
    add("error", manifestPath, 0, "MANIFEST_STATS", "manifest.stats 必须是对象");
  } else {
    const reportStats = report.stats || (Array.isArray(report.cases) ? report.cases.reduce((counts, item) => {
      const status = String(item.status || "").toLowerCase();
      if (status === "passed" || status === "skipped" || status === "unexpected" || status === "flaky") counts[status] += 1;
      else if (["failed", "timedout", "interrupted"].includes(status)) counts.failed += 1;
      return counts;
    }, { expected: report.cases.length, passed: 0, failed: 0, skipped: 0, unexpected: 0, flaky: 0 }) : null);
    if (reportStats) {
      const expected = Object.entries(reportStats).sort(([a], [b]) => a.localeCompare(b));
      const actual = Object.entries(manifest.stats).sort(([a], [b]) => a.localeCompare(b));
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        add("error", manifestPath, 0, "MANIFEST_STATS_MISMATCH", "manifest 统计必须与报告统计一致");
      }
    }
  }
  if (manifest.test_report !== reportFile.split(sep).pop()) {
    add("error", manifestPath, 0, "MANIFEST_REPORT", "manifest.test_report 必须指向配对报告文件");
  }
  const startedAt = Date.parse(manifest.started_at || "");
  if (!Number.isFinite(startedAt) || startedAt > Date.now()) {
    add("error", manifestPath, 0, "MANIFEST_DATE", "manifest.started_at 缺失、格式错误或位于未来");
  }
  if (!manifest.asset_sha256 || typeof manifest.asset_sha256 !== "object" || Array.isArray(manifest.asset_sha256) || Object.keys(manifest.asset_sha256).length === 0) {
    add("error", manifestPath, 0, "MANIFEST_ASSETS", "manifest 必须绑定至少一个源码或测试资产摘要");
  }
  for (const [asset, expected] of Object.entries(manifest.asset_sha256 || {})) {
    const abs = resolve(repoRoot, asset);
    if (!insideRepo(abs)) {
      add("error", manifestPath, 0, "MANIFEST_ASSET_OUTSIDE", `asset 路径越界：${asset}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/i.test(expected)) {
      add("error", manifestPath, 0, "MANIFEST_ASSET_HASH_FORMAT", `asset 摘要格式无效：${asset}`);
      continue;
    }
    const actual = sha256File(abs);
    if (actual === null) {
      add("error", manifestPath, 0, "MANIFEST_ASSET_MISSING", `asset 不存在：${asset}`);
    } else if (actual !== expected) {
      add("error", manifestPath, 0, "MANIFEST_ASSET_HASH", `asset 摘要不匹配：${asset}`);
    }
  }
  scanSecrets(manifestPath, config);
}

function scanSecrets(file, config) {
  if (config.secretScan.enabled === false) return;
  const relPath = rel(file);
  if ((config.secretScan.allowPaths || []).some((p) => relPath === p || relPath.startsWith(`${p.replace(/\/$/, "")}/`))) return;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const patterns = [
    ...DEFAULT_SECRET_PATTERNS,
    ...(config.secretScan.patterns || []).map((p) => [`custom:${p.name || p}`, new RegExp(p.pattern || p)]),
  ];
  lines.forEach((line, index) => {
    for (const [name, re] of patterns) {
      re.lastIndex = 0;
      if (re.test(line)) {
        add("error", file, index + 1, "SECRET_LEAK", `证据疑似包含秘密（${name}），不打印原值`);
        break;
      }
    }
  });
}

/* ---------- AC 映射校验 ---------- */

function parseTables(text) {
  const tables = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  lines.forEach((line, index) => {
    const cells = line.trim().startsWith("|") ? line.split("|").slice(1, -1).map((c) => c.trim()) : null;
    if (cells) {
      if (!current) current = { header: cells, rows: [], startLine: index + 1 };
      else if (cells.every((c) => /^:?-{2,}:?$/.test(c))) {
        // separator row
      } else current.rows.push({ cells, line: index + 1 });
    } else if (current) {
      tables.push(current);
      current = null;
    }
  });
  if (current) tables.push(current);
  return tables;
}

function backticked(text) {
  return [...String(text || "").matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
}

function looksLikePath(value) {
  return /[/\\]/.test(value) && !/[<>{}]/.test(value) && !/\s/.test(value) && value.length > 3;
}

function claimedPassed(status) {
  return (
    /(通过|Passed)/i.test(status) &&
    !/(未通过|不通过|失败|未执行|未创建|待补|规划中|待本次验证|Pending)/i.test(status)
  );
}

function pending(status) {
  return /(未执行|未创建|待补|规划中|Pending|待本次验证)/i.test(status);
}

function checkAcMappings(policy, config) {
  const spec = policy.data.featureDoc;
  if (!spec?.dir) return;
  const docsRoot = resolve(repoRoot, policy.data.root || "docs");
  const dir = join(docsRoot, spec.dir);
  const fileRe = new RegExp(spec.filePattern);
  const excludeRe = spec.excludePattern ? new RegExp(spec.excludePattern) : null;
  const registry = Array.isArray(config.commandRegistry) ? config.commandRegistry : null;
  let commandCheckDisabled = false;

  for (const file of walk(dir)) {
    const name = file.split(sep).pop();
    if (!fileRe.test(name) || (excludeRe && excludeRe.test(name))) continue;
    const text = readFileSync(file, "utf8");
    for (const table of parseTables(text)) {
      const header = table.header;
      const acIdx = header.findIndex((h) => /\bAC\b|AC 范围|用例/.test(h) || /^AC/i.test(h));
      const statusIdx = header.map((h, i) => (h.includes("状态") ? i : -1)).filter((i) => i >= 0).pop();
      if (acIdx === -1 || statusIdx === undefined) continue;
      const assetIdxs = header.map((h, i) => (/(资产|文件)/.test(h) ? i : -1)).filter((i) => i >= 0);
      const cmdIdxs = header.map((h, i) => (/命令/.test(h) ? i : -1)).filter((i) => i >= 0);

      for (const row of table.rows) {
        const ac = row.cells[acIdx] || "";
        if (!/AC\d/.test(ac)) continue;
        const status = row.cells[statusIdx] || "";
        const assets = new Set();
        for (const idx of assetIdxs) {
          for (const token of backticked(row.cells[idx] || "")) if (looksLikePath(token)) assets.add(token);
        }
        const commands = cmdIdxs.flatMap((idx) => backticked(row.cells[idx] || ""));

        if (claimedPassed(status)) {
          if (assets.size === 0) {
            add("error", file, row.line, "AC_ASSET_MISSING", `AC 声称已通过但没有登记目标测试资产：${ac}`);
          }
          for (const asset of assets) {
            const abs = resolve(repoRoot, asset);
            if (!insideRepo(abs)) {
              add("error", file, row.line, "AC_ASSET_OUTSIDE", `AC 目标资产必须位于仓库内：${asset}`);
            } else if (!existsSync(abs)) {
              add("error", file, row.line, "AC_ASSET_MISSING", `AC 声称已通过但目标资产不存在：${asset}`);
            }
          }
          if (commands.length === 0) {
            add("error", file, row.line, "AC_COMMAND_MISSING", `AC 声称已通过但没有登记实际验证命令：${ac}`);
          }
        }
        if (!status.trim() || pending(status)) {
          if (releaseMode && config.release?.allowPendingACs !== true) {
            add("error", file, row.line, "AC_PENDING", `发布模式要求 AC 全部闭环，当前状态：${status || "空"}`);
          } else {
            add("warn", file, row.line, "AC_PENDING", `AC 尚未闭环：${ac}（${status || "空"}）`);
          }
        }
        if (commands.length > 0) {
          if (!registry) commandCheckDisabled = true;
          else {
            for (const command of commands) {
              if (/[<>{}]/.test(command)) continue;
              if (!registry.some((entry) => command === entry || command.startsWith(`${entry} `))) {
                add(releaseMode && claimedPassed(status) ? "error" : "warn", file, row.line, "AC_COMMAND_UNREGISTERED", `命令未在 docs-gate.json commandRegistry 登记：${command}`);
              }
            }
          }
        }
      }
    }
  }
  if (commandCheckDisabled) {
    add(releaseMode ? "error" : "warn", configPath, 0, "COMMAND_REGISTRY_OFF", "未配置 commandRegistry，跳过命令登记校验");
  }
}

/* ---------- --scaffold-report ---------- */

function scaffoldReport(kindRaw, policy) {
  const alias = {
    dev: "development",
    development: "development",
    e2e: "e2e",
    perf: "performance",
    performance: "performance",
    release: "release",
  };
  const kind = alias[kindRaw];
  if (!kind) usageError(`--scaffold-report 仅支持 dev|e2e|perf|release，收到：${kindRaw}`);
  const policyRoot = policy.data.root || "docs";
  const outDir = opt("--out", join(policyRoot, "05-测试与发布", "端到端验收", "报告"));
  const resolvedOutDir = resolve(repoRoot, outDir);
  if (!safeRepoLocation(resolvedOutDir)) {
    usageError("--out 必须指向仓库内目录");
  }
  const defaultEnvironment = {
    development: "local",
    e2e: "local-mock",
    performance: "staging",
    release: "production-gate",
  }[kind];
  const environment = opt("--environment", defaultEnvironment);

  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const reportName = `${kind}-${stamp}.json`;
  const reportPath = join(repoRoot, outDir, reportName);
  const manifestPath = join(repoRoot, outDir, `${kind}-${stamp}-manifest.json`);
  if (!safeRepoLocation(reportPath) || !safeRepoLocation(manifestPath)) usageError("报告输出路径不能通过符号链接越界");
  const commit = currentCommit();
  const nowIso = new Date().toISOString();

  const bodies = {
    development: {
      kind,
      environment,
      clean_checkout: null,
      steps: [{ command: "<实际执行的命令>", exit_code: null }],
      services: [{ name: "<服务名>", url: "<地址>", http_status: null, ready: null }],
    },
    e2e: {
      kind,
      environment,
      command: "<规范命令>",
      cases: [{ id: "<用例编号>", status: "<passed|failed|skipped>" }],
      stats: { expected: null, passed: null, failed: null, skipped: null, unexpected: null, flaky: null },
    },
    performance: {
      kind,
      environment,
      profile: { id: "<已批准的负载配置 ID>", path: "<仓库内配置文件>", sha256: "<配置摘要>", approved_by: "<批准人>", approved_at: "<时间>" },
      scenarios: [
        { id: "<PERF 编号>", metric: "<指标>", unit: "<单位>", comparator: "lte", threshold: null, measured: null },
      ],
    },
    release: {
      kind,
      environment,
      commit: commit || "<commit>",
      artifact: { id: "<构建号>", digest: "<制品摘要>" },
      checks: {
        migration: false,
        backup: false,
        recovery: false,
        security: false,
        smoke: false,
        observation: false,
        rollback: false,
      },
      approvals: { product: "", technical: "", release_manager: "" },
      e2e_report: "",
      performance_report: "",
      known_risks: [],
    },
  };
  const manifest = {
    run_id: `${kind}-${stamp}`,
    environment,
    code_version: commit || "<commit 或构建标识>",
    command: "<批次命令>",
    working_directory: ".",
    exit_code: null,
    stats: { expected: null, passed: null, failed: null, skipped: null, unexpected: null, flaky: null },
    started_at: nowIso,
    test_report: reportName,
    asset_sha256: { "<被测源码或脚本路径>": "<sha256>" },
    cleanup: "",
    sanitization: "",
    scope: "",
    limitations: "",
    prior_attempts: [],
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  const writes = [
    [reportPath, bodies[kind]],
    [manifestPath, manifest],
  ];
  if (writes.some(([path]) => !safeRepoLocation(path))) usageError("配置或证据输出路径不能通过符号链接越界");
  if (writes.some(([path]) => existsSync(path))) {
    usageError("只追加证据制品，不允许覆盖已有报告或 manifest");
  }
  for (const [path, data] of writes) {
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`[docs-gate] 已生成模板：${rel(path)}`);
  }
  console.log("[docs-gate] 模板不含任何通过结论；填写实际执行结果与 asset_sha256 后才可作为证据。");
  console.log("[docs-gate] 门禁会重算退出码/统计/性能比较，手填“通过”不生效。");
}

/* ---------- --init ---------- */

function initTemplates(config) {
  let policy = null;
  try {
    policy = JSON.parse(readFileSync(resolve(repoRoot, config.policy), "utf8"));
  } catch {
    usageError(`--init 需要有效的 ${config.policy}；先运行 init-docs.mjs 建立文档策略。`);
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) usageError(`--init 需要有效的 ${config.policy} JSON 对象`);
  const version = policy?.activeVersion || "V1";
  const docsRoot = policy?.root || "docs";
  const candidateAuthority = [
    `${docsRoot}/02-产品与版本/当前版本/${version}-版本总览.md`,
    `${docsRoot}/02-产品与版本/当前版本/${version}-实现状态.md`,
    `${docsRoot}/04-技术架构/当前版本/${version}-接口契约.md`,
    `${docsRoot}/04-技术架构/当前版本/${version}-openapi.yaml`,
    `${docsRoot}/04-技术架构/当前版本/${version}-数据模型.md`,
    `${docsRoot}/06-决策记录/${version}-冻结决策.md`,
    `${docsRoot}/05-测试与发布/端到端验收/${version}-端到端验收规范.md`,
  ].filter((p) => existsSync(resolve(repoRoot, p)));
  if (candidateAuthority.length === 0) usageError("--init 未找到可绑定的权威文档；先填充版本总览、接口或决策文档后再启用 docs-gate。");

  const configTemplate = {
    version: 1,
    activeVersion: version,
    policy: config.policy,
    evidence: config.evidence,
    authorityFiles: candidateAuthority,
    approvalMaxAgeDays: 30,
    requiredReports: ["development", "e2e", "release"],
    requiredApprovals: ["product", "technical", "release_manager"],
    commandRegistry: ["<在此登记可执行的测试/构建命令前缀，例如 make test>"],
    requireCommitBinding: true,
    requireManifest: true,
    release: { enforce: false, allowPendingACs: false },
    secretScan: { enabled: true },
  };
  const evidenceTemplate = {
    activeVersion: version,
    commit: "<git commit 或构建标识>",
    generatedAt: new Date().toISOString(),
    approvals: {
      proposal_id: "<提案或变更单编号>",
      authority_digest: "<运行 node scripts/docs-gate.mjs --authority-digest 获取>",
      approved_by: { product: "", technical: "", release_manager: "" },
      approved_at: "<带时区时间>",
    },
    reports: {
      development: { path: "<仓库内报告路径>", environment: "local" },
      e2e: { path: "<仓库内报告路径>", environment: "local-mock" },
      release: { path: "<仓库内报告路径>", environment: "production-gate" },
    },
  };

  const writes = [
    [configPath, configTemplate],
    [resolve(repoRoot, config.evidence), evidenceTemplate],
  ];
  for (const [path, data] of writes) {
    if (existsSync(path) && !has("--force")) {
      console.error(`[docs-gate] 已存在，跳过：${rel(path)}（如需覆盖加 --force）`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
    console.log(`[docs-gate] 已写入：${rel(path)}`);
  }
  console.log("[docs-gate] 下一步：填写权威文档与报告路径 → 计算摘要 → 完成审批 → 运行 node scripts/docs-gate.mjs");
}

/* ---------- 主流程 ---------- */

const config = loadConfig({ bootstrap: has("--init") });
releaseMode = releaseMode || config.release.enforce === true;

if (has("--init")) {
  initTemplates(config);
  process.exit(0);
}

const policy = loadPolicy(config);

if (opt("--scaffold-report", null)) {
  scaffoldReport(opt("--scaffold-report", null), policy);
  process.exit(0);
}

if (has("--authority-digest")) {
  const { digest, entries } = authorityDigest(config);
  const errors = results.filter((result) => result.level === "error");
  const warnings = results.filter((result) => result.level === "warn");
  if (jsonOut) console.log(JSON.stringify({ ok: errors.length === 0, digest, entries, errors, warnings }, null, 2));
  else {
    console.log(digest);
    for (const entry of entries) console.log(`  ${entry.path}  ${entry.digest.slice(0, 12)}…`);
    for (const result of results) console.error(`[${result.level}] ${result.code}: ${result.message}`);
  }
  process.exit(errors.length > 0 ? 1 : 0);
}

const evidencePath = resolve(repoRoot, config.evidence);
if (!safeRepoLocation(evidencePath)) usageError("docs-evidence.json 路径必须位于仓库内，且不能通过符号链接越界");
if (!existsSync(evidencePath)) {
  add("error", evidencePath, 0, "EVIDENCE_MISSING", "找不到证据清单 docs-evidence.json");
} else {
  const evidence = readJson(evidencePath);
  if (evidence && (typeof evidence !== "object" || Array.isArray(evidence))) {
    add("error", evidencePath, 0, "EVIDENCE_SHAPE", "docs-evidence.json 根节点必须是 JSON 对象");
  } else if (evidence) {
    checkApproval(config, evidence);
    checkCommitBinding(config, evidence);
    for (const kind of config.requiredReports) checkReport(kind, config, evidence);
    for (const kind of Object.keys(evidence.reports || {})) {
      if (!config.requiredReports.includes(kind)) checkReport(kind, config, evidence);
    }
  }
}

checkAcMappings(policy, config);

const errors = results.filter((r) => r.level === "error");
const warnings = results.filter((r) => r.level === "warn");
results.sort(
  (a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1) || a.file.localeCompare(b.file) || a.line - b.line,
);

if (jsonOut) {
  console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings }, null, 2));
} else if (!quiet) {
  for (const r of results) {
    const tag = r.level === "error" ? "ERROR" : "WARN ";
    const loc = r.line ? `${r.file}:${r.line}` : r.file;
    console.log(`${tag} [${r.code}] ${loc}  ${r.message}`);
  }
  console.log(`\n[docs-gate] ${errors.length} errors, ${warnings.length} warnings${releaseMode ? "（发布模式）" : ""}`);
  if (errors.length === 0) console.log("[docs-gate] 证据链完整；可以交付。");
  else console.log("[docs-gate] 未通过：缺证据是预期失败，不得通过填写虚构报告消除阻塞。");
}

process.exit(errors.length > 0 ? 1 : 0);
