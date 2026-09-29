#!/usr/bin/env node
/** Read-only evidence freshness and invalidation propagation report. */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { factEvidenceRefs, evidenceId, normalizeRelations, readRegistry, registryNodes, registryRelativePath } from "./facts-utils.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const target = resolve(value("--dir", process.cwd()));
const strict = argv.includes("--strict");
const now = value("--now", new Date().toISOString());
const policyPath = join(target, "docs-policy.json");
let policy = {};
if (existsSync(policyPath)) {
  try { policy = JSON.parse(readFileSync(policyPath, "utf8")); } catch { policy = {}; }
}
const registryResult = readRegistry(target, policy.facts?.file || "docs-facts.json");
const registry = registryResult.registry || {};
const nodes = registryNodes(registry);
const relations = normalizeRelations(registry);
const errors = [];
const warnings = [];
const evidence = new Map();
const evidenceOwners = new Map();

function addIssue(collection, code, message, extra = {}) { collection.push({ code, message, ...extra }); }
function safePath(value) {
  const absolute = registryRelativePath(target, value);
  return absolute && existsSync(absolute) ? absolute : null;
}
function parseDate(value) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value);
}
function registerEvidence(owner, entry) {
  const id = evidenceId(entry);
  if (!id) { addIssue(warnings, "EVIDENCE_ID_MISSING", `证据引用缺少 id/path：${owner}`, { owner }); return; }
  const descriptor = typeof entry === "string" ? { id, path: entry } : { ...entry, id };
  if (evidenceOwners.has(id)) evidenceOwners.get(id).push(owner); else evidenceOwners.set(id, [owner]);
  if (!evidence.has(id)) evidence.set(id, { id, owners: [], descriptor });
  evidence.get(id).owners.push(owner);
}

if (registryResult.error === "missing") addIssue(errors, "FACTS_MISSING", "找不到事实注册表");
else if (registryResult.error) addIssue(errors, "FACTS_INVALID", `事实注册表 JSON 无效：${registryResult.error}`);
for (const node of [...(registry.facts || []), ...(registry.slices || [])]) {
  for (const entry of factEvidenceRefs(node)) registerEvidence(node.id, entry);
}

const nowDate = parseDate(now);
if (!nowDate) addIssue(errors, "NOW_INVALID", `--now 不是有效 ISO 时间：${now}`);
const stale = [];
const invalid = [];
for (const item of evidence.values()) {
  const descriptor = item.descriptor;
  const reportPath = descriptor.path || descriptor.report;
  const absolute = reportPath ? safePath(reportPath) : null;
  item.path = reportPath || null;
  item.status = "valid";
  if (reportPath && !absolute) {
    item.status = "invalid";
    addIssue(invalid, "EVIDENCE_PATH", `证据路径不存在或越界：${reportPath}`, { id: item.id, owners: item.owners });
  }
  const report = absolute && reportPath.endsWith(".json") ? (() => { try { return JSON.parse(readFileSync(absolute, "utf8")); } catch { return null; } })() : null;
  if (absolute && reportPath.endsWith(".json") && !report) {
    item.status = "invalid";
    addIssue(invalid, "EVIDENCE_JSON", `证据 JSON 无法解析：${reportPath}`, { id: item.id, owners: item.owners });
  }
  const status = descriptor.status || report?.status || report?.result || null;
  if (status && ["failed", "failure", "flaky", "invalid", "blocked"].includes(String(status).toLowerCase())) {
    item.status = "invalid";
    addIssue(invalid, "EVIDENCE_STATUS", `证据状态不是通过：${status}`, { id: item.id, owners: item.owners });
  }
  const generatedAt = descriptor.generated_at || descriptor.generatedAt || report?.generatedAt || report?.generated_at || null;
  const generatedDate = parseDate(generatedAt);
  if (!generatedDate) {
    item.status = "invalid";
    addIssue(invalid, "EVIDENCE_DATE", `证据缺少有效 generatedAt：${item.id}`, { id: item.id, owners: item.owners });
  } else {
    item.generated_at = generatedDate.toISOString();
    const maxAge = Math.max(0, Number(descriptor.max_age_days ?? 0));
    if (maxAge > 0 && nowDate && nowDate.getTime() - generatedDate.getTime() > maxAge * 86400000) {
      item.status = "stale";
      addIssue(stale, "EVIDENCE_STALE", `证据超过 freshness 窗口：${item.id}`, { id: item.id, owners: item.owners, max_age_days: maxAge });
    }
  }
  item.commit = descriptor.commit || report?.commit || report?.code_version || null;
  if (!item.commit) addIssue(warnings, "EVIDENCE_COMMIT_MISSING", `证据未绑定代码提交：${item.id}`, { id: item.id, owners: item.owners });
}

const affected = new Map();
for (const issue of [...invalid, ...stale]) {
  const queue = [...(issue.owners || [])];
  const visited = new Set(queue);
  while (queue.length) {
    const current = queue.shift();
    if (!affected.has(current)) affected.set(current, { node: current, reasons: [] });
    affected.get(current).reasons.push({ evidence: issue.id, code: issue.code });
    for (const relation of relations.filter((entry) => entry.from === current || entry.to === current)) {
      const next = relation.from === current ? relation.to : relation.from;
      if (nodes.has(next) && !visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
}
const output = {
  schema: "spec-docs/evidence-freshness/v1",
  read_only: true,
  target,
  registry: relative(target, registryResult.file).split(sep).join("/"),
  evaluated_at: nowDate?.toISOString() || now,
  strict,
  evidence: [...evidence.values()],
  invalid,
  stale,
  affected: [...affected.values()],
  warnings,
  errors,
  summary: {
    evidence: evidence.size,
    valid: [...evidence.values()].filter((entry) => entry.status === "valid").length,
    stale: stale.length,
    invalid: invalid.length,
    affected_nodes: affected.size,
    warnings: warnings.length,
    errors: errors.length,
  },
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exit(strict && (errors.length || stale.length || invalid.length) ? 1 : 0);
