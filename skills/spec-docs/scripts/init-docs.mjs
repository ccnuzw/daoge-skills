#!/usr/bin/env node
/**
 * 为项目生成文档驱动开发骨架。
 *
 * 用法:
 *   node init-docs.mjs [--target <项目根>] [--name "项目名"] [--version V1] [--tier s|m|l]
 *                      [--dir <文档目录名，默认 docs>] [--gate|--no-gate] [--adopt] [--force] [--dry-run]
 *   node init-docs.mjs --target <项目根> --refresh   # 只更新项目内脚本副本，不动 docs/
 *
 * 生成内容:
 *   <项目根>/docs/                    文档骨架（占位符已替换）
 *   <项目根>/docs-policy.json         结构检查配置
 *   <项目根>/scripts/check-docs.mjs   结构检查脚本（项目内自带一份）
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, "..");
const SKELETON_DOCS = join(SKILL_ROOT, "assets", "skeleton", "docs");
const SKELETON_POLICY = join(SKILL_ROOT, "assets", "skeleton", "docs-policy.json");
const SKELETON_GATE_CONFIG = join(SKILL_ROOT, "assets", "skeleton", "docs-gate.json");
const SKELETON_EVIDENCE = join(SKILL_ROOT, "assets", "skeleton", "docs-evidence.json");

function fail(msg) {
  console.error(`[spec-docs] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const get = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
  };
  const version = get("--version", "V1");
  if (!/^V\d+$/.test(version)) fail(`--version 必须是 V1/V2 形式，收到：${version}`);
  const tier = get("--tier", "m").toLowerCase();
  if (!["s", "m", "l"].includes(tier)) fail(`--tier 只能是 s / m / l，收到：${tier}`);
  const dir = get("--dir", "docs");
  if (!/^[A-Za-z0-9._-]+$/.test(dir) || dir === "." || dir === "..") {
    fail(`--dir 必须是安全的单级目录名，不能是 . 或 ..，收到：${dir}`);
  }
  return {
    target: resolve(get("--target", process.cwd())),
    name: get("--name", null),
    version,
    tier,
    dir,
    gate: argv.includes("--gate") ? true : argv.includes("--no-gate") ? false : null,
    force: argv.includes("--force"),
    adopt: argv.includes("--adopt"),
    dryRun: argv.includes("--dry-run"),
    refresh: argv.includes("--refresh"),
  };
}

function refreshScripts(opts) {
  const scriptsDir = join(opts.target, "scripts");
  if (!existsSync(scriptsDir)) fail(`找不到 scripts/ 目录：${scriptsDir}`);
  if (hasSymlinkAncestor(scriptsDir)) fail(`拒绝通过符号链接刷新脚本：${scriptsDir}`);
  const copies = [[join(SKILL_ROOT, "scripts", "check-docs.mjs"), join(scriptsDir, "check-docs.mjs")]];
  if (existsSync(join(opts.target, "docs-gate.json")) || existsSync(join(scriptsDir, "docs-gate.mjs"))) {
    copies.push([join(SKILL_ROOT, "scripts", "docs-gate.mjs"), join(scriptsDir, "docs-gate.mjs")]);
  }
  for (const [src, dst] of copies) {
    if (hasSymlinkAncestor(dst)) fail(`拒绝覆盖符号链接脚本：${dst}`);
    if (opts.dryRun) console.log(`[spec-docs] dry-run：将更新 ${dst}`);
    else {
      cpSync(src, dst);
      console.log(`[spec-docs] 已更新：${dst}`);
    }
  }
  console.log("[spec-docs] 只替换脚本副本，未改动 docs/ 与配置文件。");
}

const opts = parseArgs(process.argv.slice(2));
if (opts.adopt && opts.force) fail("--adopt 与 --force 不能同时使用；存量接入模式始终保留现有文件。");
function canonicalTarget(path) {
  const abs = resolve(path);
  let existing = abs;
  while (!existsSync(existing) && existing !== dirname(existing)) existing = dirname(existing);
  return resolve(realpathSync(existing), relative(existing, abs));
}
opts.target = canonicalTarget(opts.target);
const withGate = opts.gate === null ? opts.tier === "l" : opts.gate;

if (opts.refresh) {
  refreshScripts(opts);
  process.exit(0);
}
const projectName = opts.name || basename(opts.target);
const nextVersion = `V${Number(opts.version.slice(1)) + 1}`;
const today = new Date().toISOString().slice(0, 10);

const substitutions = [
  ["{{项目名}}", projectName],
  ["{{活跃版本}}", opts.version],
  ["{{下一版本}}", nextVersion],
  ["{{日期}}", today],
  ["{{文档目录}}", opts.dir],
];

function substitute(text) {
  let out = text;
  for (const [from, to] of substitutions) out = out.split(from).join(to);
  return out;
}

if (!existsSync(SKELETON_DOCS)) fail(`skill 骨架缺失：${SKELETON_DOCS}`);

const docsTarget = join(opts.target, opts.dir);
const policyTarget = join(opts.target, "docs-policy.json");
const checkerTarget = join(opts.target, "scripts", "check-docs.mjs");
const gateConfigTarget = join(opts.target, "docs-gate.json");
const evidenceTarget = join(opts.target, "docs-evidence.json");
const gateTarget = join(opts.target, "scripts", "docs-gate.mjs");

const plannedTargets = [
  [docsTarget, `${opts.dir}/`],
  [policyTarget, "docs-policy.json"],
  [checkerTarget, "scripts/check-docs.mjs"],
];
if (withGate) {
  plannedTargets.push(
    [gateConfigTarget, "docs-gate.json"],
    [evidenceTarget, "docs-evidence.json"],
    [gateTarget, "scripts/docs-gate.mjs"],
  );
}

for (const [path, label] of plannedTargets) {
  if (opts.adopt) continue;
  if (existsSync(path) && !opts.force) {
    fail(`${label} 已存在：${path}\n如需覆盖请加 --force（会覆盖同名文件）。`);
  }
}

function collectPlan(srcDir, dstDir, actions) {
  for (const entry of readdirSync(srcDir)) {
    const src = join(srcDir, entry);
    const dst = join(dstDir, substitute(entry));
    if (statSync(src).isDirectory()) {
      collectPlan(src, dst, actions);
    } else {
      actions.push({ path: dst, content: substitute(readFileSync(src, "utf8")) });
    }
  }
}

const actions = [];
collectPlan(SKELETON_DOCS, docsTarget, actions);
const policy = JSON.parse(substitute(readFileSync(SKELETON_POLICY, "utf8")));
const fullSections = [...policy.sections];
const fullRequired = [...policy.required];
const compactSections = ["01-项目概览", "02-产品与版本", "03-功能规格", "06-决策记录", "90-参考资料", "99-历史归档"];
const requiredFor = (sections) => fullRequired.filter((path) => path === "README.md" || sections.includes(path.split("/")[0]));
policy.tier = opts.tier;
policy.tierRules = {
  s: { sections: compactSections, required: requiredFor(compactSections) },
  m: { sections: fullSections, required: fullRequired },
  l: { sections: fullSections, required: fullRequired },
};
policy.sections = policy.tierRules[opts.tier].sections;
policy.required = policy.tierRules[opts.tier].required;
actions.push({ path: policyTarget, content: `${JSON.stringify(policy, null, 2)}\n` });
actions.push({ path: checkerTarget, source: join(SKILL_ROOT, "scripts", "check-docs.mjs") });

if (withGate) {
  actions.push({ path: gateConfigTarget, content: substitute(readFileSync(SKELETON_GATE_CONFIG, "utf8")) });
  actions.push({ path: evidenceTarget, content: substitute(readFileSync(SKELETON_EVIDENCE, "utf8")) });
  actions.push({ path: gateTarget, source: join(SKILL_ROOT, "scripts", "docs-gate.mjs") });
}

if (opts.adopt) {
  const missing = actions.filter((action) => !existsSync(action.path));
  const preserved = actions.length - missing.length;
  actions.splice(0, actions.length, ...missing);
  console.log(`[spec-docs] 存量接入模式：将只新增 ${actions.length} 个缺失文件，保留 ${preserved} 个同名文件。`);
}

function hasSymlinkAncestor(path) {
  let current = resolve(path);
  while (current !== dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
    current = dirname(current);
  }
  return false;
}
for (const action of actions) {
  if (hasSymlinkAncestor(action.path)) fail(`拒绝通过符号链接写入：${action.path}`);
}

if (opts.dryRun) {
  console.log(`[spec-docs] dry-run：将生成 ${actions.length} 个文件到 ${opts.target}`);
  for (const action of actions) console.log(`  - ${action.path.replace(opts.target, ".")}`);
  process.exit(0);
}

for (const action of actions) {
  mkdirSync(dirname(action.path), { recursive: true });
  if (action.source) cpSync(action.source, action.path);
  else writeFileSync(action.path, action.content, "utf8");
}

console.log(`[spec-docs] 已为「${projectName}」生成文档骨架（活跃版本 ${opts.version}，档位 ${opts.tier}）`);
console.log(`  文件数：${actions.length}，根目录：${opts.target}`);
console.log("");
console.log("下一步：");
  console.log(`  1. 打开 ${opts.dir}/README.md，按“按任务查找”表逐份填充：产品蓝图 → 版本路线图 → 版本总览/产品需求。`);
  console.log(`  2. 在 ${opts.dir}/03-功能规格/${opts.version}/00-${opts.version}需求编号.md 登记需求，再写功能主文档（高风险另建技术设计）。`);
  console.log(`  3. 运行结构检查：node scripts/check-docs.mjs`);
  console.log(`  4. 档位 ${opts.tier.toUpperCase()} 已写入 docs-policy.json；S 档只强制核心章节，其余模板保留为可选参考。`);
if (withGate) {
  console.log("  5. 交付门禁已生成（docs-gate.json + docs-evidence.json + scripts/docs-gate.mjs）。");
  console.log("     先看 references/docs-gate.md：产出报告 → --authority-digest → 审批 → node scripts/docs-gate.mjs");
} else {
  console.log("  5. 需要交付证据门禁时重新运行并加 --gate（或 --tier l），会补生成 docs-gate.json / docs-evidence.json / scripts/docs-gate.mjs。");
}
console.log("  6. 《文档驱动开发方法论总纲》与各层写法见 skill 的 references/。");
