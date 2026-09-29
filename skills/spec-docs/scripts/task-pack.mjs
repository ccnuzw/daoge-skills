#!/usr/bin/env node
/** Generate a read-only implementation/review task package on top of context-pack. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const target = resolve(value("--dir", process.cwd()));
const feature = value("--feature");
const slice = value("--slice");
const objective = value("--objective", "完成当前选择范围内的规格、实现、验证和文档回写");
const phase = value("--phase", "planning");
const outputPath = value("--out");
const text = argv.includes("--text");

if ((feature && slice) || (!feature && !slice)) {
  console.error("[task-pack] 必须且只能指定 --feature 或 --slice");
  process.exit(2);
}
if (!/^(planning|development|release)$/.test(phase)) {
  console.error(`[task-pack] --phase 只能是 planning / development / release，收到：${phase}`);
  process.exit(2);
}

function runContextPack() {
  const args = [join(HERE, "context-pack.mjs"), "--dir", target];
  if (feature) args.push("--feature", feature);
  if (slice) args.push("--slice", slice);
  try {
    return JSON.parse(execFileSync(process.execPath, args, { cwd: target, encoding: "utf8" }));
  } catch (error) {
    const detail = `${error.stdout || ""}${error.stderr || ""}`.trim();
    console.error(detail || `[task-pack] 无法生成 context-pack：${error.message}`);
    process.exit(error.status || 1);
  }
}

function repoRelative(path) {
  const absolute = resolve(target, path);
  const relativePath = relative(target, absolute).split(sep).join("/");
  return relativePath && !relativePath.startsWith("../") && relativePath !== ".." ? relativePath : null;
}
function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}
function unique(values) { return [...new Set(values.filter(Boolean))]; }

const context = runContextPack();
const policy = readJson(join(target, "docs-policy.json")) || {};
const selectedFacts = context.facts || [];
const selectedSlices = context.slices || [];
const blockers = [];
for (const warning of context.warnings || []) blockers.push({ code: "CONTEXT_WARNING", message: warning });
for (const fact of selectedFacts) {
  if (fact.spec_status === "draft") blockers.push({ code: "SPEC_DRAFT", id: fact.id, message: `${fact.id} 的规格状态仍为 draft` });
  if (fact.delivery_scope === "future") blockers.push({ code: "FUTURE_SCOPE", id: fact.id, message: `${fact.id} 属于 future 交付范围` });
  if (phase !== "planning" && fact.implementation_status === "blocked") blockers.push({ code: "IMPLEMENTATION_BLOCKED", id: fact.id, message: `${fact.id} 的实现状态为 blocked` });
}

const documents = unique([
  "AGENTS.md",
  "docs-policy.json",
  "docs-facts.json",
  ...context.documents,
]).filter((path) => !path || existsSync(resolve(target, path)));
const selectedIds = unique([
  feature,
  slice,
  ...selectedFacts.map((entry) => entry.id),
  ...selectedSlices.flatMap((entry) => [entry.id, ...(entry.features || [])]),
]);
const commands = [];
const reviewPhase = phase === "release" ? "release_candidate" : phase;
if (feature) commands.push(`node scripts/review-docs.mjs --phase ${reviewPhase} --feature ${feature}`);
else commands.push(`node scripts/review-docs.mjs --phase ${reviewPhase}`);
commands.push("node scripts/check-docs.mjs --strict");
if (phase === "release") commands.push("node scripts/docs-gate.mjs --release");

const packageData = {
  schema: "spec-docs/task-pack/v1",
  read_only: true,
  generated_by: "scripts/task-pack.mjs",
  objective,
  phase,
  selector: { feature, slice },
  active_version: context.active_version || policy.activeVersion || null,
  selected_ids: selectedIds,
  read_order: documents,
  authority_documents: context.documents || [],
  facts: selectedFacts,
  slices: selectedSlices,
  relations: context.relations || [],
  blockers: unique(blockers.map((entry) => JSON.stringify(entry))).map((entry) => JSON.parse(entry)),
  commands,
  writeback: unique([
    feature && `对应功能主文档（${feature}）`,
    "版本实现状态（仅在有实现或验证事实时更新）",
    "需求追踪矩阵 / 功能索引（编号或映射发生变化时更新）",
    "公共接口、数据、错误码或 E2E 文档（契约发生变化时更新）",
    phase !== "planning" && "验证证据与 manifest（真实执行后追加，不覆盖历史批次）",
  ]),
  warnings: context.warnings || [],
};
const serialized = `${JSON.stringify(packageData, null, 2)}\n`;
if (outputPath) {
  const safe = repoRelative(outputPath);
  if (!safe) {
    console.error("[task-pack] --out 必须位于项目根目录内");
    process.exit(2);
  }
  writeFileSync(resolve(target, outputPath), serialized, "utf8");
}
if (text) {
  console.log(`任务目标：${objective}`);
  console.log(`阶段：${phase}`);
  console.log(`选择范围：${feature || slice}`);
  console.log(`读取文档：${documents.length} 个`);
  console.log(`阻断项：${packageData.blockers.length} 个`);
  console.log("验证命令：");
  for (const command of commands) console.log(`- ${command}`);
  if (!outputPath) process.stdout.write(serialized);
} else if (!outputPath) {
  process.stdout.write(serialized);
}
