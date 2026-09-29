#!/usr/bin/env node
/**
 * 文档结构检查：目录与必需文件、链接、稳定编号、索引与文件一致、AC 映射列、状态词汇、占位符。
 *
 * 用法:
 *   node check-docs.mjs [--root <文档目录>] [--policy docs-policy.json] [--repo <仓库根>] [--strict] [--quiet]
 *
 * 仓库根默认取脚本所在目录的上一级（脚本通常位于 <仓库根>/scripts/），可用 --repo 覆盖；
 * 文档目录默认取 docs-policy.json 的 root 字段（默认 "docs"），可用 --root 临时覆盖。
 *
 * 退出码: 0 = 无错误；1 = 存在错误（警告不阻塞，除非 --strict 或 policy.strict = true）。
 *
 * 边界: 只校验“结构自洽”，不代表交付就绪；证据真实性由项目自己的 docs-gate 负责。
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isExplicitNotApplicable, resolveTierPolicy } from "./policy-utils.mjs";
import { FACT_TYPES, RELATION_TYPES, normalizeRelations, registryNodes, registryRelativePath } from "./facts-utils.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(name);

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(opt("--repo", scriptRoot));
const policyPath = resolve(repoRoot, opt("--policy", "docs-policy.json"));

if (!existsSync(policyPath)) {
  console.error(`[check-docs] 找不到配置：${policyPath}\n可运行 init-docs.mjs 生成，或通过 --policy 指定。`);
  process.exit(1);
}

let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, "utf8"));
} catch (error) {
  console.error(`[check-docs] policy JSON 无效：${error.message}`);
  process.exit(2);
}
if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
  console.error("[check-docs] policy 根节点必须是 JSON 对象");
  process.exit(2);
}
const tier = opt("--tier", policy.tier || "m").toLowerCase();
if (!["s", "m", "l"].includes(tier)) {
  console.error(`[check-docs] --tier 只能是 s / m / l，收到：${tier}`);
  process.exit(2);
}
const activePolicy = resolveTierPolicy(policy, tier);
const cliRoot = opt("--root", null);
const docsRoot = cliRoot ? resolve(repoRoot, cliRoot) : resolve(repoRoot, activePolicy.root || "docs");

if (!existsSync(docsRoot)) {
  console.error(`[check-docs] 找不到文档根目录：${docsRoot}（policy.root=${activePolicy.root || "docs"}）`);
  process.exit(1);
}
if (!statSync(docsRoot).isDirectory()) {
  console.error(`[check-docs] 文档根目录不是目录：${docsRoot}`);
  process.exit(1);
}
try {
  const realRepo = realpathSync(repoRoot);
  const realDocs = realpathSync(docsRoot);
  if (realDocs !== realRepo && !realDocs.startsWith(`${realRepo}${sep}`)) {
    console.error(`[check-docs] 文档根目录必须位于仓库内，且不能通过符号链接越界：${docsRoot}`);
    process.exit(2);
  }
} catch (error) {
  console.error(`[check-docs] 无法解析文档根目录：${error.message}`);
  process.exit(2);
}
const strict = has("--strict") || activePolicy.strict === true;
const quiet = has("--quiet");

const results = [];
const add = (level, file, line, message) =>
  results.push({ level, file, line, message });

/* ---------- 0b. 机器可读事实注册表 ---------- */
const factsConfig = activePolicy.facts || {};
if (factsConfig.enabled === true) {
  const factsFile = resolve(repoRoot, factsConfig.file || "docs-facts.json");
  const factsRel = rel(factsFile);
  if (!existsSync(factsFile)) {
    add("error", factsRel, 0, "facts.enabled=true 但找不到事实注册表");
  } else {
    let registry = null;
    try { registry = JSON.parse(readFileSync(factsFile, "utf8")); }
    catch (error) { add("error", factsRel, 0, `事实注册表 JSON 无效：${error.message}`); }
    const lifecycleValues = new Set(["active", "planned", "deprecated", "archived"]);
    const specValues = new Set(["draft", "ready", "frozen"]);
    const implementationValues = new Set(["planned", "in_progress", "partial", "implemented", "locally_verified", "awaiting_acceptance", "completed", "blocked"]);
    const sliceValues = new Set(["planned", "ready", "frozen", "in_progress", "verified", "completed", "blocked"]);
    const facts = Array.isArray(registry?.facts) ? registry.facts : [];
    const slices = Array.isArray(registry?.slices) ? registry.slices : [];
    if (registry?.$schema !== "spec-docs/facts/v1") add("error", factsRel, 1, "事实注册表 $schema 必须是 spec-docs/facts/v1");
    const factIds = new Map();
    for (const [index, fact] of facts.entries()) {
      const line = index + 1;
      if (!fact || typeof fact !== "object") { add("error", factsRel, line, "facts 条目必须是对象"); continue; }
      if (!fact.id || typeof fact.id !== "string") add("error", factsRel, line, "事实缺少稳定 id");
      else if (factIds.has(fact.id)) add("error", factsRel, line, `事实 ID 重复：${fact.id}`);
      else factIds.set(fact.id, line);
      if (!FACT_TYPES.has(fact.type)) add("error", factsRel, line, `事实 ${fact.id || "<unknown>"} 的 type 无效：${fact.type || "<empty>"}`);
      if (!lifecycleValues.has(fact.lifecycle)) add("error", factsRel, line, `事实 ${fact.id || "<unknown>"} 的 lifecycle 无效：${fact.lifecycle || "<empty>"}`);
      if (!specValues.has(fact.spec_status)) add("error", factsRel, line, `事实 ${fact.id || "<unknown>"} 的 spec_status 无效：${fact.spec_status || "<empty>"}`);
      if (!implementationValues.has(fact.implementation_status)) add("error", factsRel, line, `事实 ${fact.id || "<unknown>"} 的 implementation_status 无效：${fact.implementation_status || "<empty>"}`);
      if (!["active", "future"].includes(fact.delivery_scope)) add("error", factsRel, line, `事实 ${fact.id || "<unknown>"} 的 delivery_scope 必须是 active 或 future`);
      if (!fact.delivery_slice || typeof fact.delivery_slice !== "string") add("error", factsRel, line, `事实 ${fact.id || "<unknown>"} 缺少 delivery_slice`);
      const authority = registryRelativePath(repoRoot, fact.authority);
      if (!authority) add("error", factsRel, line, `事实 ${fact.id || "<unknown>"} 的 authority 必须是仓库内文件路径`);
      else if (!existsSync(authority)) add("error", factsRel, line, `事实 ${fact.id} 的 authority 不存在：${fact.authority}`);
      if (!Array.isArray(fact.references) || !Array.isArray(fact.evidence)) add("error", factsRel, line, `事实 ${fact.id || "<unknown>"} 的 references/evidence 必须是数组`);
      if (fact.delivery_scope === "future" && fact.implementation_status === "completed") add("error", factsRel, line, `未来事实不能标记 implementation_status=completed：${fact.id}`);
    }
    const sliceIds = new Map();
    for (const [index, slice] of slices.entries()) {
      const line = index + 1;
      if (!slice || typeof slice !== "object") { add("error", factsRel, line, "slices 条目必须是对象"); continue; }
      if (!slice.id || typeof slice.id !== "string") add("error", factsRel, line, "切片缺少稳定 id");
      else if (sliceIds.has(slice.id)) add("error", factsRel, line, `切片 ID 重复：${slice.id}`);
      else sliceIds.set(slice.id, line);
      if (!sliceValues.has(slice.status)) add("error", factsRel, line, `切片 ${slice.id || "<unknown>"} 的 status 无效：${slice.status || "<empty>"}`);
      if (!Array.isArray(slice.features) || !Array.isArray(slice.depends_on) || !Array.isArray(slice.evidence)) add("error", factsRel, line, `切片 ${slice.id || "<unknown>"} 的 features/depends_on/evidence 必须是数组`);
      const authority = registryRelativePath(repoRoot, slice.authority);
      if (!authority) add("error", factsRel, line, `切片 ${slice.id || "<unknown>"} 的 authority 必须是仓库内文件路径`);
      else if (!existsSync(authority)) add("error", factsRel, line, `切片 ${slice.id} 的 authority 不存在：${slice.authority}`);
      for (const factId of slice.features || []) if (!factIds.has(factId)) add("error", factsRel, line, `切片 ${slice.id} 引用了未登记事实：${factId}`);
      for (const dependency of slice.depends_on || []) if (!sliceIds.has(dependency)) add("warn", factsRel, line, `切片 ${slice.id} 依赖的切片尚未登记：${dependency}`);
    }
    for (const fact of facts) if (fact.delivery_slice && !sliceIds.has(fact.delivery_slice)) add("error", factsRel, factIds.get(fact.id) || 0, `事实 ${fact.id} 引用了未登记切片：${fact.delivery_slice}`);
    const nodes = registryNodes(registry);
    for (const [index, relation] of normalizeRelations(registry).entries()) {
      const line = index + 1;
      if (!RELATION_TYPES.has(relation.type)) add("error", factsRel, line, `关系类型无效：${relation.type}`);
      if (!nodes.has(relation.from) || !nodes.has(relation.to)) add("error", factsRel, line, `关系端点不存在：${relation.from} -> ${relation.to}`);
      if (relation.authority && !registryRelativePath(repoRoot, relation.authority)) add("error", factsRel, line, `关系 authority 必须是仓库内路径：${relation.authority}`);
    }
  }
}

