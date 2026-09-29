#!/usr/bin/env node
/**
 * check-docs 自测：在临时目录构造最小项目，验证结构检查器能通过干净骨架并捕获各类破坏。
 *
 * 用法: node scripts/selftest-check-docs.mjs
 * 退出码: 0 = 全部断言通过；1 = 有断言失败。
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, "..");
const INIT = join(SKILL_ROOT, "scripts", "init-docs.mjs");

const fixture = join(tmpdir(), `spec-docs-check-selftest-${Date.now()}`);
const failures = [];

function assert(name, condition, detail = "") {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function run(args) {
  try {
    const stdout = execFileSync("node", [join(fixture, "scripts", "check-docs.mjs"), "--quiet", ...args], {
      cwd: fixture,
      encoding: "utf8",
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout || "" };
  }
}

function runVerbose(args) {
  try {
    return { code: 0, stdout: execFileSync("node", [join(fixture, "scripts", "check-docs.mjs"), ...args], { cwd: fixture, encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status ?? 1, stdout: `${error.stdout || ""}${error.stderr || ""}` };
  }
}

const read = (path) => readFileSync(join(fixture, path), "utf8");
const write = (path, text) => writeFileSync(join(fixture, path), text, "utf8");

console.log(`[selftest] 夹具目录：${fixture}`);
mkdirSync(fixture, { recursive: true });
const init = execFileSync("node", [INIT, "--target", fixture, "--name", "Check 自测", "--version", "V1", "--tier", "m"], {
  encoding: "utf8",
});
if (!init) process.exit(1);

const featureDoc = "docs/03-功能规格/V1/01-领域/01-功能主文档.md";
const numbering = "docs/03-功能规格/V1/00-V1需求编号.md";
const matrix = "docs/03-功能规格/V1/00-V1需求追踪矩阵.md";

console.log("\n[1] 干净骨架应零错误");
{
  const result = run([]);
  assert("零错误（exit 0）", result.code === 0);
}

console.log("\n[2] 断链 → 错误");
{
  appendFileSync(join(fixture, featureDoc), "\n[坏链接](不存在的文件.md)\n", "utf8");
  const result = run([]);
  assert("捕获断链", result.code === 1);
  write(featureDoc, read(featureDoc).replace("\n[坏链接](不存在的文件.md)\n", ""));
}

console.log("\n[3] 追踪矩阵缺少需求 → 错误");
{
  const original = read(matrix);
  write(matrix, original.replace(/`V1-FR-001` \| \[01-功能主文档\][^\n]*/, ""));
  const result = run([]);
  assert("捕获编号未追踪", result.code === 1);
  write(matrix, original);
}

console.log("\n[4] 矩阵出现未登记编号 → 警告（严格模式失败）");
{
  appendFileSync(join(fixture, matrix), "\n| `V1-FR-999` | 无 |  |  |  |  |\n", "utf8");
  const normal = runVerbose([]);
  assert("普通模式告警不阻塞", normal.code === 0, String(normal.code));
  const strict = run(["--strict"]);
  assert("--strict 下失败", strict.code === 1);
}

console.log("\n[5] 功能文档缺章节 → 错误");
{
  const original = read(featureDoc);
  write(featureDoc, original.replace("## 功能边界", "## 边界"));
  const result = run([]);
  assert("捕获缺失章节", result.code === 1);
  write(featureDoc, original);
}

console.log("\n[6] AC 表缺列 → 错误");
{
  const original = read(featureDoc);
  write(featureDoc, original.replace("| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 初始资产状态 |", "| AC | 验收重点 | 测试层级 | 目标资产 | 初始资产状态 |"));
  const result = run([]);
  assert("捕获 AC 列缺失", result.code === 1);
  write(featureDoc, original);
}

console.log("\n[7] 未登记到索引的功能文档 → 警告");
{
  const orphan = "docs/03-功能规格/V1/01-领域/02-游离功能.md";
  write(orphan, read(featureDoc).replaceAll("01 <功能名>", "02 游离功能"));
  const result = runVerbose([]);
  assert("提示未登记", result.stdout.includes("未登记到功能索引"), "");
  rmSync(join(fixture, orphan));
}

