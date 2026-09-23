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
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
const selectedTier = policy.tierRules?.[tier] || {};
const activePolicy = { ...policy, ...selectedTier, tier };
const cliRoot = opt("--root", null);
const docsRoot = cliRoot ? resolve(repoRoot, cliRoot) : resolve(repoRoot, activePolicy.root || "docs");

if (!existsSync(docsRoot)) {
  console.error(`[check-docs] 找不到文档根目录：${docsRoot}（policy.root=${activePolicy.root || "docs"}）`);
  process.exit(1);
}
const strict = has("--strict") || activePolicy.strict === true;
const quiet = has("--quiet");

const results = [];
const add = (level, file, line, message) =>
  results.push({ level, file, line, message });

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

/* ---------- 4. 功能文档 ---------- */

const featureDocs = [];
const featureIds = new Map();
const spec = activePolicy.featureDoc;
if (spec?.dir) {
  const dir = join(docsRoot, spec.dir);
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
    if (!frontmatter) {
      add("error", relFile, 1, "功能文档缺少 YAML frontmatter");
    } else {
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
      const cleanId = featureId?.replace(/[`"']/g, "");
      if (cleanId && !implementationStates.has(cleanId)) {
        add("error", relFile, 1, `功能未登记到版本实现状态：${cleanId}`);
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
  for (const file of walk(dir)) {
    if (!file.endsWith("-技术设计.md")) continue;
    const text = readFileSync(file, "utf8");
    const branchPattern = activePolicy.ids?.branch;
    if (!branchPattern || !new RegExp(branchPattern).test(text)) add("error", rel(file), 0, "高风险技术设计缺少稳定分支 ID");
    if (!linked.has(rel(file))) add("warn", rel(file), 0, "技术设计未登记到技术设计索引或功能索引");
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
