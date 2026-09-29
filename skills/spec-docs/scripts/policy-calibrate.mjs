#!/usr/bin/env node
/**
 * Read-only policy calibration report.
 * Usage: node policy-calibrate.mjs --dir <project-root> [--docs-root <docs-dir>]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

function fail(message) { console.error(`[spec-docs] ${message}`); process.exit(1); }
function value(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
function walk(root) {
  const result = [];
  if (!existsSync(root)) return result;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) result.push(...walk(path));
    else result.push(path);
  }
  return result;
}
function countDocs(root) {
  return walk(root).filter((path) => [".md", ".yaml", ".yml", ".json"].includes(extname(path)));
}

const target = resolve(value(process.argv.slice(2), "--dir", process.cwd()));
const docs = resolve(target, value(process.argv.slice(2), "--docs-root", "docs"));
const policyPath = join(target, "docs-policy.json");
if (!existsSync(docs)) fail(`找不到 docs/ 目录：${docs}`);
let policy = null;
let parseError = null;
if (existsSync(policyPath)) {
  try { policy = JSON.parse(readFileSync(policyPath, "utf8")); } catch (error) { parseError = error.message; }
}
const all = countDocs(docs);
const text = all.filter((path) => extname(path) === ".md").map((path) => readFileSync(path, "utf8")).join("\n");
const placeholders = [...text.matchAll(/\{\{[^}]+\}\}/g)].map((match) => match[0]);
const changeSlices = [...text.matchAll(/\bV\d+-CS-\d{3}\b/g)].map((match) => match[0]);
const configuredRequired = (policy?.required || []).map((path) => path.replaceAll("{{活跃版本}}", policy?.activeVersion || ""));
const missingRequired = configuredRequired.filter((path) => !existsSync(join(target, policy?.root || "docs", path)));
const sections = [...new Set((policy?.sections || []).map(String))];
const presentSections = sections.filter((section) => existsSync(join(docs, section)));
const coverage = sections.length ? presentSections.length / sections.length : 0;
const suggestedTier = coverage >= 0.9 && all.length >= 20 ? "l" : coverage >= 0.6 && all.length >= 8 ? "m" : "s";
const recommendations = [];
if (!policy) recommendations.push({ code: "missing-policy", severity: "error", message: "缺少 docs-policy.json，建议先运行 init-docs 或手工建立 policy。" });
if (parseError) recommendations.push({ code: "invalid-policy", severity: "error", message: `docs-policy.json 无法解析：${parseError}` });
if (placeholders.length) recommendations.push({ code: "unresolved-placeholders", severity: "warning", count: new Set(placeholders).size, message: "文档仍含模板占位符；建议明确版本、项目名和文档路径后再提高 strict。" });
if (!changeSlices.length) recommendations.push({ code: "missing-change-slices", severity: "info", message: "尚未发现 Vx-CS-NNN 变更切片；增量变更建议使用 07-变更切片目录记录影响和验证闭环。" });
if (missingRequired.length) recommendations.push({ code: "missing-required-files", severity: "warning", count: missingRequired.length, files: missingRequired.slice(0, 20), message: "policy 声明的 required 文件在实际文档根目录中缺失。" });
if (policy && policy.tier !== suggestedTier) recommendations.push({ code: "tier-recommendation", severity: "info", current: policy.tier || null, suggested: suggestedTier, message: `根据章节覆盖率和文档规模，建议评估 ${suggestedTier.toUpperCase()} 档；该建议不自动修改 policy。` });
if (policy?.tier === "l" && !policy.quality?.performance?.enabled) recommendations.push({ code: "tier-quality-mismatch", severity: "warning", message: "policy 标记为 L 档但性能质量规则未启用。" });
console.log(JSON.stringify({
  schema: "spec-docs/policy-calibrate/v1",
  read_only: true,
  target,
  policy: { present: Boolean(policyPath && existsSync(policyPath)), parse_error: parseError, tier: policy?.tier || null, root: policy?.root || relative(target, docs).split("\\").join("/") },
  inventory: { document_files: all.length, markdown_files: all.filter((path) => extname(path) === ".md").length, change_slices: [...new Set(changeSlices)].sort(), placeholder_count: placeholders.length, sections: { configured: sections, present: presentSections, coverage }, required: { count: configuredRequired.length, missing: missingRequired } },
  recommendation: { suggested_tier: suggestedTier },
  recommendations,
}, null, 2));