console.log("\n[8] 自定义文档目录（--dir + policy.root）");
{
  const custom = join(tmpdir(), `spec-docs-check-custom-${Date.now()}`);
  mkdirSync(custom, { recursive: true });
  execFileSync("node", [INIT, "--target", custom, "--name", "自定义目录", "--version", "V1", "--tier", "m", "--dir", "doc"], {
    encoding: "utf8",
  });
  const result = execFileSync("node", [join(custom, "scripts", "check-docs.mjs"), "--quiet"], { cwd: custom, encoding: "utf8" });
  assert("自定义目录零错误", result.includes("0 errors"), result.slice(-80));
  rmSync(custom, { recursive: true, force: true });
}

console.log("\n[9] 最终回归：恢复后应零错误");
{
  const result = run([]);
  assert("零错误（exit 0）", result.code === 0);
}

console.log("\n[10] dry-run 不得写入文件");
{
  const dry = join(tmpdir(), `spec-docs-check-dry-${Date.now()}`);
  mkdirSync(dry, { recursive: true });
  execFileSync("node", [INIT, "--target", dry, "--dry-run", "--tier", "l", "--dir", "doc"], { encoding: "utf8" });
  assert("dry-run 无副作用", !existsSync(join(dry, "doc")) && !existsSync(join(dry, "docs-policy.json")));
  rmSync(dry, { recursive: true, force: true });
}

console.log("\n[11] tier policy 与 L 档门禁生成");
{
  const tierRoot = join(tmpdir(), `spec-docs-check-tier-${Date.now()}`);
  mkdirSync(tierRoot, { recursive: true });
  execFileSync("node", [INIT, "--target", tierRoot, "--tier", "l", "--dir", "doc"], { encoding: "utf8" });
  const policy = JSON.parse(readFileSync(join(tierRoot, "docs-policy.json"), "utf8"));
  const result = execFileSync("node", [join(tierRoot, "scripts/check-docs.mjs"), "--quiet"], { cwd: tierRoot, encoding: "utf8" });
  assert("L tier 生效", policy.tier === "l" && policy.sections.length === 9 && existsSync(join(tierRoot, "docs-gate.json")));
  assert("自定义目录提示与检查一致", result.includes("0 errors"));
  rmSync(tierRoot, { recursive: true, force: true });
}

console.log("\n[12] S 档 policy 收窄必需结构");
{
  const tierRoot = join(tmpdir(), `spec-docs-check-tier-s-${Date.now()}`);
  mkdirSync(tierRoot, { recursive: true });
  execFileSync("node", [INIT, "--target", tierRoot, "--tier", "s"], { encoding: "utf8" });
  const policy = JSON.parse(readFileSync(join(tierRoot, "docs-policy.json"), "utf8"));
  assert("S tier 核心范围可辨识", policy.tier === "s" && policy.sections.length < policy.tierRules.l.sections.length && policy.required.length < policy.tierRules.l.required.length);
  rmSync(tierRoot, { recursive: true, force: true });
}

console.log("\n[13] 存量接入保留同名内容与脚本");
{
  const adoptRoot = join(tmpdir(), `spec-docs-check-adopt-${Date.now()}`);
  mkdirSync(join(adoptRoot, "docs"), { recursive: true });
  mkdirSync(join(adoptRoot, "scripts"), { recursive: true });
  writeFileSync(join(adoptRoot, "docs/README.md"), "existing docs\n", "utf8");
  writeFileSync(join(adoptRoot, "scripts/check-docs.mjs"), "existing script\n", "utf8");
  execFileSync("node", [INIT, "--target", adoptRoot, "--adopt", "--no-gate"], { encoding: "utf8" });
  assert(
    "adopt 不覆盖已有文件并补齐缺项",
    readFileSync(join(adoptRoot, "docs/README.md"), "utf8") === "existing docs\n" &&
      readFileSync(join(adoptRoot, "scripts/check-docs.mjs"), "utf8") === "existing script\n" &&
      existsSync(join(adoptRoot, "scripts/policy-utils.mjs")) &&
      existsSync(join(adoptRoot, "docs-policy.json")) && existsSync(join(adoptRoot, "docs/02-产品与版本/产品蓝图.md")),
  );
  rmSync(adoptRoot, { recursive: true, force: true });
}

