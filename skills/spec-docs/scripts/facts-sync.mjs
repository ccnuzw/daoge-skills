#!/usr/bin/env node
/** Compare or update derived feature facts from authoritative Markdown documents. */
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { readRegistry, registryRelativePath } from "./facts-utils.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const target = resolve(value("--dir", process.cwd()));
const writeMode = argv.includes("--write");
const strict = argv.includes("--strict");
const json = argv.includes("--json");
const policyPath = join(target, "docs-policy.json");

function fail(message, code = 2) {
  const output = { schema: "spec-docs/facts-sync/v1", read_only: !writeMode, ok: false, errors: [{ code: "CONFIG", message }] };
  if (json) console.log(JSON.stringify(output, null, 2)); else console.error(`[facts-sync] ${message}`);
  process.exit(code);
}
function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) { fail(`无法解析 JSON：${path}：${error.message}`); }
}
function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    const info = lstatSync(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) files.push(...walk(file));
    else files.push(file);
  }
  return files;
}
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  return Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => {
    const item = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/);
    return item ? [[item[1], item[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
}
function tableRows(text) {
  const tables = [];
  let rows = [];
  const flush = () => {
    if (rows.length >= 2) tables.push({ header: rows[0], rows: rows.slice(2) });
    rows = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("|")) rows.push(line.trim().split("|").slice(1, -1).map((cell) => cell.trim()));
    else flush();
  }
  flush();
  return tables;
}
function cell(row, header, name) {
  const index = header.indexOf(name);
  return index < 0 ? "" : String(row[index] || "").trim();
}
function mapSpecStatus(value) {
  const normalized = String(value || "").toLowerCase();
  if (/ready|已就绪|frozen|冻结/.test(normalized)) return normalized.includes("frozen") || normalized.includes("冻结") ? "frozen" : "ready";
  return "draft";
}
function mapImplementationStatus(value) {
  const normalized = String(value || "").toLowerCase();
  if (/阻塞|blocked/.test(normalized)) return "blocked";
  if (/已完成|completed/.test(normalized)) return "completed";
  if (/待验收|awaiting_acceptance/.test(normalized)) return "awaiting_acceptance";
  if (/本地验证|local verified|locally_verified/.test(normalized)) return "locally_verified";
  if (/部分实现|partial/.test(normalized)) return "partial";
  if (/基础实现|implemented/.test(normalized)) return "implemented";
  if (/开发中|implementing|in_progress/.test(normalized)) return "in_progress";
  return "planned";
}

if (!existsSync(policyPath)) fail(`找不到 docs-policy.json：${policyPath}`);
const policy = readJson(policyPath);
const factsFile = resolve(target, policy.facts?.file || "docs-facts.json");
const registryResult = readRegistry(target, policy.facts?.file || "docs-facts.json");
if (registryResult.error || !registryResult.registry) fail(`无法读取事实注册表：${registryResult.error || factsFile}`);
const registry = registryResult.registry;
const activeVersion = policy.activeVersion || registry.version || "V1";
const docsRoot = resolve(target, policy.root || "docs");
const featureDir = resolve(docsRoot, String(policy.featureDoc?.dir || `03-功能规格/${activeVersion}`).replaceAll("{{活跃版本}}", activeVersion));
if (!existsSync(featureDir)) fail(`找不到功能文档目录：${featureDir}`);

const statusPath = resolve(docsRoot, `02-产品与版本/当前版本/${activeVersion}-实现状态.md`);
const implementationById = new Map();
if (existsSync(statusPath)) {
  for (const table of tableRows(readFileSync(statusPath, "utf8"))) {
    if (!table.header.includes("功能 ID") || !table.header.includes("实现状态")) continue;
    for (const row of table.rows) {
      const id = cell(row, table.header, "功能 ID").replaceAll("`", "").trim();
      if (id) implementationById.set(id, cell(row, table.header, "实现状态"));
    }
  }
}

const derived = [];
for (const file of walk(featureDir)) {
  const name = file.split(sep).pop();
  if (!name.endsWith(".md") || name === "README.md" || name.startsWith("00-") || name.includes("技术设计")) continue;
  const text = readFileSync(file, "utf8");
  const fm = parseFrontmatter(text);
  const id = fm.feature_id || text.match(/\bV\d+-FR-\d{3}\b/)?.[0];
  if (!id) continue;
  const card = text.match(/##\s+功能卡([\s\S]*?)(?=\n##\s|$)/)?.[1] || text;
  const specStatus = card.match(/\|\s*规格状态\s*\|\s*([^|\n]+)/)?.[1] || text.match(/规格状态\s*[:：]\s*([^\n]+)/)?.[1] || "Draft";
  const authority = relative(target, file).split(sep).join("/");
  const entry = {
    id,
    type: "feature",
    title: fm.title || id,
    lifecycle: fm.delivery_scope === "future" || fm.planning_only === "true" ? "planned" : "active",
    spec_status: mapSpecStatus(specStatus),
    delivery_scope: fm.delivery_scope === "future" ? "future" : "active",
    delivery_slice: fm.delivery_slice || null,
    authority,
    references: [authority],
  };
  if (implementationById.has(id)) entry.implementation_status = mapImplementationStatus(implementationById.get(id));
  derived.push(entry);
}

const currentFacts = Array.isArray(registry.facts) ? registry.facts : [];
const byId = new Map(currentFacts.map((fact) => [fact.id, fact]));
const findings = [];
const derivedFields = ["lifecycle", "spec_status", "implementation_status", "delivery_scope", "delivery_slice", "authority"];
for (const entry of derived) {
  const existing = byId.get(entry.id);
  if (!existing) {
    findings.push({ code: "FEATURE_MISSING", id: entry.id, message: `功能未登记到 facts：${entry.id}` });
    continue;
  }
  for (const field of derivedFields) {
    if (entry[field] !== undefined && existing[field] !== entry[field]) findings.push({ code: "FACT_DRIFT", id: entry.id, field, expected: entry[field], actual: existing[field] });
  }
  if (!implementationById.has(entry.id)) findings.push({ code: "IMPLEMENTATION_STATUS_MISSING", id: entry.id, message: "实现状态表没有该功能的当前状态" });
}
const derivedIds = new Set(derived.map((entry) => entry.id));
for (const fact of currentFacts) {
  if ((fact.type === "feature" || /^V\d+-FR-\d{3}$/.test(fact.id || "")) && !derivedIds.has(fact.id) && fact.lifecycle !== "archived") {
    findings.push({ code: "FEATURE_ORPHAN", id: fact.id, message: `facts 中存在文档未发现的功能：${fact.id}` });
  }
}

if (writeMode) {
  const nextFacts = currentFacts.map((fact) => {
    const entry = derived.find((item) => item.id === fact.id);
    if (!entry) return fact;
    const updated = { ...fact };
    for (const field of derivedFields) if (entry[field] !== undefined) updated[field] = entry[field];
    updated.references = Array.isArray(updated.references) ? [...new Set([...updated.references, entry.authority])] : [entry.authority];
    if (!Array.isArray(updated.evidence)) updated.evidence = [];
    return updated;
  });
  for (const entry of derived) {
    if (byId.has(entry.id)) continue;
    nextFacts.push({ ...entry, references: [entry.authority], evidence: [] });
  }
  const outputRegistry = { ...registry, updated: new Date().toISOString().slice(0, 10), facts: nextFacts };
  writeFileSync(factsFile, `${JSON.stringify(outputRegistry, null, 2)}\n`, "utf8");
}

const output = {
  schema: "spec-docs/facts-sync/v1",
  read_only: !writeMode,
  target,
  registry: relative(target, factsFile).split(sep).join("/"),
  active_version: activeVersion,
  derived_features: derived.length,
  findings,
  summary: {
    findings: findings.length,
    missing: findings.filter((item) => item.code === "FEATURE_MISSING").length,
    drift: findings.filter((item) => item.code === "FACT_DRIFT").length,
    orphan: findings.filter((item) => item.code === "FEATURE_ORPHAN").length,
  },
  written: writeMode,
};
if (json) console.log(JSON.stringify(output, null, 2));
else {
  console.log(`[facts-sync] ${writeMode ? "updated" : "check"}: ${findings.length} findings`);
  for (const finding of findings) console.log(`[${finding.code}] ${finding.id || ""} ${finding.field || ""} ${finding.message || ""}`.trim());
}
process.exit(strict && findings.length > 0 && !writeMode ? 1 : 0);