function rel(abs) {
  return relative(repoRoot, abs).split(sep).join("/");
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const abs = join(dir, entry);
    const info = lstatSync(abs);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

function markdownTables(text) {
  const tables = [];
  let rows = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim().startsWith("|")) rows.push({ cells: line.trim().split("|").slice(1, -1).map((cell) => cell.trim()), line: index + 1 });
    else if (rows.length) {
      if (rows.length > 1) tables.push({ header: rows[0].cells, rows: rows.slice(2) });
      rows = [];
    }
  }
  if (rows.length > 1) tables.push({ header: rows[0].cells, rows: rows.slice(2) });
  return tables;
}

function tableWithColumns(body, columns) {
  return markdownTables(body || "").find((table) => columns.every((column) => table.header.includes(column))) || null;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/);
    if (!item) continue;
    let value = item[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[item[1]] = value;
  }
  return values;
}

function sectionBody(lines, heading) {
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+/.test(line) && line.includes(heading));
  if (headingIndex < 0) return null;
  const headingLevel = lines[headingIndex].match(/^(#+)/)?.[1].length || 1;
  let end = headingIndex + 1;
  while (end < lines.length) {
    const match = lines[end].match(/^(#+)\s+/);
    if (match && match[1].length <= headingLevel) break;
    end += 1;
  }
  return lines.slice(headingIndex + 1, end).join("\n").trim();
}

function hasNotApplicableReason(body) {
  return isExplicitNotApplicable(body);
}

function meaningfulBody(body) {
  if (!body) return false;
  const cleaned = body.replace(/<!--[^]*?-->/g, "").replace(/<[^>]+>/g, "").trim();
  return cleaned.length >= 20 && !/^不适用[。！？!]?$/u.test(cleaned);
}

function collectOpenApiOperationIds(file) {
  if (!file || !existsSync(file)) return new Set();
  const ids = new Set();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*operationId\s*:\s*([A-Za-z0-9_.-]+)/);
    if (match) ids.add(match[1]);
  }
  return ids;
}

const decode = (s) => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};

function isIgnored(file) {
  const relPath = relative(docsRoot, file).split(sep).join("/");
  return (activePolicy.ignoreLinksIn || []).some((p) => relPath.startsWith(p));
}

/* ---------- 0. 版本规划完整性 ---------- */

