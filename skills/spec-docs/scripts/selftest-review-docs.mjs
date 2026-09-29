#!/usr/bin/env node
/** Focused regression tests for SDD readiness review and stable machine output. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, "..");
const fixture = join(tmpdir(), `spec-docs-review-selftest-${Date.now()}`);
const feature = "docs/03-功能规格/V1/01-领域/01-功能主文档.md";
const failures = [];
function assert(name, condition, detail = "") {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : `: ${detail}`}`);
  if (!condition) failures.push(name);
}
function run(args) {
  try {
    const stdout = execFileSync("node", args, { cwd: fixture, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout || "" };
  }
}
function review() {
  const result = run(["scripts/review-docs.mjs", "--phase", "planning", "--json", "--quiet"]);
  try { return { ...result, report: JSON.parse(result.stdout) }; } catch { return { ...result, report: null }; }
}
function reviewFeature(featureId) {
  const result = run(["scripts/review-docs.mjs", "--phase", "planning", "--feature", featureId, "--json", "--quiet"]);
  try { return { ...result, report: JSON.parse(result.stdout) }; } catch { return { ...result, report: null }; }
}
function reviewTier(tier) {
  const result = run(["scripts/review-docs.mjs", "--tier", tier, "--phase", "planning", "--json", "--quiet"]);
  try { return { ...result, report: JSON.parse(result.stdout) }; } catch { return { ...result, report: null }; }
}
function reviewWithTierPolicy(tier) {
  const result = run(["scripts/review-docs.mjs", "--tier", tier, "--phase", "planning", "--json", "--quiet"]);
  try { return { ...result, report: JSON.parse(result.stdout) }; } catch { return { ...result, report: null }; }
}
function mutateAndReview(path, transform) {
  const original = readFileSync(path, "utf8");
  writeFileSync(path, transform(original), "utf8");
  try { return review().report?.issues || []; } finally { writeFileSync(path, original, "utf8"); }
}
function hasIssue(issues, code) { return issues.some((issue) => issue.code === code); }

mkdirSync(fixture, { recursive: true });
const initialized = run([join(SKILL_ROOT, "scripts/init-docs.mjs"), "--target", fixture, "--name", "Review 自测", "--version", "V1", "--tier", "m"]);
assert("初始化 review 夹具", initialized.code === 0, initialized.stdout);
if (initialized.code === 0) {
  const first = review();
  const second = review();
  assert("规划期草稿不能误报 SPEC_READY", first.code === 1 && first.report?.status === "SDD_NOT_READY");
  assert("规划期规格缺口属于阻断项", first.report?.issues?.some((issue) => issue.code === "FEATURE_METADATA_MISSING" && issue.blocking));
  const signature = (report) => report?.issues?.map(({ file, line, code, id }) => [file, line, code, id].join("|")).join("\n");
  assert("相同输入产生稳定排序与结果", signature(first.report) === signature(second.report));
  const featureReview = reviewFeature("V1-FR-001");
  assert("按功能审查只返回目标范围", featureReview.report?.scope?.type === "feature" && featureReview.report?.scope?.feature_id === "V1-FR-001" && featureReview.report?.summary?.features === 1);
  assert("按功能审查不会混入无关功能", !featureReview.report?.issues?.some((issue) => issue.id && issue.id.startsWith("V1-FR-002")));
  assert("按功能审查默认跳过全局产品与契约检查", !featureReview.report?.issues?.some((issue) => ["PRODUCT_BLUEPRINT_MISSING", "PRODUCT_PRD_MISSING", "INTERFACE_CONTRACT_MISSING", "DATA_MODEL_MISSING", "PERFORMANCE_MATRIX_MISSING"].includes(issue.code)));
  assert("按功能审查报告依赖 E2E 闭包", Array.isArray(featureReview.report?.scope?.dependency_e2e));
  const unknownFeature = reviewFeature("V1-FR-999");
  assert("不存在的功能 ID 返回配置错误", unknownFeature.code === 2 && unknownFeature.report?.status === "CONFIG_ERROR");

  const featurePath = join(fixture, feature);
  const original = readFileSync(featurePath, "utf8");
  writeFileSync(featurePath, `${original}\n| AC | 目标资产 |\n| --- | --- |\n| AC01 | \`operation/group\` https://example.test/api/foo |\n| AC01 | \`tests/missing.test.js\` |\n`, "utf8");
  const paths = review().report?.issues || [];
  assert("operation ID 与 URL 不会误判为测试文件", !paths.some((issue) => issue.code === "TEST_ASSET_MISSING" && /operation\/group|example\.test/.test(issue.message)));
  assert("不存在的测试文件会被识别", paths.some((issue) => issue.code === "TEST_ASSET_MISSING" && issue.message.includes("tests/missing.test.js")));
  assert("规划中的测试资产缺失不阻断规格审查", paths.some((issue) => issue.code === "TEST_ASSET_MISSING" && issue.blocking === false));
  writeFileSync(featurePath, original, "utf8");

  const policyPath = join(fixture, "docs-policy.json");
  const policyOriginal = readFileSync(policyPath, "utf8");
  const reviewPolicy = JSON.parse(policyOriginal);
  reviewPolicy.quality.performance = { ...(reviewPolicy.quality.performance || {}), enabled: true };
  if (reviewPolicy.tierRules?.[reviewPolicy.tier]?.quality?.performance) {
    reviewPolicy.tierRules[reviewPolicy.tier].quality.performance.enabled = true;
  }
  reviewPolicy.quality = reviewPolicy.tierRules?.[reviewPolicy.tier]?.quality || reviewPolicy.quality;
  writeFileSync(policyPath, JSON.stringify(reviewPolicy, null, 2), "utf8");
  renameSync(join(fixture, "docs"), join(fixture, "docs-next"));
  writeFileSync(policyPath, JSON.stringify({ ...reviewPolicy, root: "docs-next" }, null, 2), "utf8");
  const customRoot = review();
  assert("reviewer 支持 policy.root 自定义文档目录", customRoot.report?.issues?.some((issue) => issue.file.startsWith("docs-next/")));
  writeFileSync(policyPath, JSON.stringify({ ...JSON.parse(policyOriginal), quality: { productDocs: { blueprint: "../outside.md" } } }, null, 2), "utf8");
  const unsafePath = review();
  assert("reviewer 拒绝越出文档根目录的配置路径", unsafePath.code === 2 && unsafePath.report?.status === "CONFIG_ERROR");
  renameSync(join(fixture, "docs-next"), join(fixture, "docs"));
  writeFileSync(policyPath, JSON.stringify(reviewPolicy, null, 2), "utf8");

  const tierPolicy = JSON.parse(policyOriginal);
  tierPolicy.quality = { ...(tierPolicy.quality || {}), enabled: true, performance: { enabled: true } };
  tierPolicy.tierRules.m.quality.performance.enabled = false;
  writeFileSync(policyPath, JSON.stringify(tierPolicy, null, 2), "utf8");
  const tierOverride = review();
  assert("tier quality 覆盖顶层 quality", !tierOverride.report?.issues?.some((issue) => issue.code === "PERFORMANCE_MATRIX_MISSING"));
  tierPolicy.tierRules.m.quality.performance.enabled = true;
  writeFileSync(policyPath, JSON.stringify(tierPolicy, null, 2), "utf8");
  const performanceEnabled = reviewWithTierPolicy("m");
  assert("tier quality 可显式启用性能审查", performanceEnabled.report?.summary && !performanceEnabled.report?.issues?.some((issue) => issue.code === "CONFIG"));
  writeFileSync(policyPath, policyOriginal, "utf8");

  const blueprintPath = join(fixture, "docs/02-产品与版本/产品蓝图.md");
  const prdPath = join(fixture, "docs/02-产品与版本/当前版本/V1-产品需求.md");
  const interfacePath = join(fixture, "docs/04-技术架构/当前版本/V1-接口契约.md");
  const dataPath = join(fixture, "docs/04-技术架构/当前版本/V1-数据模型.md");
  const e2eSpecPath = join(fixture, "docs/05-测试与发布/端到端验收/V1-端到端验收规范.md");
  const performancePath = join(fixture, "docs/05-测试与发布/性能与容量/场景矩阵.md");

  assert("蓝图核心概念缺少所有权表会被拦截", hasIssue(mutateAndReview(blueprintPath, (text) => text.replace(/\n### 7\.1 概念关系与所有权[\s\S]*?(?=\n## 8\.)/, "\n### 7.1 概念关系与所有权\n\n待补充。")), "CONCEPT_OWNERSHIP_TABLE_MISSING"));
  assert("PRD 交付单元缺少完成定义会被拦截", hasIssue(mutateAndReview(prdPath, (text) => text.replace(/\n## 11\. 交付顺序与依赖[\s\S]*?(?=\n## 12\.)/, "\n## 11. 交付顺序与依赖\n\n待补充。")), "DELIVERY_UNIT_CLOSURE_MISSING"));
  assert("接口契约缺少逐操作表会被拦截", hasIssue(mutateAndReview(interfacePath, (text) => text.replace(/\n## 本版逐操作契约索引[\s\S]*?(?=\n## 后续版本规划操作)/, "\n## 本版逐操作契约索引\n\n待补充。")), "OPERATION_TABLE_MISSING"));
  assert("数据模型缺少不变量验证表会被拦截", hasIssue(mutateAndReview(dataPath, (text) => text.replace(/\n### 关键不变量与失败验证[\s\S]*?(?=\n### )/, "\n### 关键不变量与失败验证\n\n待补充。")), "TABLE_COLUMNS_MISSING"));
  assert("E2E 独立正文缺少 When 会被拦截", hasIssue(mutateAndReview(e2eSpecPath, (text) => text.replace("When <从真实入口触发的动作>。\n", "")), "E2E_SPEC_STRUCTURE"));
  const performanceMissing = (() => {
    const original = readFileSync(policyPath, "utf8");
    const policy = JSON.parse(original);
    policy.tierRules.m.quality.performance.enabled = true;
    writeFileSync(policyPath, JSON.stringify(policy, null, 2), "utf8");
    try {
      return mutateAndReview(performancePath, (text) => text.replace(/\n\| 用例 \|[\s\S]*?(?=\n## 公共前置)/, "\n待补充。\n"));
    } finally {
      writeFileSync(policyPath, original, "utf8");
    }
  })();
  assert("性能矩阵缺少结构化场景表会被拦截", hasIssue(performanceMissing, "PERFORMANCE_TABLE_MISSING"));
  const performanceNotApplicable = (() => {
    const original = readFileSync(policyPath, "utf8");
    const policy = JSON.parse(original);
    policy.tierRules.m.quality.performance.enabled = true;
    writeFileSync(policyPath, JSON.stringify(policy, null, 2), "utf8");
    try {
      return mutateAndReview(performancePath, (text) => text.replace(/\n\| 用例 \|[\s\S]*?(?=\n## 公共前置)/, "\n不适用：本版本没有对外服务或容量目标，改由离线验收记录替代。\n"));
    } finally {
      writeFileSync(policyPath, original, "utf8");
    }
  })();
  assert("明确的不适用理由可以裁剪性能表", !hasIssue(performanceNotApplicable, "PERFORMANCE_TABLE_MISSING"));

  const relativeAssetDir = join(fixture, "docs/03-功能规格/V1/01-领域/tests");
  mkdirSync(relativeAssetDir, { recursive: true });
  writeFileSync(join(relativeAssetDir, "existing.test.js"), "// fixture\n", "utf8");
  const linkedAssetIssues = mutateAndReview(join(fixture, feature), (text) => `${text}\n## 附加测试映射\n\n| AC | 目标资产 |\n| --- | --- |\n| AC01 | [已有测试](./tests/existing.test.js) |\n| AC01 | [缺失测试](./tests/missing-link.test.js) |\n`);
  assert("Markdown 相对链接按文档目录解析", !linkedAssetIssues.some((issue) => issue.code === "TEST_ASSET_MISSING" && issue.message.includes("existing.test.js")));
  assert("不存在的 Markdown 测试链接会被识别", linkedAssetIssues.some((issue) => issue.code === "TEST_ASSET_MISSING" && issue.message.includes("missing-link.test.js")));
  rmSync(join(fixture, "docs/03-功能规格/V1/01-领域/tests"), { recursive: true, force: true });
}

console.log(`\n[selftest] ${failures.length ? `${failures.length} 项失败` : "全部通过"}`);
if (!process.env.SPEC_DOCS_KEEP_FIXTURE) rmSync(fixture, { recursive: true, force: true });
if (failures.length) process.exit(1);