console.log("\n[13b] adopt 拒绝已有 policy 与 --dir 冲突");
{
  const adoptRoot = join(tmpdir(), `spec-docs-check-adopt-conflict-${Date.now()}`);
  mkdirSync(join(adoptRoot, "docs"), { recursive: true });
  writeFileSync(join(adoptRoot, "docs-policy.json"), JSON.stringify({ root: "docs", tier: "m" }), "utf8");
  let rejected = false;
  try {
    execFileSync("node", [INIT, "--target", adoptRoot, "--adopt", "--dir", "docs-next"], { encoding: "utf8" });
  } catch {
    rejected = true;
  }
  assert("adopt 不静默改写已有 policy 根目录", rejected && !existsSync(join(adoptRoot, "docs-next")));
  rmSync(adoptRoot, { recursive: true, force: true });
}

console.log("\n[14] AC Given/When/Then 与状态单一来源校验");
{
  const original = read(featureDoc);
  write(featureDoc, original.replace("Then <可断言的最终结果>。", "结果未结构化。"));
  assert("缺少 Then 被拒绝", run([]).code === 1);
  write(featureDoc, original);

  const statePath = "docs/02-产品与版本/当前版本/V1-实现状态.md";
  const state = read(statePath);
  write(statePath, state.replace(/^\| `V1-FR-001`[^\n]*\n/m, ""));
  assert("状态表缺少功能 ID 被拒绝", run([]).code === 1);
  write(statePath, state);

  write(featureDoc, original.replace("domain: <领域名>\n", "domain: <领域名>\nstatus: 规划中\n"));
  assert("frontmatter 不得复制实现状态", run([]).code === 1);
  write(featureDoc, original);
}

console.log("\n[15] 识别 angle-bracket 模板占位符");
{
  const result = runVerbose([]);
  assert("占位符生成警告", result.stdout.includes("仍有占位内容"));
}

console.log("\n[16] 拒绝越级文档目录名");
{
  const unsafe = join(tmpdir(), `spec-docs-check-unsafe-${Date.now()}`);
  mkdirSync(unsafe, { recursive: true });
  let rejected = false;
  try {
    execFileSync("node", [INIT, "--target", unsafe, "--dir", ".."], { encoding: "utf8" });
  } catch {
    rejected = true;
  }
  assert("--dir .. 被拒绝", rejected && !existsSync(join(unsafe, "docs-policy.json")));
  rmSync(unsafe, { recursive: true, force: true });
}