function roadmapVersions(text, versionConfig) {
  const versionPattern = versionConfig.versionPattern || "V\\d+";
  const versionRe = new RegExp(`^${versionPattern}$`);
  const versions = new Map();
  for (const table of markdownTables(text)) {
    const versionIndex = table.header.findIndex((cell) => cell === "版本");
    if (versionIndex < 0) continue;
    const statusIndex = table.header.findIndex((cell) => cell === "状态");
    for (const row of table.rows) {
      const version = String(row.cells[versionIndex] || "")
        .replace(/[`"']/g, "")
        .trim();
      if (!versionRe.test(version)) continue;
      const status = statusIndex >= 0 ? String(row.cells[statusIndex] || "").trim() : "";
      const existing = versions.get(version);
      if (!existing || (!existing.status && status)) versions.set(version, { status, line: row.line });
    }
  }
  return versions;
}

function linkedTargets(file) {
  if (!file || !existsSync(file)) return new Set();
  const linked = new Set();
  const text = readFileSync(file, "utf8");
  let match;
  const localLinkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((match = localLinkRe.exec(text))) {
    const target = match[1].split("#")[0].split("?")[0].trim();
    if (!target || target.includes("{{") || /^(https?:|mailto:|#|data:)/.test(target)) continue;
    const abs = target.startsWith("/") ? resolve(repoRoot, "." + target) : resolve(dirname(file), decode(target));
    if (existsSync(abs) && !statSync(abs).isDirectory()) linked.add(rel(abs));
  }
  return linked;
}

function resolveLocalLink(file, target) {
  if (!target || target.includes("{{") || /^(https?:|mailto:|#|data:)/.test(target)) return null;
  const clean = decode(target.split("#")[0].split("?")[0].trim());
  if (!clean) return null;
  const abs = clean.startsWith("/") ? resolve(repoRoot, "." + clean) : resolve(dirname(file), clean);
  if (!existsSync(abs) || statSync(abs).isDirectory()) return null;
  return { abs, rel: rel(abs) };
}

function featureSourceLink(text) {
  const links = [...String(text || "").matchAll(/\[([^\]]+)\]\(([^)\s]+)/g)];
  const preferred = links.find((match) => /来源|需求|功能主文档|功能文档|主功能/.test(match[1]));
  return (preferred || null)?.[2] || null;
}

function rowCell(row, header, name) {
  const index = header.indexOf(name);
  return index < 0 ? "" : String(row.cells[index] || "").trim();
}

const traceColumnAliases = {
  "需求范围": ["需求范围", "稳定需求范围", "范围"],
  "关键接口": ["关键接口", "关键协议/接口", "接口", "API"],
  "关键数据": ["关键数据", "数据", "关键数据对象"],
  "跨功能验收": ["跨功能验收", "E2E", "主要 AC/E2E/NFR"],
};

function headerIndex(header, name) {
  return (traceColumnAliases[name] || [name]).findIndex((candidate) => header.includes(candidate)) >= 0
    ? header.findIndex((cell) => (traceColumnAliases[name] || [name]).includes(cell))
    : -1;
}

function cleanCell(value) {
  return String(value || "").replace(/[\\`"']/g, "").trim();
}

function hasHeading(lines, heading) {
  return lines.some((line) => /^#{1,6}\s+/.test(line) && line.includes(heading));
}

function hasHeadingAlternative(lines, heading) {
  const alternatives = {
    "单元契约": ["单元契约", "核心契约", "核心入口", "责任边界"],
    "伪代码": ["伪代码", "核心伪代码", "执行逻辑"],
    "分支到测试追踪": ["分支到测试追踪", "关键分支", "稳定设计分支"],
    "约束备注": ["约束备注", "安全边界", "运行、权限和失败", "约束与不变量"],
  };
  return (alternatives[heading] || [heading]).some((candidate) => hasHeading(lines, candidate));
}

function comparableTitle(value) {
  return String(value || "")
    .replace(/^\s*\d+\s+/, "")
    .replace(/[：:。！!？?]+$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractIds(text, pattern) {
  if (!pattern) return [];
  const re = new RegExp(pattern, "g");
  return [...text.matchAll(re)].map((match) => match[0]);
}

function e2eIdVariants(id) {
  const value = cleanCell(id);
  const match = value.match(/^(V\d+-)?E2E-?(\d{2}[A-Z]?)$/i);
  if (!match) return [value];
  const version = match[1] || "";
  const number = match[2].toUpperCase();
  return [...new Set([
    value,
    `${version}E2E-${number}`,
    `${version}E2E${number}`,
    `E2E-${number}`,
    `E2E${number}`,
  ])];
}

function canonicalE2eId(value, activeVersion) {
  const match = String(value || "").match(/\b(?:(V\d+)-)?E2E-?(\d{2}[A-Z]?)\b/i);
  return match ? `${match[1] || activeVersion}-E2E-${match[2].toUpperCase()}` : null;
}

const versionPlan = {
  enabled: true,
  roadmap: "02-产品与版本/版本路线图.md",
  index: "02-产品与版本/后续版本/README.md",
  directory: "02-产品与版本/后续版本",
  // 允许“V2-规划.md”和“V2-稳定网关.md”等主题化主文档；版本号必须是第一个捕获组。
  filePattern: "^(V\\d+)(?:-.+)?\\.md$",
  versionCapture: 1,
  planningStatuses: ["规划骨架", "门禁评审中"],
  activeVersionExempt: true,
  requireIndexLink: true,
  requiredSections: [],
  ...(activePolicy.versionPlanning || {}),
};
if (versionPlan.enabled !== false) {
  const roadmapFile = join(docsRoot, versionPlan.roadmap);
  const indexFile = join(docsRoot, versionPlan.index);
  if (!existsSync(roadmapFile)) {
    add("error", rel(roadmapFile), 0, "版本规划校验找不到路线图文件");
  } else {
    const versions = roadmapVersions(readFileSync(roadmapFile, "utf8"), versionPlan);
    const fileRe = new RegExp(versionPlan.filePattern);
    const directory = join(docsRoot, versionPlan.directory);
    const candidates = new Map();
    for (const file of walk(directory)) {
      const name = file.split(sep).pop();
      const match = name.match(fileRe);
      if (!match) continue;
      const version = match[versionPlan.versionCapture ?? 1];
      if (!version) continue;
      const existing = candidates.get(version);
      if (existing) {
        add("error", rel(file), 1, `${version} 存在多个规划主文档：${rel(existing)} 与 ${rel(file)}；每个版本只能有一个主文档`);
      } else {
        candidates.set(version, file);
      }
    }
    const linked = versionPlan.requireIndexLink ? linkedTargets(indexFile) : new Set();
    for (const [version, details] of versions) {
      if (versionPlan.activeVersionExempt && version === activePolicy.activeVersion) continue;
      if (details.status && !(versionPlan.planningStatuses || []).includes(details.status)) continue;
      const expected = candidates.get(version);
      if (!expected) {
        add("error", rel(roadmapFile), details.line, `${version} 在路线图中处于规划状态，但缺少独立规划主文档：${versionPlan.directory}/${version}-<主题>.md`);
        continue;
      }
      const expectedRel = rel(expected);
      if (versionPlan.requireIndexLink && !linked.has(expectedRel)) {
        add("error", rel(indexFile), 0, `${version} 规划文档未登记到后续版本索引：${expectedRel}`);
      }
      const source = readFileSync(expected, "utf8");
      if (!new RegExp(`^#\\s+.*\\b${version}\\b`, "m").test(source)) {
        add("error", expectedRel, 1, `规划主文档标题必须包含版本号：${version}`);
      }
      for (const heading of versionPlan.requiredSections || []) {
        const hasHeading = source.split(/\r?\n/).some((line) => /^#{1,4}\s+/.test(line) && line.includes(heading));
        if (!hasHeading) add("error", expectedRel, 0, `版本规划缺少章节：${heading}`);
      }
    }
  }
}

/* ---------- 1. 必需文件与 section README ---------- */

for (const req of activePolicy.required || []) {
  const abs = join(docsRoot, req);
  if (!existsSync(abs)) add("error", rel(abs), 0, "缺少必需文件");
}
for (const section of activePolicy.sections || []) {
  const dir = join(docsRoot, section);
  if (!existsSync(dir)) {
    add("error", rel(dir), 0, "缺少一级目录");
  } else if (!existsSync(join(dir, "README.md"))) {
    add("error", rel(join(dir, "README.md")), 0, "一级目录缺少 README.md");
  }
}

/* ---------- 2. 链接解析 ---------- */

const mdFiles = walk(docsRoot).filter((f) => f.endsWith(".md"));
const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

for (const file of mdFiles) {
  if (isIgnored(file)) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  let inFence = false;
  lines.forEach((text, idx) => {
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    let m;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(text))) {
      let target = m[1];
      if (/^(https?:|mailto:|#|data:)/.test(target)) continue;
      if (target.includes("{{")) continue;
      target = decode(target.split("#")[0].split("?")[0].trim());
      if (!target) continue;
      const abs = target.startsWith("/")
        ? resolve(repoRoot, "." + target)
        : resolve(dirname(file), target);
      if (!existsSync(abs)) {
        add("error", rel(file), idx + 1, `链接目标不存在：${target}`);
        continue;
      }
      const relToDocs = relative(docsRoot, abs).split(sep).join("/");
      const fileInDocs = relative(docsRoot, file).split(sep).join("/");
      const archiveNavigation = ["99-历史归档/README.md", "99-历史归档/文档迁移映射.md"].includes(relToDocs);
      if (relToDocs.startsWith("99-历史归档") && !archiveNavigation && !fileInDocs.startsWith("99-历史归档")) {
        add("warn", rel(file), idx + 1, `当前文档引用了历史归档：${target}`);
      }
    }
  });
}

/* ---------- 3. 稳定编号与追踪 ---------- */

const idRe = (name) => (activePolicy.ids?.[name] ? new RegExp(activePolicy.ids[name], "g") : null);
const collect = (file, name) => {
  const re = idRe(name);
  if (!re || !existsSync(file)) return [];
  const found = [];
  for (const table of markdownTables(readFileSync(file, "utf8"))) {
    if (table.header[0] !== "编号" && table.header[0] !== "稳定需求 ID") continue;
    for (const row of table.rows) {
      re.lastIndex = 0;
      const match = (row.cells[0] || "").replace(/[`"']/g, "").match(re);
      if (match) found.push({ id: match[0], line: row.line, text: row.cells[0] });
    }
  }
  return found;
};

const [numberingFile, matrixFile] = (activePolicy.traceability || []).map((p) => join(docsRoot, p));
const registeredRequirements = new Set();
if (numberingFile && existsSync(numberingFile)) {
  const seen = new Map();
  for (const { id, line } of collect(numberingFile, "requirement")) {
    if (seen.has(id)) add("error", rel(numberingFile), line, `编号重复出现：${id}（首次出现在第 ${seen.get(id)} 行）`);
    else seen.set(id, line);
  }
  for (const id of seen.keys()) registeredRequirements.add(id);
  if (matrixFile && existsSync(matrixFile)) {
    const matrixIds = new Map();
    for (const { id, line } of collect(matrixFile, "requirement")) {
      if (matrixIds.has(id)) add("error", rel(matrixFile), line, `追踪矩阵编号重复：${id}`);
      else matrixIds.set(id, line);
    }
    const inMatrix = new Set(matrixIds.keys());
    for (const [id, line] of seen) {
      if (!inMatrix.has(id)) add("error", rel(numberingFile), line, `追踪矩阵缺少需求：${id}`);
    }
    for (const [id, line] of matrixIds) {
      if (!seen.has(id)) add("warn", rel(matrixFile), line, `矩阵中出现未登记编号：${id}`);
    }
  }
}
const decisionFile = join(docsRoot, "06-决策记录", `${activePolicy.activeVersion}-冻结决策.md`);
if (existsSync(decisionFile)) {
  const seen = new Map();
  const decisionRe = activePolicy.ids?.decision ? new RegExp(`^#{2,4}\\s+(${activePolicy.ids.decision})\\b`) : null;
  readFileSync(decisionFile, "utf8").split(/\r?\n/).forEach((text, index) => {
    const match = decisionRe && text.match(decisionRe);
    if (!match) return;
    const id = match[1];
    const line = index + 1;
    if (seen.has(id)) add("error", rel(decisionFile), line, `决策编号重复：${id}`);
    else seen.set(id, line);
  });
}

/* ---------- 3b. 增量变更切片 ---------- */
const changeSlice = activePolicy.changeSlice;
if (changeSlice?.dir) {
  const sliceDir = join(docsRoot, changeSlice.dir.replaceAll("{{活跃版本}}", activePolicy.activeVersion || ""));
  const slicePattern = new RegExp((changeSlice.filePattern || `^${activePolicy.activeVersion}-CS-\\d{3}-.+\\.md$`).replaceAll("{{活跃版本}}", activePolicy.activeVersion || ""));
  const requiredSliceSections = changeSlice.requiredSections || ["元数据", "基线与目标", "影响清单", "验收与证据", "回写清单"];
  const sliceIdRe = new RegExp(`\\b${activePolicy.activeVersion}-CS-\\d{3}\\b`);
  for (const file of walk(sliceDir)) {
    const name = file.split(sep).pop();
    if (!name.endsWith(".md") || name === "README.md") continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    const text = lines.join("\n");
    const relFile = rel(file);
    if (!slicePattern.test(name)) add("error", relFile, 1, `变更切片文件名不符合规则：${changeSlice.filePattern || "<默认 Vx-CS-NNN-标题.md>"}`);
    if (!sliceIdRe.test(text) || !new RegExp(`\\b${activePolicy.activeVersion}-CS-\\d{3}\\b`).test(name)) {
      add("error", relFile, 1, "变更切片必须包含与文件名一致的稳定 Vx-CS-NNN ID");
    }
    for (const heading of requiredSliceSections) {
      if (!sectionBody(lines, heading)) add("error", relFile, 1, `变更切片缺少必需章节：${heading}`);
    }
    const metadata = sectionBody(lines, "元数据") || "";
    if (!new RegExp(`\\b${activePolicy.activeVersion}-FR-\\d{3}\\b`).test(metadata)) {
      add("error", relFile, 1, "变更切片元数据必须引用至少一个主功能 ID");
    }
    const impact = sectionBody(lines, "影响清单") || "";
    if (!tableWithColumns(impact, ["类型", "资产", "变化", "负责人", "状态"])) {
      add("error", relFile, 1, "变更切片影响清单缺少必需表格列");
    }
    const acceptance = sectionBody(lines, "验收与证据") || "";
    if (!tableWithColumns(acceptance, ["AC", "断言", "测试层级", "命令", "证据路径", "状态"])) {
      add("error", relFile, 1, "变更切片验收与证据缺少必需表格列");
    }
  }
}

/* ---------- 4. 功能文档 ---------- */

const featureDocs = [];
const featureIds = new Map();
const spec = activePolicy.featureDoc;
if (spec?.dir) {
  const dir = join(docsRoot, spec.dir);
  const quality = {
    enabled: true,
    strict: true,
    allowNotApplicable: true,
    minimumInterfaceTables: ["接口清单", "OpenAPI operation 映射", "错误矩阵"],
    minimumDataSections: ["涉及数据", "约束与事务", "字段读写矩阵", "状态与生命周期", "物理约束与迁移", "数据所有权", "安全与保留"],
    requiredMetadata: ["title", "version", "feature_id", "domain", "updated", "delivery_scope", "planning_only", "delivery_slice"],
    requireFeatureTitle: true,
    requireSourceTrace: true,
    traceability: {
      enabled: true,
      requireFeatureLink: true,
      requireMappedColumns: ["需求范围", "关键接口", "关键数据", "跨功能验收"],
    },
    technicalDesign: {
      enabled: true,
      requiredSections: ["单元契约", "伪代码", "分支到测试追踪", "约束备注"],
      requireFeatureId: true,
      requireSourceFeature: true,
      requireBranchAcMapping: true,
    },
    e2e: {
      enabled: true,
      matrix: "05-测试与发布/端到端验收/用例矩阵.md",
      specification: `05-测试与发布/端到端验收/${activePolicy.activeVersion}-端到端验收规范.md`,
      requiredColumns: ["功能 ID", "AC", "真实入口", "必须真实的本系统依赖", "断言事实类型", "最终业务断言", "目标测试文件", "环境", "日期", "代码版本", "命令", "证据路径", "限制", "当前证据状态"],
      requireReferencedIds: true,
    },
    performance: {
      enabled: true,
      matrix: "05-测试与发布/性能与容量/场景矩阵.md",
      requiredColumns: ["目标", "最低环境", "关键断言", "必要证据", "当前状态"],
    },
    adr: {
      enabled: true,
      directory: "06-决策记录/ADR",
      excludePattern: "^0001-决策标题\\.md$",
      requiredSections: ["背景", "备选方案", "决策", "后果", "验证"],
    },
    productDocs: {
      enabled: true,
      blueprint: "02-产品与版本/产品蓝图.md",
      prd: "02-产品与版本/当前版本/{{活跃版本}}-产品需求.md",
    },
    ...(activePolicy.quality || {}),
  };
  const qualityEnabled = quality.enabled !== false;
  const qualityLevel = (message) => {
    add(has("--strict") && quality.strict !== false ? "error" : "warn", message.file, message.line || 0, message.text);
  };
  if (qualityEnabled && quality.productDocs?.enabled !== false) {
    const productFiles = [
      {
        path: (quality.productDocs.blueprint || "02-产品与版本/产品蓝图.md").replaceAll("{{活跃版本}}", activePolicy.activeVersion),
        sections: ["角色场景矩阵", "核心业务流程", "能力地图", "非功能目标", "风险与未决问题"],
        tables: [
          ["指标目标", ["指标", "适用版本", "当前基线", "目标", "口径与样本", "验证方式"]],
          ["角色场景矩阵", ["角色", "目标与触发", "当前障碍", "期望结果", "适用版本", "关联能力"]],
          ["核心业务流程", ["流程", "参与角色", "触发与前提", "主要步骤", "成功终态", "失败与恢复", "适用版本"]],
          ["能力地图", ["能力域", "解决的场景", "依赖与边界", "首次交付版本", "权威规格"]],
          ["风险与未决问题", ["风险/问题", "影响的角色与场景", "应对或验证动作", "责任角色", "决策位置"]],
          ["核心业务概念", ["概念 ID", "概念", "定义", "边界与易混项", "首次适用版本"]],
          ["核心概念", ["概念 ID", "概念", "定义", "边界与易混项", "首次适用版本"]],
          ["成功标准", ["成功标准 ID", "可观察结果", "指标/口径", "关联能力或功能", "验证方式与证据", "责任人", "状态"]],
        ],
      },
      {
        path: (quality.productDocs.prd || "02-产品与版本/当前版本/{{活跃版本}}-产品需求.md").replaceAll("{{活跃版本}}", activePolicy.activeVersion),
        sections: ["核心链路", "页面需求", "跨功能业务规则", "版本验收场景", "交付顺序与依赖"],
        tables: [
          ["页面需求", ["页面/入口", "角色与主要任务", "可见条件", "成功反馈", "空态/加载态/错误态", "关联功能"]],
          ["跨功能业务规则", ["规则", "适用场景", "失败时产品行为", "权威功能/决策"]],
          ["版本验收场景", ["场景", "真实入口与前提", "成功终态", "关键失败断言", "功能 ID", "E2E/门禁与证据"]],
          ["非功能需求", ["编号", "需求", "目标与阈值", "基线", "测量窗口/环境", "负责人", "验证方式与证据"]],
          ["交付顺序与依赖", ["阶段", "功能 ID", "必须先具备", "可验收产物", "AC", "E2E", "负责人", "完成定义/证据", "后置能力"]],
          ["发布门禁", ["编号", "条件", "责任人", "阻塞级别", "证据类型与位置", "失败处理"]],
        ],
      },
    ];
    for (const product of productFiles) {
      const file = join(docsRoot, product.path);
      if (!existsSync(file)) continue;
      const source = readFileSync(file, "utf8");
      const lines = source.split(/\r?\n/);
      const fileName = rel(file);
      for (const heading of product.sections) {
        if (!sectionBody(lines, heading)) qualityLevel({ file: fileName, text: `产品文档缺少可评审章节：${heading}` });
      }
      for (const [heading, columns] of product.tables) {
        const body = sectionBody(lines, heading);
        if (body && !tableWithColumns(body, columns)) {
          qualityLevel({ file: fileName, text: `${heading} 缺少结构化视图或必需列：${columns.join("、")}` });
        }
      }
      if (product.path.endsWith("-产品需求.md")) {
        const flow = sectionBody(lines, "核心链路") || "";
        const flowHeadings = [...flow.matchAll(/^###\s+(.+)$/gm)].map((match) => match[1]);
        if (!flowHeadings.length) qualityLevel({ file: fileName, text: "核心链路至少按场景拆分，并说明成功与失败路径" });
        for (const heading of flowHeadings) {
          const body = sectionBody(lines, heading) || "";
          if (!tableWithColumns(body, ["参与角色", "触发与前提", "成功终态", "失败与恢复", "关联功能", "验收入口"]) || !/^\d+\.\s+/m.test(body)) {
            qualityLevel({ file: fileName, text: `核心链路 ${heading} 缺少场景信息表或有序步骤` });
          }
        }
        const current = activePolicy.activeVersion;
        for (const heading of ["功能分层", "页面需求", "版本验收场景"]) {
          const body = sectionBody(lines, heading) || "";
          if ([...body.matchAll(/\bV\d+\b/g)].some((match) => match[0] !== current)) {
            qualityLevel({ file: fileName, text: `${heading} 混入非当前版本能力；将其移到不做范围/后续版本，并标明归属` });
          }
        }
        for (const [heading, featureColumn, e2eColumn] of [
          ["核心链路", "关联功能", "验收入口"],
          ["页面需求", "关联功能", null],
          ["版本验收场景", "功能 ID", "E2E/门禁与证据"],
        ]) {
          const body = sectionBody(lines, heading) || "";
          for (const table of markdownTables(body)) {
            const featureIndex = table.header.indexOf(featureColumn);
            if (featureIndex < 0) continue;
            const e2eIndex = e2eColumn ? table.header.indexOf(e2eColumn) : -1;
            for (const row of table.rows) {
              if (row.cells.some((cell) => /<[^>]+>|\{\{[^}]+\}\}/.test(cell))) continue;
              const ids = [...(row.cells[featureIndex] || "").matchAll(/V\d+-FR-\d{3}/g)].map((match) => match[0]);
              if (!ids.length || ids.some((id) => !id.startsWith(`${activePolicy.activeVersion}-`) || !registeredRequirements.has(id))) {
                qualityLevel({ file: fileName, text: `${heading} 有场景未关联已登记的当前版本功能 ID` });
              }
              if (e2eIndex >= 0 && !/V\d+-E2E-\d{2}[A-Z]?/.test(row.cells[e2eIndex] || "")) {
                qualityLevel({ file: fileName, text: `${heading} 有场景缺少稳定 E2E 验收编号` });
              }
            }
          }
        }
      }
    }
  }
  const openapiRel = activePolicy.openapi || "04-技术架构/当前版本/{{活跃版本}}-openapi.yaml";
  const openapiPath = resolve(docsRoot, openapiRel.replace("{{活跃版本}}", activePolicy.activeVersion || ""));
  const openapiOperationIds = collectOpenApiOperationIds(openapiPath);
  if (activePolicy.requireDeliveryMetadata === undefined) {
    add("warn", rel(policyPath), 0, "旧版 policy 未显式配置 requireDeliveryMetadata；当前暂按兼容模式运行，请补充该字段后再启用严格交付范围门禁");
  }
  const statusFile = join(docsRoot, "02-产品与版本", "当前版本", `${activePolicy.activeVersion}-实现状态.md`);
  const implementationStates = new Map();
  if (existsSync(statusFile)) {
    for (const table of markdownTables(readFileSync(statusFile, "utf8"))) {
      const idIndex = table.header.indexOf("功能 ID");
      const stateIndex = table.header.indexOf("实现状态");
      if (idIndex === -1 || stateIndex === -1) continue;
      for (const row of table.rows) {
        const id = (row.cells[idIndex] || "").replace(/[`"']/g, "").trim();
        const state = row.cells[stateIndex] || "";
        if (!id) continue;
        if (implementationStates.has(id)) add("error", rel(statusFile), row.line, `功能状态重复登记：${id}`);
        else implementationStates.set(id, { state, line: row.line });
        if (!(spec.statusValues || []).includes(state)) add("error", rel(statusFile), row.line, `未知实现状态：${state || "<空>"}`);
      }
    }
  }
  const fileRe = new RegExp(spec.filePattern);
  const excludeRe = spec.excludePattern ? new RegExp(spec.excludePattern) : null;
  for (const file of walk(dir)) {
    const name = file.split(sep).pop();
    if (!name.endsWith(".md")) continue;
    if (!fileRe.test(name)) continue;
    if (excludeRe && excludeRe.test(name)) continue;
    featureDocs.push(file);
  }
  for (const file of featureDocs) {
    const relFile = rel(file);
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    const text = lines.join("\n");

    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let metadata = null;
    if (!frontmatter) {
      add("error", relFile, 1, "功能文档缺少 YAML frontmatter");
    } else {
      metadata = parseFrontmatter(text);
      for (const key of quality.requiredMetadata || []) {
        const value = metadata?.[key];
        if (!value || /[<>{}]/.test(value)) qualityLevel({ file: relFile, text: `功能文档元数据缺失或仍是占位符：${key}` });
      }
      const escapedTitle = String(metadata?.title || "").replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
      const firstHeading = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "");
      if (quality.requireFeatureTitle && escapedTitle && comparableTitle(firstHeading) !== comparableTitle(metadata?.title)) {
        qualityLevel({ file: relFile, text: "功能文档一级标题必须与 frontmatter.title 对齐（允许文件编号前缀不同）" });
      }
      if (quality.requireSourceTrace) {
        const sourceBody = sectionBody(lines, "来源与追踪") || "";
        if (!sourceBody || !sourceBody.includes(String(metadata?.feature_id || ""))) {
          qualityLevel({ file: relFile, text: "来源与追踪必须包含本功能 feature_id" });
        }
      }
      const featureId = frontmatter[1].match(/^feature_id:\s*([^\s#]+)/m)?.[1];
      const featureIdRe = activePolicy.ids?.requirement ? new RegExp(activePolicy.ids.requirement) : null;
      if (!featureId || !featureIdRe?.test(featureId.replace(/[`"']/g, ""))) {
        add("error", relFile, 1, "功能文档 feature_id 缺失或格式无效");
      } else if (numberingFile && existsSync(numberingFile) && !registeredRequirements.has(featureId.replace(/[`"']/g, ""))) {
        add("error", relFile, 1, `功能编号未登记到需求编号表：${featureId}`);
      } else if (featureIds.has(featureId)) {
        add("error", relFile, 1, `功能编号重复：${featureId}（首次出现在 ${featureIds.get(featureId)}）`);
      } else {
        featureIds.set(featureId, relFile);
      }
      if (/^status:/m.test(frontmatter[1])) {
        add("error", relFile, 1, "实现状态只能维护在版本实现状态文档，不得复制到功能 frontmatter");
      }
      const featureCard = sectionBody(lines, "功能卡") || "";
      const implementationStatusRow = markdownTables(featureCard).some((table) =>
        table.rows.some((row) => row.cells[0]?.trim() === "状态" && /基础实现|部分实现|实现中|开发中|Local Verified|已完成|待验收|阻塞/i.test(row.cells[1] || "")),
      );
      if (implementationStatusRow) {
        add("error", relFile, 1, "功能卡重复记录实现状态；请迁移到版本实现状态表，功能卡只保留“规格状态”");
      }
      const cleanId = featureId?.replace(/[`"']/g, "");
      if (cleanId && !implementationStates.has(cleanId)) {
        add("error", relFile, 1, `功能未登记到版本实现状态：${cleanId}`);
      }

      if (activePolicy.requireDeliveryMetadata === true) {
        const scope = metadata?.delivery_scope;
        const planningOnly = metadata?.planning_only;
        const slice = metadata?.delivery_slice;
        if (!["active", "future"].includes(scope)) add("error", relFile, 1, "功能文档 delivery_scope 必须是 active 或 future");
        if (!/^(true|false)$/i.test(String(planningOnly || ""))) add("error", relFile, 1, "功能文档 planning_only 必须是 true 或 false");
        if (!slice || /[<>{}]/.test(slice)) add("error", relFile, 1, "功能文档 delivery_slice 必须填写交付切片");
        if (scope === "active" && String(planningOnly).toLowerCase() === "true") {
          add("error", relFile, 1, "active 功能不能同时标记 planning_only=true");
        }
        if (scope === "future" || String(planningOnly).toLowerCase() === "true") {
          if (cleanId && implementationStates.has(cleanId)) add("error", relFile, 1, `规划功能不得登记到当前版本实现状态：${cleanId}`);
          if (cleanId && !new RegExp(`^V\\d+-`).test(cleanId)) add("error", relFile, 1, `规划功能编号必须带版本前缀：${cleanId}`);
        }
        if (cleanId && !cleanId.startsWith(`${activePolicy.activeVersion}-`) && (scope === "active" || String(planningOnly).toLowerCase() === "false")) {
          add("error", relFile, 1, `当前版本功能不能混入其他版本编号：${cleanId}`);
        }
      }
    }

    for (const section of spec.sections || []) {
      const ok = lines.some((l) => /^#{1,3}\s/.test(l) && l.includes(section));
      if (!ok) add("error", relFile, 0, `功能文档缺少章节：${section}`);
    }

    const acRe = idRe("acceptance");
    const acHeadingRe = /^#{3,4}\s+(AC\d{2})\b/;
    const acs = new Map();
    lines.forEach((line, idx) => {
      const match = line.match(acHeadingRe);
      if (!match || !activePolicy.ids?.acceptance || !new RegExp(activePolicy.ids.acceptance).test(match[1])) return;
      if (metadata?.delivery_scope === "active" && [...line.matchAll(/\bV\d+\b/g)].some((version) => version[0] !== activePolicy.activeVersion)) {
        qualityLevel({ file: relFile, line: idx + 1, text: `${match[1]} 标题指向未来版本；迁移到对应版本规格，不能计入当前版本 AC` });
      }
      if (acs.has(match[1])) add("error", relFile, idx + 1, `AC 编号重复：${match[1]}`);
      else acs.set(match[1], idx);
    });
    if (acRe && acs.size === 0) add("warn", relFile, 0, "功能文档没有任何 AC");

    for (const [ac, start] of acs) {
      let end = start + 1;
      while (end < lines.length && !/^#{1,4}\s/.test(lines[end])) end += 1;
      const body = lines.slice(start + 1, end).join("\n");
      for (const keyword of ["Given", "When", "Then"]) {
        if (!new RegExp(`^${keyword}\\b`, "m").test(body)) {
          add("error", relFile, start + 1, `${ac} 缺少 Given/When/Then 的 ${keyword} 条件`);
        }
      }
    }

    const headerLine = lines.find(
      (l) => l.trim().startsWith("|") && (spec.acColumns || []).every((c) => l.includes(c)),
    );
    if (acRe && acs.size > 0 && !headerLine) {
      add("error", relFile, 0, `AC 表缺少列：${(spec.acColumns || []).join(" / ")}`);
    }

    if (acs.size > 0) {
      const mapped = new Set();
      for (const table of markdownTables(text)) {
        if (!(spec.acColumns || []).every((column) => table.header.includes(column))) continue;
        for (const row of table.rows) {
          for (const match of row.cells.join(" ").matchAll(/AC\d{2}/g)) mapped.add(match[0]);
        }
      }
      for (const ac of acs.keys()) {
        if (!mapped.has(ac)) add("error", relFile, acs.get(ac) + 1, `${ac} 未映射到包含必需列的 AC 测试表`);
      }
    }

    if (qualityEnabled) {
      const interfaceBody = sectionBody(lines, "接口契约");
      const dataBody = sectionBody(lines, "数据与事务");
      const interfaceNA = hasNotApplicableReason(interfaceBody);
      const dataNA = hasNotApplicableReason(dataBody);
      const interfaceSections = quality.minimumInterfaceTables || [];
      const dataSections = quality.minimumDataSections || [];

      if (!interfaceNA) {
        for (const heading of interfaceSections) {
          if (!sectionBody(lines, heading)) qualityLevel({ file: relFile, text: `接口契约缺少可审计小节：${heading}` });
        }
        const mapping = sectionBody(lines, "OpenAPI operation 映射") || "";
        const referenced = [...mapping.matchAll(/\b[A-Za-z][A-Za-z0-9_.-]{2,}\b/g)].map((match) => match[0]);
        const knownReferenced = referenced.filter((id) => openapiOperationIds.has(id));
        const candidateIds = referenced.filter((id) => !["POST", "GET", "PUT", "PATCH", "DELETE", "业务语义注记", "operationId"].includes(id) && !/[<>]/.test(id));
        if (openapiOperationIds.size === 0) {
          qualityLevel({ file: relFile, text: `OpenAPI 不存在或没有 operationId，无法验证接口映射：${openapiPath ? rel(openapiPath) : "未配置"}` });
        } else if (knownReferenced.length === 0) {
          qualityLevel({ file: relFile, text: "接口契约没有映射到 OpenAPI 中已声明的 operationId" });
        }
        for (const id of candidateIds) {
          if (/^(接口|鉴权|用途|业务|HTTP|字段|schema|只|维护|在|OpenAPI)$/.test(id)) continue;
          if (!openapiOperationIds.has(id) && /^[a-z][A-Za-z0-9_.-]+$/.test(id)) {
            qualityLevel({ file: relFile, text: `接口映射中的 operationId 未在 OpenAPI 找到：${id}` });
          }
        }
      } else if (!meaningfulBody(interfaceBody) && !interfaceNA) {
        qualityLevel({ file: relFile, text: "接口契约章节没有可审计内容" });
      }

      if (!dataNA) {
        for (const heading of dataSections) {
          if (!sectionBody(lines, heading)) qualityLevel({ file: relFile, text: `数据与事务缺少可审计小节：${heading}` });
        }
      }
      if (interfaceNA && !hasNotApplicableReason(interfaceBody)) qualityLevel({ file: relFile, text: "接口章节若不适用，必须写明理由" });
      if (dataNA && !hasNotApplicableReason(dataBody)) qualityLevel({ file: relFile, text: "数据章节若不适用，必须写明理由" });
    }

  }

  for (const [id, entry] of implementationStates) {
    if (!featureIds.has(id)) add("error", rel(statusFile), entry.line, `实现状态表登记了不存在的功能文档：${id}`);
  }

  const indexFiles = (activePolicy.indexes || []).map((p) => join(docsRoot, p)).filter(existsSync);
  const linked = new Set();
  for (const indexFile of indexFiles) {
    const text = readFileSync(indexFile, "utf8");
    let m;
    linkRe.lastIndex = 0;
    while ((m = linkRe.exec(text))) {
      let target = m[1].split("#")[0].trim();
      if (!target || target.includes("{{")) continue;
      const abs = resolve(dirname(indexFile), decode(target));
      if (existsSync(abs) && !statSync(abs).isDirectory()) linked.add(rel(abs));
    }
  }
  for (const file of featureDocs) {
    if (!linked.has(rel(file))) add("warn", rel(file), 0, "未登记到功能索引或查找表");
  }
  const tracePolicy = quality.traceability || {};
  if (qualityEnabled && tracePolicy.enabled !== false && matrixFile && existsSync(matrixFile)) {
    const matrixText = readFileSync(matrixFile, "utf8");
    const expectedColumns = tracePolicy.requireMappedColumns || [];
    const matrixTables = markdownTables(matrixText);
    const traceTables = matrixTables.filter((table) =>
      table.header.some((cell) => ["稳定需求 ID", "功能 ID", "稳定需求范围"].includes(cell)),
    );
    if (traceTables.length === 0) {
      add("error", rel(matrixFile), 0, "需求追踪矩阵缺少含稳定需求 ID 的结构化表格");
    } else {
      const mappedFeatures = new Map();
      const mappedE2e = new Set();
      for (const table of traceTables) {
        for (const column of expectedColumns) {
          if (headerIndex(table.header, column) < 0) add("error", rel(matrixFile), 0, `需求追踪矩阵缺少必需列或等价列：${column}`);
        }
        const idIndex = table.header.findIndex((cell) => ["稳定需求 ID", "功能 ID", "稳定需求范围"].includes(cell));
        const featureIndex = table.header.findIndex((cell) => ["功能主文档", "功能文档"].includes(cell));
        const e2eIndex = headerIndex(table.header, "跨功能验收");
        for (const row of table.rows) {
          const id = cleanCell(row.cells[idIndex]);
          if (!id || !activePolicy.ids?.requirement || !new RegExp(activePolicy.ids.requirement).test(id)) continue;
          if (featureIndex >= 0) {
            const cell = row.cells[featureIndex] || "";
            const link = cell.match(/\[[^\]]*\]\(([^)\s]+)/);
            const target = link && resolveLocalLink(matrixFile, link[1]);
            if (!target) add("error", rel(matrixFile), row.line, `${id} 没有可解析的功能主文档链接`);
            else {
              const source = readFileSync(target.abs, "utf8");
              const featureId = parseFrontmatter(source)?.feature_id;
              if (featureId && cleanCell(featureId) !== id) add("error", rel(matrixFile), row.line, `追踪矩阵 ${id} 链接到了不同功能：${featureId}`);
              mappedFeatures.set(id, target.rel);
            }
          } else if (tracePolicy.requireFeatureLink !== false) {
            add("error", rel(matrixFile), row.line, `${id} 的追踪矩阵没有功能主文档列`);
          }
          if (e2eIndex >= 0) {
            for (const match of String(row.cells[e2eIndex] || "").matchAll(new RegExp(activePolicy.ids?.e2e || "V\\d+-E2E-\\d+", "g"))) mappedE2e.add(match[0]);
          }
        }
      }
      for (const [id, file] of featureIds) {
        if (!mappedFeatures.has(id)) add("error", rel(matrixFile), 0, `追踪矩阵没有登记功能文档中的需求：${id}`);
        else if (mappedFeatures.get(id) !== file) add("error", rel(matrixFile), 0, `追踪矩阵 ${id} 指向的文档与 feature_id 所在主文档不一致`);
      }
      if (tracePolicy.requireE2eResolution !== false) {
        const e2eConfig = quality.e2e || {};
        const e2eFile = e2eConfig.matrix ? join(docsRoot, e2eConfig.matrix) : null;
        if (e2eFile && existsSync(e2eFile) && statSync(e2eFile).isFile()) {
          const e2eText = readFileSync(e2eFile, "utf8");
          for (const id of mappedE2e) {
            if (!e2eIdVariants(id).some((variant) => e2eText.includes(variant))) {
              qualityLevel({ file: rel(matrixFile), text: `追踪矩阵引用的 E2E 用例未在用例矩阵找到：${id}` });
            }
          }
        }
      }
    }
  }
  const designQualityEnabled = qualityEnabled && quality.technicalDesign?.enabled !== false;
  if (designQualityEnabled) for (const file of walk(dir)) {
    if (!file.endsWith("-技术设计.md")) continue;
    const text = readFileSync(file, "utf8");
    const relDesign = rel(file);
    const branchPattern = activePolicy.ids?.branch;
    if (!branchPattern || !new RegExp(branchPattern).test(text)) add("error", rel(file), 0, "高风险技术设计缺少稳定分支 ID");
    const designLines = text.split(/\r?\n/);
    for (const heading of quality.technicalDesign?.requiredSections || []) {
      if (!hasHeadingAlternative(designLines, heading)) qualityLevel({ file: relDesign, text: `技术设计缺少必需章节或等价章节：${heading}` });
    }
    const sourceTarget = resolveLocalLink(file, featureSourceLink(text));
    const fm = parseFrontmatter(text);
    const parentId = sourceTarget ? parseFrontmatter(readFileSync(sourceTarget.abs, "utf8"))?.feature_id : null;
    const designId = fm?.feature_id || parentId;
    if (quality.technicalDesign?.requireFeatureId !== false && !designId) {
      qualityLevel({ file: relDesign, text: "技术设计缺少 feature_id 元数据，且无法从主文档链接推断" });
    }
    if (quality.technicalDesign?.requireSourceFeature !== false && !sourceTarget) {
      qualityLevel({ file: relDesign, text: "技术设计必须链接对应的功能主文档" });
    }
    if (sourceTarget && fm?.feature_id && (!parentId || cleanCell(parentId) !== cleanCell(fm.feature_id))) {
      qualityLevel({ file: relDesign, text: `技术设计 feature_id 与主文档不一致：${fm.feature_id}` });
    }
    if (quality.technicalDesign?.requireBranchAcMapping !== false) {
      let branchRows = 0;
      for (const table of markdownTables(text)) {
        const branchIndex = table.header.findIndex((cell) => ["分支", "稳定分支", "分支 ID"].includes(cell));
        const acIndex = table.header.findIndex((cell) => ["功能 AC", "AC", "验收标准"].includes(cell));
        if (branchIndex < 0) continue;
        branchRows += table.rows.length;
        for (const row of table.rows) {
          const branches = extractIds(row.cells[branchIndex], branchPattern);
          const acs = extractIds(acIndex >= 0 ? row.cells[acIndex] : "", activePolicy.ids?.acceptance);
          if (branches.length && acs.length === 0) add("error", relDesign, row.line, `技术设计分支 ${branches.join(", ")} 未映射功能 AC`);
        }
      }
      if (branchRows === 0) {
        const branchIds = extractIds(text, branchPattern);
        const acIds = extractIds(text, activePolicy.ids?.acceptance);
        if (!(branchIds.length && acIds.length)) qualityLevel({ file: relDesign, text: "技术设计缺少结构化的分支到测试追踪表，且无法从正文确认分支与 AC 的关联" });
        else qualityLevel({ file: relDesign, text: "技术设计未提供结构化的分支到测试追踪表；正文分支/AC 仅作为兼容性降级" });
      }
    }
    if (!linked.has(rel(file))) add("warn", rel(file), 0, "技术设计未登记到技术设计索引或功能索引");
  }

  const riskFile = join(docsRoot, spec.dir, "功能风险分级.md");
  const designConfig = quality.technicalDesign || {};
  if (designQualityEnabled && designConfig.enabled !== false && existsSync(riskFile)) {
    const highRiskIds = new Set();
    for (const table of markdownTables(readFileSync(riskFile, "utf8"))) {
      if (!table.header.some((cell) => ["功能", "需求", "稳定需求"].includes(cell))) continue;
      for (const row of table.rows) {
        const cell = row.cells[0] || "";
        for (const id of extractIds(cell, activePolicy.ids?.requirement)) highRiskIds.add(id);
      }
    }
    for (const id of highRiskIds) {
      const featurePath = featureIds.get(id);
      if (!featurePath) continue;
      const featureFile = resolve(repoRoot, featurePath);
      const content = readFileSync(featureFile, "utf8");
      const link = content.match(/\[[^\]]*技术设计[^\]]*\]\(([^)\s]+\.md)/);
      const target = link && resolveLocalLink(featureFile, link[1]);
      if (!target) add("error", rel(riskFile), 0, `高风险功能 ${id} 未链接独立技术设计`);
      else {
        const designText = readFileSync(target.abs, "utf8");
        const designFrontmatterId = parseFrontmatter(designText)?.feature_id;
        const designSourceTarget = resolveLocalLink(target.abs, featureSourceLink(designText));
        const designId = designFrontmatterId || (designSourceTarget && parseFrontmatter(readFileSync(designSourceTarget.abs, "utf8"))?.feature_id);
        if (cleanCell(designId) !== id) qualityLevel({ file: rel(target.abs), text: `高风险功能 ${id} 的技术设计 feature_id 不匹配` });
      }
    }
  }

  const checkMatrix = (config, label) => {
    if (config?.enabled === false || !config?.matrix) return;
    const file = join(docsRoot, config.matrix);
    if (!existsSync(file)) {
      add("error", rel(file), 0, `${label}矩阵缺失`);
      return;
    }
    const tables = markdownTables(readFileSync(file, "utf8"));
    if (!tables.length) {
      add("error", rel(file), 0, `${label}矩阵没有结构化表格`);
      return;
    }
    for (const column of config.requiredColumns || []) {
      if (!tables.some((table) => table.header.includes(column))) add("error", rel(file), 0, `${label}矩阵缺少必需列：${column}`);
    }
    const relevant = tables.find((table) => (config.requiredColumns || []).every((column) => table.header.includes(column)));
    if (relevant) {
      for (const row of relevant.rows) {
        for (const column of config.requiredColumns || []) {
          if (!cleanCell(rowCell(row, relevant.header, column))) add("warn", rel(file), row.line, `${label}矩阵必填信息为空：${column}`);
        }
      }
    }
  };
  if (qualityEnabled) {
    checkMatrix(quality.e2e, "E2E");
    checkMatrix(quality.performance, "性能与容量");
  }

  if (qualityEnabled && quality.e2e?.enabled !== false) {
    const config = quality.e2e || {};
    const matrix = join(docsRoot, config.matrix || "05-测试与发布/端到端验收/用例矩阵.md");
      const specification = join(docsRoot, (config.specification || `05-测试与发布/端到端验收/${activePolicy.activeVersion}-端到端验收规范.md`).replaceAll("{{活跃版本}}", activePolicy.activeVersion));
    if (!existsSync(specification)) {
      qualityLevel({ file: rel(specification), text: "E2E 规范文件缺失，无法核对用例正文" });
    } else if (existsSync(matrix)) {
      const caseTable = markdownTables(readFileSync(matrix, "utf8")).find((table) => table.header.includes("用例") && table.header.includes("真实入口"));
      const matrixIds = new Map();
      for (const row of caseTable?.rows || []) {
        const cell = rowCell(row, caseTable.header, "用例");
        const id = canonicalE2eId(cell, activePolicy.activeVersion);
        if (!id) continue;
        if (!id.startsWith(`${activePolicy.activeVersion}-`)) qualityLevel({ file: rel(matrix), line: row.line, text: `E2E 用例 ${id} 不属于当前版本` });
        if (/[(（]V\d+[)）]/.test(cell) && !cell.includes(`(${activePolicy.activeVersion})`) && !cell.includes(`（${activePolicy.activeVersion}）`)) {
          qualityLevel({ file: rel(matrix), line: row.line, text: `E2E 用例 ${id} 标有未来版本，不得计入当前版本矩阵` });
        }
        if (matrixIds.has(id)) qualityLevel({ file: rel(matrix), line: row.line, text: `E2E 用例重复登记：${id}` });
        matrixIds.set(id, row.line);
      }
      const specLines = readFileSync(specification, "utf8").split(/\r?\n/);
      const specIds = new Map();
      for (let index = 0; index < specLines.length; index += 1) {
        const heading = specLines[index].match(/^#{2,4}\s+(V\d+-E2E-\d{2}[A-Z]?)\b/i);
        if (!heading) continue;
        const id = canonicalE2eId(heading[1], activePolicy.activeVersion);
        if (specIds.has(id)) qualityLevel({ file: rel(specification), line: index + 1, text: `E2E 规范重复定义：${id}` });
        specIds.set(id, index + 1);
        const level = specLines[index].match(/^#+/)[0].length;
        let end = index + 1;
        while (end < specLines.length) {
          const next = specLines[end].match(/^(#+)\s+/);
          if (next && next[1].length <= level) break;
          end += 1;
        }
        const body = specLines.slice(index + 1, end).join("\n");
        for (const keyword of ["Given", "When", "Then"]) {
          if (!new RegExp(`^${keyword}\\b`, "m").test(body)) qualityLevel({ file: rel(specification), line: index + 1, text: `${id} 缺少独立的 ${keyword} 条件` });
        }
      }
      for (const id of matrixIds.keys()) if (!specIds.has(id)) qualityLevel({ file: rel(matrix), line: matrixIds.get(id), text: `E2E 矩阵用例缺少规范独立章节：${id}` });
      for (const id of specIds.keys()) if (!matrixIds.has(id)) qualityLevel({ file: rel(specification), line: specIds.get(id), text: `E2E 规范用例未登记到执行矩阵：${id}` });
    }
  }

  if (qualityEnabled && quality.publicContracts?.enabled !== false) {
    const interfaceFile = join(docsRoot, (quality.publicContracts?.interface || `04-技术架构/当前版本/${activePolicy.activeVersion}-接口契约.md`).replaceAll("{{活跃版本}}", activePolicy.activeVersion));
    const dataFile = join(docsRoot, (quality.publicContracts?.data || `04-技术架构/当前版本/${activePolicy.activeVersion}-数据模型.md`).replaceAll("{{活跃版本}}", activePolicy.activeVersion));
    if (existsSync(interfaceFile)) {
      const lines = readFileSync(interfaceFile, "utf8").split(/\r?\n/);
      const section = sectionBody(lines, "本版逐操作契约索引");
      const columns = ["操作 ID", "入口与传输", "鉴权主体", "功能 ID", "阶段", "成功终态", "关键失败与无副作用", "字段权威", "AC/E2E"];
      const table = tableWithColumns(section, columns);
      if (!table) qualityLevel({ file: rel(interfaceFile), text: `接口公共契约缺少逐操作索引或必需列：${columns.join("、")}` });
      else for (const row of table.rows) {
        const operation = cleanCell(rowCell(row, table.header, "操作 ID"));
        if (!operation || /[<>{}]/.test(operation)) continue;
        const feature = cleanCell(rowCell(row, table.header, "功能 ID"));
        if (!featureIds.has(feature)) qualityLevel({ file: rel(interfaceFile), line: row.line, text: `${operation} 未关联已登记的当前版本功能 ID` });
        const stage = cleanCell(rowCell(row, table.header, "阶段"));
        if (!stage) qualityLevel({ file: rel(interfaceFile), line: row.line, text: `${operation} 缺少实现/规划阶段` });
        if (/^(GET|POST|PUT|PATCH|DELETE)\b/i.test(cleanCell(rowCell(row, table.header, "入口与传输"))) && openapiOperationIds.size && !openapiOperationIds.has(operation)) {
          qualityLevel({ file: rel(interfaceFile), line: row.line, text: `${operation} 未在当前版本 OpenAPI 找到` });
        }
      }
      if (!sectionBody(lines, "后续版本规划操作")) qualityLevel({ file: rel(interfaceFile), text: "接口公共契约缺少后续版本规划操作分区或不适用理由" });
    }
    if (existsSync(dataFile)) {
      const lines = readFileSync(dataFile, "utf8").split(/\r?\n/);
      const structures = [
        ["本版实体清单与生命周期", ["实体/快照", "类型（持久化/派生/缓存）", "所有者", "关联功能", "标识与关系", "状态/保留策略"]],
        ["关键不变量与失败验证", ["实体/跨域写入", "不变量与数据库兜底", "事务/并发/幂等边界", "失败或补偿结果", "AC/E2E 验证"]],
        ["迁移顺序与验证", ["迁移", "内容", "兼容性", "回滚/失败处理", "验证方式与证据", "负责人"]],
      ];
      for (const [heading, columns] of structures) {
        const body = sectionBody(lines, heading);
        if (!tableWithColumns(body, columns) && !hasNotApplicableReason(body)) qualityLevel({ file: rel(dataFile), text: `数据公共契约缺少 ${heading} 结构或不适用理由` });
      }
    }
  }

  const adrConfig = quality.adr || {};
  if (qualityEnabled && adrConfig.enabled !== false) {
    const directory = join(docsRoot, adrConfig.directory || "06-决策记录/ADR");
    const exclude = adrConfig.excludePattern ? new RegExp(adrConfig.excludePattern) : null;
    for (const file of walk(directory)) {
      if (!file.endsWith(".md") || (exclude && exclude.test(file.split(sep).pop()))) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (const heading of adrConfig.requiredSections || []) {
        if (!hasHeading(lines, heading)) add("error", rel(file), 0, `ADR 缺少必需章节：${heading}`);
      }
      if (!/^\s*-\s*状态：\s*[^\n]+/m.test(lines.join("\n"))) add("error", rel(file), 0, "ADR 缺少显式状态");
    }
  }
}

/* ---------- 5. 占位符 ---------- */

if (activePolicy.warnOnPlaceholders !== false) {
  for (const file of mdFiles) {
    if (isIgnored(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    const hits = [];
    lines.forEach((line, idx) => {
      if (line.includes("填写说明")) hits.push(idx + 1);
      else if (line.includes("{{")) hits.push(idx + 1);
      else if (/<[^>\n]*[\u4e00-\u9fff][^>\n]*>|<>|<\.\.\.|<YYYY[^>]*>/i.test(line)) hits.push(idx + 1);
    });
    if (hits.length) {
      add("warn", rel(file), hits[0], `仍有占位内容（${hits.length} 处，行：${hits.slice(0, 5).join(",")}${hits.length > 5 ? "…" : ""}）`);
    }
  }
}

/* ---------- 6. 输出 ---------- */

const errors = results.filter((r) => r.level === "error");
const warns = results.filter((r) => r.level === "warn");
const order = { error: 0, warn: 1 };
results.sort(
  (a, b) =>
    order[a.level] - order[b.level] ||
    a.file.localeCompare(b.file) ||
    a.line - b.line,
);

if (!quiet) {
  for (const r of results) {
    const tag = r.level === "error" ? "ERROR" : "WARN ";
    const loc = r.line ? `${r.file}:${r.line}` : r.file;
    console.log(`${tag} ${loc}  ${r.message}`);
  }
}
console.log(`\n[check-docs] ${errors.length} errors, ${warns.length} warnings（文档根：${rel(docsRoot) || "."}）`);
if (errors.length === 0) {
  console.log("[check-docs] 结构自洽。注意：这不代表交付就绪，证据真实性由 docs-gate 负责。");
}
process.exit(errors.length > 0 || (strict && warns.length > 0) ? 1 : 0);
