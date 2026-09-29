#!/usr/bin/env node
/**
 * SDD 内容审查器：在 check-docs 的结构检查之外，检查规格是否形成可开发、可验证的闭环。
 *
 * 用法:
 *   node review-docs.mjs --repo <项目根> [--policy docs-policy.json]
 *                        [--phase planning|spec_ready|development|implemented|release_candidate]
 *                        [--feature <feature-id>]
 *                        [--json] [--strict] [--quiet]
 *
 * 本脚本只读取文件，不执行项目命令。它不判断业务选择是否正确，只报告缺失、空泛、未决、跨版本混用和证据缺口。
 */
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isExplicitNotApplicable, resolveTierPolicy } from "./policy-utils.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(name);
const phase = opt("--phase", "planning");
const featureFilter = opt("--feature", "");
const scopeOption = opt("--scope", featureFilter ? "feature" : "global");
const jsonOut = has("--json");
const quiet = has("--quiet");
const strict = has("--strict");

if (!["planning", "spec_ready", "development", "implemented", "release_candidate"].includes(phase)) {
  console.error("[review-docs] --phase 只能是 planning / spec_ready / development / implemented / release_candidate");
  process.exit(2);
}
if (!["global", "feature"].includes(scopeOption)) {
  console.error("[review-docs] --scope 只能是 global / feature");
  process.exit(2);
}
if (scopeOption === "feature" && !featureFilter) {
  console.error("[review-docs] --scope feature 必须同时提供 --feature <feature-id>");
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const defaultRepo = resolve(HERE, "..");
const repoRoot = resolve(opt("--repo", defaultRepo));
const policyPath = resolve(repoRoot, opt("--policy", "docs-policy.json"));

function fail(message) {
  if (jsonOut) console.log(JSON.stringify({ ok: false, status: "CONFIG_ERROR", phase, issues: [{ level: "error", code: "CONFIG", message }] }, null, 2));
  else console.error(`[review-docs] ${message}`);
  process.exit(2);
}

if (!existsSync(policyPath)) fail(`找不到策略文件：${policyPath}`);
let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, "utf8"));
} catch (error) {
  fail(`无法解析策略文件：${error.message}`);
}
const resolvedPolicy = resolveTierPolicy(policy, opt("--tier", null));
const root = resolve(repoRoot, resolvedPolicy.root || "docs");
const activeVersion = resolvedPolicy.activeVersion || "V1";
const featureSpec = resolvedPolicy.featureDoc || {};
const quality = { ...(resolvedPolicy.quality || {}) };
const allowNotApplicable = quality.allowNotApplicable !== false;
const productDocs = quality.productDocs || {};
const publicContracts = quality.publicContracts || {};
const e2eConfig = quality.e2e || {};
const issues = [];

if (root !== repoRoot && !root.startsWith(`${repoRoot}${sep}`)) fail(`文档根目录必须位于仓库内：${root}`);
if (!existsSync(root)) fail(`找不到文档根目录：${root}`);