console.log("\n[17] 旧版 policy 兼容迁移与默认质量检查");
{
  const policyPath = "docs-policy.json";
  const originalPolicy = read(policyPath);
  const originalFeature = read(featureDoc);
  const policy = JSON.parse(originalPolicy);
  delete policy.openapi;
  delete policy.quality;
  delete policy.requireDeliveryMetadata;
  delete policy.tierRules;
  write(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  write(featureDoc, originalFeature
    .replace("delivery_scope: active\n", "")
    .replace("planning_only: false\n", "")
    .replace("delivery_slice: V1-core\n", "")
    .replace("<无持久化时写：不适用。理由：<...>。>", "本功能涉及持久化数据。")
    .replace("### 字段读写矩阵\n", ""));

  const legacy = runVerbose([]);
  assert("旧版 policy 缺交付元数据仅产生迁移告警", legacy.code === 0 && legacy.stdout.includes("兼容模式运行") && !legacy.stdout.includes("delivery_scope 必须"));
  assert("未配置 OpenAPI 时推断标准路径", !legacy.stdout.includes("未配置") && !legacy.stdout.includes("OpenAPI 不存在"));
  assert("未配置 quality 时仍检查最低数据章节", legacy.stdout.includes("数据与事务缺少可审计小节：字段读写矩阵"), legacy.stdout.split("\n").filter((line) => line.includes("数据与事务") || line.includes("字段读写矩阵")).join(" | "));

  policy.requireDeliveryMetadata = true;
  write(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  const strictDelivery = run([]);
  assert("显式启用交付元数据时缺项报错", strictDelivery.code === 1);

  write(policyPath, originalPolicy);
  write(featureDoc, originalFeature);
}

console.log("\n[18] 路线图版本必须有独立规划主文档");
{
  const roadmapPath = "docs/02-产品与版本/版本路线图.md";
  const indexPath = "docs/02-产品与版本/后续版本/README.md";
  const v3Path = "docs/02-产品与版本/后续版本/V3-规划.md";
  const v6Path = "docs/02-产品与版本/后续版本/V6-规划.md";
  const originalRoadmap = read(roadmapPath);
  const originalIndex = read(indexPath);
  const plan = (version) => `# ${version} 版本规划\n\n## 版本目标\n\n${version} 的目标。\n\n## 范围与边界\n\n### 做什么\n\n- 范围。\n\n### 不做什么\n\n- 排除项。\n\n## 架构与接口方向\n\n- 方向。\n\n## 数据影响\n\n- 影响。\n\n## 验收方向\n\n- 验收。\n`;
  const extraRows = [
    "| V3 | 工作流 | 规划骨架 | 范围 | 标准 | V2 |",
    "| V6 | 协作 | 规划骨架 | 范围 | 标准 | V5 |",
  ].join("\n");
  write(roadmapPath, originalRoadmap.replace(/(\| V2 \|[^\n]*\n)/, `$1${extraRows}\n`));

  const missing = runVerbose([]);
  assert("缺少规划主文档时同时捕获 V3 和 V6", missing.code === 1 && missing.stdout.includes("V3") && missing.stdout.includes("V6"));

  write(v3Path, plan("V3"));
  write(v6Path, plan("V6"));
  const unindexed = runVerbose([]);
  assert("规划主文档未登记到索引时失败", unindexed.code === 1 && unindexed.stdout.includes("规划文档未登记到后续版本索引"));

  write(indexPath, `${originalIndex}\n| V3 | [V3 规划](V3-规划.md) | 规划骨架 |\n| V6 | [V6 规划](V6-规划.md) | 规划骨架 |\n`);
  assert("完整版本规划与索引通过", run([]).code === 0);

  write(v6Path, plan("V7"));
  const titleMismatch = runVerbose([]);
  assert("规划主文档标题版本不一致时失败", titleMismatch.code === 1 && titleMismatch.stdout.includes("标题必须包含版本号"));

  write(roadmapPath, originalRoadmap);
  write(indexPath, originalIndex);
  rmSync(join(fixture, v3Path));
  rmSync(join(fixture, v6Path));
}

console.log("\n[19] 产品蓝图与版本 PRD 的场景深度和版本边界");
{
  const blueprintPath = "docs/02-产品与版本/产品蓝图.md";
  const prdPath = "docs/02-产品与版本/当前版本/V1-产品需求.md";
  const blueprint = read(blueprintPath);
  const prd = read(prdPath);

  write(blueprintPath, blueprint.replace("## 10. 核心业务流程", "## 10. 流程摘要"));
  let result = runVerbose(["--strict"]);
  assert("蓝图缺核心业务流程被拦截", result.code === 1 && result.stdout.includes("产品文档缺少可评审章节：核心业务流程"));
  write(blueprintPath, blueprint);

  write(prdPath, prd.replace(/1\. <用户操作、系统状态变化与反馈>。\n2\. <下一步与持久化\/可见结果>。/, "<步骤 A> -> <步骤 B>"));
  result = runVerbose(["--strict"]);
  assert("PRD 箭头链不能代替有序场景", result.code === 1 && result.stdout.includes("缺少场景信息表或有序步骤"));
  write(prdPath, prd);

  write(prdPath, prd.replace("| <页面> | <角色/任务>", "| V2 页面 | <角色/任务>"));
  result = runVerbose(["--strict"]);
  assert("未来版本页面混入当前交付被拦截", result.code === 1 && result.stdout.includes("页面需求 混入非当前版本能力"));
  write(prdPath, prd);

  write(prdPath, prd.replace("| 场景 | 真实入口与前提 | 成功终态 | 关键失败断言 | 功能 ID | E2E/门禁与证据 |", "| 场景 | 真实入口与前提 | 成功终态 | 关键失败断言 |"));
  result = runVerbose(["--strict"]);
  assert("版本验收缺追踪列被拦截", result.code === 1 && result.stdout.includes("版本验收场景 缺少结构化视图或必需列"));
  write(prdPath, prd);

  write(prdPath, prd.replace("| <跨功能场景> | <角色/环境/前提> | <可观察结果> | <权限/重复/外部失败> | V1-FR-001 | <E2E/门禁链接及证据> |", "| 安装应用 | 开发者完成校验 | 应用可启动 | 校验失败可回退 | V1-FR-999 | 见发布清单 |"));
  result = runVerbose(["--strict"]);
  assert("验收场景缺已登记功能和 E2E 编号被拦截", result.code === 1 && result.stdout.includes("未关联已登记的当前版本功能 ID") && result.stdout.includes("缺少稳定 E2E 验收编号"));
  write(prdPath, prd);

  assert("恢复产品文档后普通检查通过", run([]).code === 0);
}

console.log("\n[20] SDD 契约和 E2E 规范的双向追踪");
{
  const specPath = "docs/05-测试与发布/端到端验收/V1-端到端验收规范.md";
  const matrixPath = "docs/05-测试与发布/端到端验收/用例矩阵.md";
  const interfacePath = "docs/04-技术架构/当前版本/V1-接口契约.md";
  const dataPath = "docs/04-技术架构/当前版本/V1-数据模型.md";
  const specification = read(specPath);
  const cases = read(matrixPath);
  const contract = read(interfacePath);
  const data = read(dataPath);
  const feature = read(featureDoc);

  write(specPath, specification.replace("## V1-E2E-02（E2E02）<用例名>", "## 缺失第二条规范"));
  let result = runVerbose(["--strict"]);
  assert("矩阵用例缺少独立规范章节被拦截", result.stdout.includes("E2E 矩阵用例缺少规范独立章节：V1-E2E-02"));
  write(specPath, specification);

  write(matrixPath, cases.replace(/^\| E2E02 .*\n/m, (row) => `${row}| E2E03 新增用例 | V1-FR-001 | AC02 | 入口 | 数据库 | 无 | 状态 | 结果 | test.ts | local | 2026-09-28 | abc1234 | npm test | report.md | mock | 未执行 |\n`));
  result = runVerbose(["--strict"]);
  assert("矩阵新增 ID 无对应规范被拦截", result.stdout.includes("E2E 矩阵用例缺少规范独立章节：V1-E2E-03"));
  write(matrixPath, cases);

  write(matrixPath, cases.replace(/^\| E2E02 .*\n/m, ""));
  result = runVerbose(["--strict"]);
  assert("规范用例未登记到矩阵被拦截", result.stdout.includes("E2E 规范用例未登记到执行矩阵：V1-E2E-02"));
  write(matrixPath, cases);

  write(specPath, specification.replace("When <动作>。", "<未定义动作>。"));
  result = runVerbose(["--strict"]);
  assert("E2E 独立正文缺 When 被拦截", result.stdout.includes("V1-E2E-02 缺少独立的 When 条件"));
  write(specPath, specification);

  write(featureDoc, feature.replace("#### AC02 <验收名称>", "#### AC02 <验收名称>（V3）"));
  result = runVerbose(["--strict"]);
  assert("未来 AC 混入当前功能被拦截", result.stdout.includes("AC02 标题指向未来版本"));
  write(featureDoc, feature);

  write(interfacePath, contract.replace("| 操作 ID | 入口与传输 | 鉴权主体 | 功能 ID | 阶段 | 成功终态 | 关键失败与无副作用 | 字段权威 | AC/E2E |", "| 操作 ID | 入口与传输 | 鉴权主体 | 功能 ID | 阶段 | 字段权威 | AC/E2E |"));
  result = runVerbose(["--strict"]);
  assert("公共接口逐操作终态与失败列缺失被拦截", result.stdout.includes("接口公共契约缺少逐操作索引或必需列"));
  write(interfacePath, contract);

  write(interfacePath, contract.replace("| <operationId/动作 ID> | <方法+路径/SDK/事件> | <角色/能力> | V1-FR-001", "| installApp | POST /api/apps | 管理员 | V1-FR-999"));
  result = runVerbose(["--strict"]);
  assert("公共接口操作引用未知功能被拦截", result.stdout.includes("installApp 未关联已登记的当前版本功能 ID"));
  write(interfacePath, contract);

  write(dataPath, data.replace("### 关键不变量与失败验证", "### 设计摘要"));
  result = runVerbose(["--strict"]);
  assert("数据不变量与验证视图缺失被拦截", result.stdout.includes("数据公共契约缺少 关键不变量与失败验证"));
  write(dataPath, data);

  assert("恢复后普通检查通过", run([]).code === 0);
}

console.log(`\n[selftest] ${failures.length === 0 ? "全部通过" : `${failures.length} 项失败`}`);
if (failures.length > 0) {
  console.log(`  失败项：${failures.join(" / ")}`);
  process.exit(1);
}
if (!process.env.SPEC_DOCS_KEEP_FIXTURE) rmSync(fixture, { recursive: true, force: true });
console.log("[selftest] 夹具已清理（设 SPEC_DOCS_KEEP_FIXTURE=1 可保留）");