function rel(file) {
  return relative(repoRoot, file).split(sep).join("/");
}
function lineOf(text, needle) {
  if (!needle) return 0;
  const index = text.indexOf(needle);
  return index < 0 ? 0 : text.slice(0, index).split(/\r?\n/).length;
}
function add(level, file, code, message, details = {}) {
  // planning 允许“测试尚未执行”，但不能把规格缺口误报成可开发输入。
  // 资产尚未创建仍可保持规划状态；已声明通过却缺资产会由 EVIDENCE_GAP 阻断。
  const draftAllowed = new Set(["TEST_ASSET_MISSING", "AC_PENDING"]);
  const blockingPhases = new Set(["planning", "spec_ready", "development", "implemented", "release_candidate"]);
  const blocking = details.blocking ?? (
    level === "error" ||
    (blockingPhases.has(phase) && !draftAllowed.has(code) && ["MISSING", "HOLLOW", "MIXED_SCOPE", "CONFLICT", "DRAFT_BLOCKER"].includes(details.category))
  );
  const finalLevel = strict && level === "warn" ? "error" : level;
  issues.push({
    level: finalLevel,
    blocking,
    category: details.category || (finalLevel === "error" ? "DRAFT_BLOCKER" : "EVIDENCE_GAP"),
    code,
    file: file ? rel(file) : "",
    line: details.line || 0,
    id: details.id || "",
    owner: details.owner || "待指定",
    resolve: details.resolve || "补充真实业务事实并关联验证资产",
    message,
  });
}
function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git"].includes(entry)) continue;
    const file = join(dir, entry);
    const info = lstatSync(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) out.push(...walk(file));
    else out.push(file);
  }
  return out;
}
function parseTables(text) {
  const tables = [];
  let rows = [];
  const lines = text.split(/\r?\n/);
  const flush = () => {
    if (rows.length >= 2) tables.push({ header: rows[0].cells, rows: rows.slice(2), line: rows[0].line });
    rows = [];
  };
  lines.forEach((line, index) => {
    if (line.trim().startsWith("|")) {
      rows.push({ cells: line.trim().split("|").slice(1, -1).map((cell) => cell.trim()), line: index + 1 });
    } else flush();
  });
  flush();
  return tables;
}
function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s+/.test(line) && line.includes(heading));
  if (start < 0) return null;
  const level = (lines[start].match(/^#+/) || ["#"])[0].length;
  let end = start + 1;
  while (end < lines.length && !new RegExp(`^#{1,${level}}\\s+`).test(lines[end])) end += 1;
  return { body: lines.slice(start + 1, end).join("\n").trim(), line: start + 1 };
}
function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
    const item = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/);
    return item ? [[item[1], item[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
}
function tableWith(text, columns) {
  return parseTables(text).find((table) => columns.every((column) => table.header.includes(column)));
}
function firstSection(text, headings) {
  for (const heading of headings) {
    const found = section(text, heading);
    if (found) return found;
  }
  return null;
}
function isNotApplicable(text) { return allowNotApplicable && isExplicitNotApplicable(text); }
function requiredSection(file, text, headings, label = headings[0]) {
  const found = firstSection(text, headings);
  if (!found) add("error", file, "SECTION_MISSING", `文档缺少必需章节：${label}`, { category: "MISSING", resolve: `补充${label}，或明确“不适用 + 理由”` });
  return found;
}
function requiredTable(file, text, headings, columns, label = headings[0]) {
  const body = firstSection(text, headings);
  if (!body) {
    add("error", file, "SECTION_MISSING", `文档缺少必需章节：${label}`, { category: "MISSING", resolve: `补充${label}，或明确“不适用 + 理由”` });
  } else if (!tableWith(body.body, columns) && !isNotApplicable(body.body)) {
    add("error", file, "TABLE_COLUMNS_MISSING", `${label}缺少结构化表格或必需列：${columns.join("、")}`, { category: "MISSING", line: body.line, resolve: "按模板补齐逐项结构化字段，不能只写概括性段落" });
  }
  return body;
}
function ids(text, expression) {
  return new Set([...text.matchAll(expression)].map((match) => match[0]));
}
function expandAc(value) {
  const out = new Set();
  for (const token of String(value || "").matchAll(/AC(\d{2})(?:\s*[–-]\s*AC?(\d{2}))?/g)) {
    const start = Number(token[1]);
    const end = token[2] ? Number(token[2]) : start;
    for (let number = start; number <= end; number += 1) out.add(`AC${String(number).padStart(2, "0")}`);
  }
  return out;
}
function canonicalE2eId(value, fallbackVersion = activeVersion) {
  const match = String(value || "").match(/\b(?:(V\d+)-)?E2E-?(\d{2}[A-Z]?)\b/i);
  return match ? `${match[1] || fallbackVersion}-E2E-${match[2].toUpperCase()}` : "";
}
function candidatePaths(text) {
  const backticks = [...String(text || "").matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
  const links = [...String(text || "").matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1].trim());
  return [...new Set([...backticks, ...links])]
    .filter((value) => /[/\\]/.test(value) && /\.[A-Za-z0-9_-]{1,12}$/.test(value) && !/[<>{}]/.test(value) && !/^https?:\/\//i.test(value));
}
function existsInRepo(path, sourceFile) {
  const base = /^(?:\.\.?[\\/])/.test(path) && sourceFile ? dirname(sourceFile) : repoRoot;
  const absolute = resolve(base, path);
  return absolute === repoRoot || absolute.startsWith(`${repoRoot}${sep}`) ? existsSync(absolute) : false;
}
function docsPath(configured, fallback) {
  const value = String(configured || fallback).replaceAll("{{活跃版本}}", activeVersion);
  const absolute = resolve(root, value);
  return absolute === root || absolute.startsWith(`${root}${sep}`) ? absolute : null;
}
function checkedDocsPath(configured, fallback, label) {
  const path = docsPath(configured, fallback);
  if (configured && !path) fail(`${label} 必须位于文档根目录内：${configured}`);
  return path;
}
function statusFrom(text) {
  const match = text.match(/\|\s*规格状态\s*\|\s*([^|\n]+)/);
  return match?.[1]?.trim() || text.match(/(?:规格状态|Specification Status)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim() || "";
}

const featureDir = join(root, String(featureSpec.dir || `03-功能规格/${activeVersion}`).replaceAll("{{活跃版本}}", activeVersion));
const featureFiles = walk(featureDir).filter((file) => {
  const name = file.split(sep).pop();
  return new RegExp(featureSpec.filePattern || "^\\d{2}-.+\\.md$").test(name) && !new RegExp(featureSpec.excludePattern || "(^00-)|(^README\\.md$)|(-技术设计\\.md$)").test(name);
});
const featureRecords = [];
for (const file of featureFiles) {
  const text = readFileSync(file, "utf8");
  const fm = frontmatter(text);
  const featureId = fm.feature_id || [...text.matchAll(/\bV\d+-FR-\d{3}\b/g)][0]?.[0] || "";
  const record = { file, text, fm, id: featureId, acs: new Set(), e2e: ids(text, /V\d+-E2E-\d{2}[A-Z]?/g) };
  featureRecords.push(record);
  const requiredSections = featureSpec.sections || ["目标", "功能边界", "需求说明", "接口契约", "数据与事务", "验收标准", "实现与验证"];
  for (const heading of requiredSections) {
    if (!section(text, heading)) add("error", file, "FEATURE_SECTION_MISSING", `功能文档缺少必需章节：${heading}`, { category: "MISSING", id: featureId, line: lineOf(text, "# ") });
  }
  for (const key of quality.requiredMetadata || ["title", "version", "feature_id", "domain", "updated", "delivery_scope", "planning_only", "delivery_slice"]) {
    if (!fm[key] || /[<>{}]/.test(fm[key])) add("error", file, "FEATURE_METADATA_MISSING", `功能元数据缺失或仍为占位符：${key}`, { category: "MISSING", id: featureId, line: 1 });
  }
  if (!featureId) add("error", file, "FEATURE_ID_MISSING", "功能文档没有稳定 feature_id", { category: "MISSING", line: 1 });
  const acHeadings = [...text.matchAll(/^(#{3,5})\s+(?:(?:验收标准|验收用例|Acceptance Criteria)\s*[:：]?\s*)?(AC\d{2})\b/gim)];
  for (const match of acHeadings) {
    const ac = match[2].toUpperCase();
    record.acs.add(ac);
    const start = match.index || 0;
    const level = match[1].length;
    const remainder = text.slice(start + match[0].length);
    const next = remainder.search(new RegExp(`\\n#{1,${level}}\\s+`));
    const body = text.slice(start, next >= 0 ? start + match[0].length + next : text.length);
    for (const keyword of ["Given", "When", "Then"]) {
      if (!new RegExp(`^${keyword}\\b`, "m").test(body)) add("error", file, "AC_STRUCTURE", `${featureId}/${ac} 缺少 ${keyword}`, { category: "HOLLOW", id: `${featureId}/${ac}`, line: lineOf(text, match[0]), resolve: "写出前置条件、触发动作和可观察最终事实" });
    }
    if (!/(页面|状态|记录|创建|更新|删除|终态|响应|事件|审计|数据库|数据)/.test(body)) add("warn", file, "AC_NOT_OBSERVABLE", `${featureId}/${ac} 的 Then 似乎没有可观察最终事实`, { category: "HOLLOW", id: `${featureId}/${ac}`, line: lineOf(text, match[0]), resolve: "补充状态、数据、响应、事件或审计等可验证事实" });
    if (/(拒绝|失败|重复|并发|取消|超时|回滚|权限|异常)/.test(body) && !/(不应|不得|无副作用|不创建|不写入|不调用|不泄露|不改变)/.test(body)) add("warn", file, "AC_NO_SIDE_EFFECT_ASSERTION", `${featureId}/${ac} 的失败/风险场景缺少无副作用断言`, { category: "HOLLOW", id: `${featureId}/${ac}`, line: lineOf(text, match[0]), resolve: "明确失败时不得创建、写入、重复调用或泄露哪些事实" });
  }
  const mappingTables = parseTables(text).filter((table) =>
    table.header.some((cell) => /AC/.test(cell)) &&
    table.header.some((cell) => /目标资产|测试文件|建议测试文件|命令|建议命令/.test(cell)),
  );
  const statusTable = mappingTables.find((table) => table.header.some((cell) => /^(当前状态|验收状态|状态)$/.test(cell.trim())));
  if (record.acs.size > 0 && !statusTable) {
    add("error", file, "AC_STATUS_COLUMN_MISSING", `${featureId} 的 AC 映射缺少当前状态列`, { category: "MISSING", id: featureId, resolve: "在 AC 映射表中记录规划中、未执行、通过或阻塞等真实状态" });
  }
  const mappedAcs = new Set();
  for (const table of mappingTables) for (const row of table.rows) for (const ac of expandAc(row.cells.join(" "))) mappedAcs.add(ac);
  for (const ac of record.acs) if (!mappedAcs.has(ac)) add("error", file, "AC_MAPPING_MISSING", `${featureId}/${ac} 未映射到逐项测试表`, { category: "MISSING", id: `${featureId}/${ac}`, resolve: "补充测试层级、目标资产、目标命令和当前状态" });
  for (const table of mappingTables) {
      const statusIndex = table.header.findIndex((cell) => /^(当前状态|验收状态|状态)$/.test(cell.trim()));
    for (const row of table.rows) {
      const rowAcs = expandAc(row.cells.join(" "));
      if (!rowAcs.size) continue;
      const rowText = row.cells.join(" ");
      const status = statusIndex >= 0 ? row.cells[statusIndex] : "";
      for (const path of candidatePaths(rowText)) {
        if (!existsInRepo(path, file)) add(status && /(通过|Passed)/i.test(status) ? "error" : "warn", file, "TEST_ASSET_MISSING", `${featureId}/${[...rowAcs].join(",")} 引用的测试资产不存在：${path}`, { category: status && /(通过|Passed)/i.test(status) ? "EVIDENCE_GAP" : "MISSING", id: `${featureId}/${[...rowAcs].join(",")}`, resolve: "创建真实测试资产，或将状态保持为规划中并注明负责人" });
      }
      if (status && /(通过|Passed)/i.test(status) && /(未创建|规划中|待补|未执行|Pending)/i.test(status)) add("error", file, "TEST_STATUS_CONFLICT", `${featureId}/${[...rowAcs].join(",")} 同时声明通过和未完成状态`, { category: "CONFLICT", id: featureId });
    }
  }
  const interfaceBody = section(text, "接口契约")?.body || "";
  const dataBody = section(text, "数据与事务")?.body || "";
  const requiredContractSignals = [
    ["前置依赖", /前置依赖/],
    ["字段规则", /字段规则|字段约束/],
    ["成功响应", /成功响应|响应示例/],
    ["幂等", /幂等/],
    ["并发", /并发/],
    ["重试", /重试/],
    ["观测", /观测|可观测/],
  ];
  for (const [label, pattern] of requiredContractSignals) {
    const body = label === "前置依赖" ? section(text, "需求说明")?.body || "" : interfaceBody;
    if (!pattern.test(body) && !/不适用/.test(body)) add("warn", file, "FEATURE_CONTRACT_GAP", `${featureId} 缺少可审计的${label}`, { category: "MISSING", id: featureId, resolve: `补充${label}，或写明“不适用 + 理由”` });
  }
  if (fm.delivery_scope === "active" && fm.planning_only === "true") add("error", file, "DELIVERY_METADATA_CONFLICT", `${featureId} 同时声明 active 和 planning_only=true`, { category: "CONFLICT", id: featureId });
  if (fm.delivery_scope === "active" && fm.version && fm.version !== activeVersion) add("error", file, "MIXED_VERSION_FEATURE", `${featureId} 属于 ${fm.version}，却位于当前版本 ${activeVersion} 功能目录`, { category: "MIXED_SCOPE", id: featureId, resolve: "迁移到对应版本目录，保留稳定 ID 映射" });
  if (/^(Ready|已就绪)$/i.test(statusFrom(text)) && (record.acs.size === 0 || mappingTables.length === 0)) add("error", file, "READY_WITHOUT_CLOSURE", `${featureId} 标记为 Ready/已就绪但缺少完整 AC 或测试映射`, { category: "DRAFT_BLOCKER", id: featureId, resolve: "完成 AC、测试资产、命令和证据闭环后再标记 Ready" });
  if (featureFilter && /^(Draft|草稿|规划中)$/i.test(statusFrom(text))) add("error", file, "FEATURE_NOT_READY", `${featureId} 规格仍为 Draft/规划中，不能解锁该交付切片`, { category: "DRAFT_BLOCKER", id: featureId, resolve: "完成本切片的范围、契约、数据、AC 和测试映射后标记规格状态 Ready" });
  if (dataBody && /V[2-9]-/.test(dataBody) && fm.delivery_scope === "active") add("warn", file, "FUTURE_REFERENCE_IN_ACTIVE_FEATURE", `${featureId} 的数据说明包含未来版本标识，需确认没有混入当前交付`, { category: "MIXED_SCOPE", id: featureId, resolve: "把未来行为移至对应版本规划并建立迁移映射" });
}

const selectedFeature = featureFilter
  ? featureRecords.filter((record) => record.id === featureFilter)
  : [];
if (featureFilter && selectedFeature.length !== 1) {
  fail(selectedFeature.length ? `功能 ID 不唯一：${featureFilter}` : `找不到功能 ID：${featureFilter}`);
}
const relatedFeature = selectedFeature[0];
const featureScope = scopeOption === "feature";
const relatedE2eIds = new Set([...(relatedFeature?.e2e || [])].map((id) => canonicalE2eId(id)));

// Feature scope only evaluates the selected feature and its directly referenced E2E.
// Global product and contract checks remain available through the default global scope.
const shouldRunGlobalChecks = !featureScope;

const blueprint = checkedDocsPath(productDocs.blueprint, "02-产品与版本/产品蓝图.md", "产品蓝图路径");
if (shouldRunGlobalChecks && productDocs.enabled !== false) {
  if (!blueprint || !existsSync(blueprint)) {
    if (blueprint) add("error", blueprint, "PRODUCT_BLUEPRINT_MISSING", "产品蓝图文件缺失", { category: "MISSING", resolve: "创建产品蓝图并登记角色、场景、能力、指标和风险" });
  } else {
    const text = readFileSync(blueprint, "utf8");
    requiredTable(blueprint, text, ["角色场景矩阵"], ["角色", "目标与触发", "当前障碍", "期望结果", "适用版本", "关联能力"], "角色场景矩阵");
    requiredTable(blueprint, text, ["核心业务流程"], ["流程", "参与角色", "触发与前提", "主要步骤", "成功终态", "失败与恢复", "适用版本"], "核心业务流程");
    requiredTable(blueprint, text, ["能力地图"], ["能力域", "解决的场景", "依赖与边界", "首次交付版本", "权威规格"], "能力地图");
    requiredTable(blueprint, text, ["非功能目标"], ["质量属性", "目标或待冻结条件", "适用版本", "验证方式", "权威约束"], "非功能目标");
    requiredTable(blueprint, text, ["风险与未决问题"], ["风险/问题", "影响的角色与场景", "应对或验证动作", "责任角色", "决策位置"], "风险与未决问题");
    const concept = requiredTable(blueprint, text, ["核心业务概念", "核心概念"], ["概念 ID", "概念", "定义", "边界与易混项", "首次适用版本"], "核心业务概念");
    if (concept && !tableWith(concept.body, ["概念 ID", "概念", "谁创建/拥有", "与其他概念的关系", "权威定义", "版本责任人"])) {
      add("error", blueprint, "CONCEPT_OWNERSHIP_TABLE_MISSING", "核心业务概念缺少所有权与权威定义表", { category: "MISSING", line: concept.line, resolve: "为每个核心概念登记创建者、拥有者、关系和权威定义位置" });
    }
    requiredTable(blueprint, text, ["成功标准"], ["成功标准 ID", "可观察结果", "指标/口径", "关联能力或功能", "验证方式与证据", "责任人", "状态"], "成功标准");
    const flow = firstSection(text, ["核心业务流程"]);
    if (flow && !/^\s*\d+\.\s+/m.test(flow.body) && !/详细流程|流程步骤|步骤链接/.test(flow.body)) {
      add("error", blueprint, "PRODUCT_FLOW_STEPS_MISSING", "核心业务流程缺少有序步骤或详细流程链接", { category: "HOLLOW", line: flow.line, resolve: "写出触发、主要步骤、成功终态以及失败和恢复路径" });
    }
  }
}
const prd = checkedDocsPath(productDocs.prd, "02-产品与版本/当前版本/{{活跃版本}}-产品需求.md", "版本 PRD 路径");
if (shouldRunGlobalChecks && productDocs.enabled !== false) {
  if (!prd || !existsSync(prd)) {
    if (prd) add("error", prd, "PRODUCT_PRD_MISSING", "当前版本产品需求文件缺失", { category: "MISSING", resolve: "创建当前版本 PRD，并明确交付场景、边界、验收和依赖" });
  } else {
    const text = readFileSync(prd, "utf8");
    const delivery = requiredTable(prd, text, ["交付顺序与依赖"], ["阶段", "功能 ID", "必须先具备", "可验收产物", "AC", "E2E", "负责人", "完成定义/证据", "后置能力"], "交付顺序与依赖");
    requiredTable(prd, text, ["页面需求"], ["页面/入口", "角色与主要任务", "可见条件", "成功反馈", "空态/加载态/错误态", "关联功能"], "页面需求");
    requiredTable(prd, text, ["跨功能业务规则"], ["规则", "适用场景", "失败时产品行为", "权威功能/决策"], "跨功能业务规则");
    requiredTable(prd, text, ["版本验收场景"], ["场景", "真实入口与前提", "成功终态", "关键失败断言", "功能 ID", "E2E/门禁与证据"], "版本验收场景");
    requiredTable(prd, text, ["非功能需求"], ["编号", "需求", "目标与阈值", "基线", "测量窗口/环境", "负责人", "验证方式与证据"], "非功能需求");
    requiredTable(prd, text, ["发布门禁"], ["编号", "条件", "责任人", "阻塞级别", "证据类型与位置", "失败处理"], "发布门禁");
    const flow = requiredSection(prd, text, ["核心链路"], "核心链路");
    if (flow) {
      const headings = [...flow.body.matchAll(/^###\s+(.+)$/gm)].map((match) => match[1]);
      if (!headings.length) add("error", prd, "PRODUCT_LINK_SCENARIO_MISSING", "核心链路必须按场景拆分", { category: "HOLLOW", line: flow.line, resolve: "为每条角色链路建立独立小节，并写出有序步骤" });
      for (const heading of headings) {
        const body = section(text, heading)?.body || "";
        if (!tableWith(body, ["参与角色", "触发与前提", "成功终态", "失败与恢复", "关联功能", "验收入口"]) || !/^\s*\d+\.\s+/m.test(body)) {
          add("error", prd, "PRODUCT_LINK_CLOSURE_MISSING", `核心链路 ${heading} 缺少场景表或有序步骤`, { category: "HOLLOW", line: flow.line, resolve: "补充参与角色、触发、步骤、成功终态、失败恢复、功能和验收入口" });
        }
      }
    }
    if (delivery && !tableWith(delivery.body, ["功能 ID", "AC", "E2E", "负责人", "完成定义/证据"]) && !isNotApplicable(delivery.body)) {
      add("error", prd, "DELIVERY_UNIT_CLOSURE_MISSING", "交付顺序与依赖没有形成逐交付单元的闭环", { category: "MISSING", line: delivery.line, resolve: "补充每个交付单元的功能、AC、E2E、负责人、完成定义和证据" });
    }
  }
}

const interfaceFile = checkedDocsPath(publicContracts.interface, "04-技术架构/当前版本/{{活跃版本}}-接口契约.md", "接口契约路径");
const openapi = checkedDocsPath(policy.openapi, "04-技术架构/当前版本/{{活跃版本}}-openapi.yaml", "OpenAPI 路径");
if (shouldRunGlobalChecks && publicContracts.enabled !== false) {
  if (interfaceFile && !existsSync(interfaceFile)) add("error", interfaceFile, "INTERFACE_CONTRACT_MISSING", "当前版本接口契约文件缺失", { category: "MISSING", resolve: "创建逐操作公共契约，或明确关闭 publicContracts 检查" });
  if (openapi && !existsSync(openapi)) add("error", openapi, "OPENAPI_MISSING", "当前版本 OpenAPI 文件缺失", { category: "MISSING", resolve: "提供机器可读 OpenAPI，或在策略中明确非 HTTP 契约及其 schema" });
}
if (shouldRunGlobalChecks && publicContracts.enabled !== false && interfaceFile && existsSync(interfaceFile)) {
  const text = readFileSync(interfaceFile, "utf8");
  const contract = requiredTable(interfaceFile, text, ["本版逐操作契约索引"], ["操作 ID", "入口与传输", "鉴权主体", "功能 ID", "阶段", "成功终态", "关键失败与无副作用", "字段权威", "AC/E2E"], "本版逐操作契约索引");
  const tables = contract ? parseTables(contract.body).filter((table) => table.header.includes("操作 ID") || table.header.includes("operationId")) : [];
  if (contract && tables.length === 0 && !isExplicitNotApplicable(contract.body)) add("error", interfaceFile, "OPERATION_TABLE_MISSING", "本版逐操作契约索引没有可解析的操作表", { category: "MISSING", line: contract.line });
  for (const table of tables) {
    const joined = table.header.join(" ");
    for (const required of publicContracts.requiredOperationColumns || ["功能 ID", "AC/E2E", "成功终态", "关键失败与无副作用"]) if (!joined.includes(required)) add("warn", interfaceFile, "PUBLIC_CONTRACT_COLUMN_MISSING", `接口逐操作索引缺少列：${required}`, { category: "MISSING" });
    for (const row of table.rows) {
      const rowText = row.cells.join(" ");
      if (!/AC\d{2}|V\d+-E2E-\d{2}/.test(rowText)) add("warn", interfaceFile, "PUBLIC_CONTRACT_TRACE_MISSING", `接口操作 ${row.cells[0] || "<unknown>"} 没有可解析的 AC/E2E ID`, { category: "MISSING", line: row.line });
      if (!/幂等|idempot/i.test(rowText) && /POST|PATCH|PUT|DELETE|写入|执行|创建|更新|删除/.test(rowText)) add("warn", interfaceFile, "PUBLIC_CONTRACT_IDEMPOTENCY_MISSING", `写操作 ${row.cells[0] || "<unknown>"} 没有操作级幂等约束`, { category: "MISSING", line: row.line, resolve: "登记幂等键或明确不适用理由，并链接 AC/E2E" });
    }
  }
  if (!firstSection(text, ["后续版本规划操作"])) add("error", interfaceFile, "FUTURE_OPERATION_SECTION_MISSING", "接口契约缺少后续版本规划操作分区或不适用理由", { category: "MISSING" });
  if (existsSync(openapi) && /后续版本规划操作/.test(text) && /V[2-9]-/.test(text.slice(text.indexOf("后续版本规划操作")))) add("warn", interfaceFile, "FUTURE_OPERATION_MIXING", "接口文档同时出现当前操作和未来版本操作，需确认表格边界和实现状态隔离", { category: "MIXED_SCOPE" });
}

const dataFile = checkedDocsPath(publicContracts.data, "04-技术架构/当前版本/{{活跃版本}}-数据模型.md", "数据模型路径");
if (shouldRunGlobalChecks && publicContracts.enabled !== false && dataFile && !existsSync(dataFile)) add("error", dataFile, "DATA_MODEL_MISSING", "当前版本数据模型文件缺失", { category: "MISSING", resolve: "创建数据公共契约，或明确无持久化/派生数据并写出理由" });
if (shouldRunGlobalChecks && publicContracts.enabled !== false && dataFile && existsSync(dataFile)) {
  const text = readFileSync(dataFile, "utf8");
  requiredTable(dataFile, text, ["本版实体清单与生命周期"], ["实体/快照", "类型（持久化/派生/缓存）", "所有者", "关联功能", "标识与关系", "状态/保留策略"], "本版实体清单与生命周期");
  requiredTable(dataFile, text, ["关键不变量与失败验证"], ["实体/跨域写入", "不变量与数据库兜底", "事务/并发/幂等边界", "失败或补偿结果", "AC/E2E 验证"], "关键不变量与失败验证");
  requiredTable(dataFile, text, ["迁移顺序与验证"], ["迁移", "内容", "兼容性", "回滚/失败处理", "验证方式与证据", "负责人"], "迁移顺序与验证");
  const core = section(text, "核心实体");
  if (core && /V[2-9]\b/.test(core.body)) add("warn", dataFile, "FUTURE_ENTITY_IN_CURRENT_TABLE", "当前版本核心实体表包含未来版本标识", { category: "MIXED_SCOPE", resolve: "把未来实体移到未来实体注册表，并保留规划链接" });
  if (!/当前.*持久化|持久化.*当前|派生.*快照|缓存|未来.*实体/.test(text)) add("warn", dataFile, "ENTITY_CLASSIFICATION_MISSING", "数据模型没有明确区分持久化实体、派生快照、缓存和未来实体", { category: "MISSING" });
  if (!/回滚|失败处理|失败.*迁移/.test(text)) add("warn", dataFile, "MIGRATION_ROLLBACK_MISSING", "迁移章节没有回滚或失败处理", { category: "MISSING" });
}

const e2eMatrix = checkedDocsPath(e2eConfig.matrix, "05-测试与发布/端到端验收/用例矩阵.md", "E2E 矩阵路径");
const e2eSpec = checkedDocsPath(e2eConfig.specification, "05-测试与发布/端到端验收/{{活跃版本}}-端到端验收规范.md", "E2E 规范路径");
const e2eIds = new Set();
if (e2eConfig.enabled !== false && e2eMatrix && !existsSync(e2eMatrix) && shouldRunGlobalChecks) add("error", e2eMatrix, "E2E_MATRIX_MISSING", "E2E 用例矩阵文件缺失", { category: "MISSING", resolve: "创建当前版本用例矩阵；若本版确实不适用，写出业务理由和替代验收方式" });
if (e2eConfig.enabled !== false && e2eSpec && !existsSync(e2eSpec) && (shouldRunGlobalChecks || relatedE2eIds.size > 0)) add("error", e2eSpec, "E2E_SPEC_FILE_MISSING", "E2E 规范文件缺失", { category: "MISSING", resolve: "为每个当前版本 E2E 建立独立 Given/When/Then 规范章节" });
if (e2eConfig.enabled !== false && e2eMatrix && existsSync(e2eMatrix) && shouldRunGlobalChecks) {
  const text = readFileSync(e2eMatrix, "utf8");
  const table = parseTables(text).find((candidate) => candidate.header.some((cell) => /用例/.test(cell)));
  if (!table && !/不适用[：:，,。].{4,}/s.test(text)) {
    add("error", e2eMatrix, "E2E_TABLE_MISSING", "E2E 用例矩阵没有结构化用例表", { category: "MISSING" });
  } else if (table) {
    const headers = table.header.join(" ");
    for (const required of e2eConfig.requiredColumns || e2eConfig.reviewRequiredColumns || ["功能 ID", "AC", "真实入口", "必须真实的本系统依赖", "断言事实类型", "最终业务断言", "目标测试文件", "环境", "日期", "代码版本", "命令", "证据路径", "限制", "当前证据状态"]) {
      if (!headers.includes(required)) add("error", e2eMatrix, "E2E_AUDIT_COLUMN_MISSING", `E2E 矩阵缺少审计列：${required}`, { category: "MISSING", line: table.line });
    }
    for (const row of table.rows) {
      const rawId = row.cells[0]?.match(/V\d+-E2E-\d{2}[A-Z]?|E2E-?\d{2}[A-Z]?/i)?.[0];
      const id = canonicalE2eId(rawId);
      if (id) e2eIds.add(id);
      if (id && !/数据库|状态|终态|审计|调用次数|无重复|不泄露/.test(row.cells.join(" "))) add("warn", e2eMatrix, "E2E_FACT_TYPE_MISSING", `${id} 的最终断言没有明确事实类型`, { category: "HOLLOW", id });
    }
  }
}
if (e2eConfig.enabled !== false && e2eSpec && existsSync(e2eSpec)) {
  const text = readFileSync(e2eSpec, "utf8");
  const specIds = new Set([...text.matchAll(/^#{2,4}\s+(?:([^\n]*?\s+))?((?:V\d+-)?E2E-?\d{2}[A-Z]?)/gim)].map((match) => canonicalE2eId(match[2])));
  for (const match of text.matchAll(/^#{2,4}\s+((?:V\d+-)?E2E-?\d{2}[A-Z]?)\b[^\n]*\n([\s\S]*?)(?=^#{1,4}\s+|$)/gim)) {
    const id = canonicalE2eId(match[1]);
    for (const keyword of ["Given", "When", "Then"]) {
      if (!new RegExp(`^${keyword}\\b`, "m").test(match[2])) add("error", e2eSpec, "E2E_SPEC_STRUCTURE", `${id} 缺少独立的 ${keyword} 条件`, { category: "HOLLOW", id, line: lineOf(text, match[0]) });
    }
  }
  const idsToCheck = shouldRunGlobalChecks ? e2eIds : relatedE2eIds;
  for (const id of idsToCheck) if (id && !specIds.has(id)) add("error", e2eMatrix, "E2E_SPEC_MISSING", `E2E ${id} 在矩阵中存在，但规范正文没有独立章节`, { category: "MISSING", id });
  if (shouldRunGlobalChecks) for (const id of specIds) if (id && !e2eIds.has(id)) add("warn", e2eSpec, "E2E_MATRIX_MISSING", `E2E ${id} 在规范正文中存在，但未登记到矩阵`, { category: "MISSING", id });
}
for (const record of featureScope ? [relatedFeature] : featureRecords) {
  if (!record) continue;
  for (const e2e of record.e2e) {
    const canonical = canonicalE2eId(e2e);
    if (e2eIds.size && !e2eIds.has(canonical)) add("warn", record.file, "FEATURE_E2E_UNRESOLVED", `${record.id} 引用了未在 E2E 矩阵登记的 ${e2e}`, { category: "MISSING", id: e2e });
  }
}

if (featureFilter && relatedFeature?.e2e?.size && e2eIds.size) {
  for (const e2e of relatedFeature.e2e) {
    const canonical = canonicalE2eId(e2e);
    if (!e2eIds.has(canonical)) add("error", relatedFeature.file, "FEATURE_E2E_UNRESOLVED", `${relatedFeature.id} 的 ${e2e} 未在 E2E 矩阵登记，不能作为切片验收入口`, { category: "MISSING", id: e2e });
  }
}

const performance = quality.performance || {};
if (shouldRunGlobalChecks && performance.enabled !== false) {
  const performanceMatrix = checkedDocsPath(performance.matrix, "05-测试与发布/性能与容量/场景矩阵.md", "性能矩阵路径");
  if (performanceMatrix && !existsSync(performanceMatrix)) add("error", performanceMatrix, "PERFORMANCE_MATRIX_MISSING", "性能与容量场景矩阵缺失", { category: "MISSING", resolve: "建立可量化目标、最低环境、关键断言和证据要求；不适用时写出理由" });
  else if (performanceMatrix) {
    const text = readFileSync(performanceMatrix, "utf8");
    const tables = parseTables(text);
    const required = performance.requiredColumns || ["目标", "最低环境", "关键断言", "必要证据", "当前状态"];
    if (!tables.some((table) => required.every((column) => table.header.includes(column))) && !/不适用[：:，,。].{4,}/s.test(text)) add("error", performanceMatrix, "PERFORMANCE_TABLE_MISSING", `性能与容量矩阵缺少结构化字段：${required.join("、")}`, { category: "MISSING" });
  }
}

const featureScopedIssues = relatedFeature
  ? (featureScope ? issues : issues.filter((issue) => {
      const matchesFeatureFile = issue.file === rel(relatedFeature.file);
      const matchesFeatureId = issue.id === relatedFeature.id || issue.id.startsWith(`${relatedFeature.id}/`);
      const matchesE2e = relatedE2eIds.has(canonicalE2eId(issue.id));
      const matchesDesign = issue.file.includes("技術設計") && issue.message.includes(relatedFeature.id);
      return matchesFeatureFile || matchesFeatureId || matchesE2e || matchesDesign;
    }))
  : issues;
const uniqueIssues = [...new Map(featureScopedIssues.map((issue) => [
  [issue.file, issue.line, issue.code, issue.id, issue.message].join("\0"),
  issue,
])).values()].sort((a, b) =>
  a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code) || a.id.localeCompare(b.id),
);
const blockers = uniqueIssues.filter((issue) => issue.blocking || issue.level === "error");
let status = "SPEC_READY";
if (blockers.length) status = phase === "planning" ? "SDD_NOT_READY" : phase === "development" ? "IMPLEMENTATION_PENDING" : "EVIDENCE_PENDING";
else if (["planning", "spec_ready"].includes(phase)) status = "SPEC_READY";
else if (phase === "development") status = "IMPLEMENTATION_PENDING";
else status = "RELEASE_READY";
const result = {
  ok: blockers.length === 0,
  status,
  phase,
  scope: relatedFeature && featureScope
    ? { type: "feature", feature_id: relatedFeature.id, file: rel(relatedFeature.file), dependency_e2e: [...relatedE2eIds].filter(Boolean).sort() }
    : { type: "global" },
  summary: { errors: uniqueIssues.filter((issue) => issue.level === "error").length, warnings: uniqueIssues.filter((issue) => issue.level === "warn").length, blockers: blockers.length, features: relatedFeature ? 1 : featureRecords.length },
  issues: uniqueIssues,
};
if (jsonOut) console.log(JSON.stringify(result, null, 2));
else if (!quiet) {
  for (const issue of uniqueIssues) console.log(`[${issue.level}] ${issue.code} ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`);
  console.log(`[review-docs] ${status}: ${result.summary.errors} errors, ${result.summary.warnings} warnings, ${result.summary.blockers} blockers`);
}
process.exit(result.ok ? 0 : 1);
