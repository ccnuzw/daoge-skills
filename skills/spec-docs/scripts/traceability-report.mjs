#!/usr/bin/env node
/** Read-only fact registry relation and coverage report. */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { FACT_TYPES, RELATION_TYPES, normalizeRelations, readRegistry, registryNodes, registryRelativePath } from "./facts-utils.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const target = resolve(value("--dir", process.cwd()));
const strict = argv.includes("--strict");
const coverageProfile = value("--profile", "default");
let policy = {};
const policyPath = join(target, "docs-policy.json");
if (existsSync(policyPath)) {
  try { policy = JSON.parse(readFileSync(policyPath, "utf8")); } catch { policy = {}; }
}
const result = readRegistry(target, policy.facts?.file || "docs-facts.json");
const errors = [];
const warnings = [];
const facts = Array.isArray(result.registry?.facts) ? result.registry.facts : [];
const slices = Array.isArray(result.registry?.slices) ? result.registry.slices : [];
const nodes = registryNodes(result.registry);
const relations = normalizeRelations(result.registry);
if (result.error === "missing") errors.push({ code: "FACTS_MISSING", message: "找不到事实注册表" });
else if (result.error) errors.push({ code: "FACTS_INVALID", message: `事实注册表 JSON 无效：${result.error}` });
if (result.registry?.$schema !== "spec-docs/facts/v1") errors.push({ code: "FACTS_SCHEMA", message: "$schema 必须是 spec-docs/facts/v1" });

const ids = new Set();
for (const fact of facts) {
  if (!fact?.id) errors.push({ code: "FACT_ID_MISSING", message: "事实缺少 id" });
  else if (ids.has(fact.id)) errors.push({ code: "FACT_ID_DUPLICATE", id: fact.id, message: `事实 ID 重复：${fact.id}` });
  else ids.add(fact.id);
  if (fact?.type && !FACT_TYPES.has(fact.type)) errors.push({ code: "FACT_TYPE", id: fact.id, message: `事实类型无效：${fact.type}` });
  if (fact?.authority && (!registryRelativePath(target, fact.authority) || !existsSync(resolve(target, fact.authority)))) warnings.push({ code: "AUTHORITY_MISSING", id: fact.id, message: `权威来源不存在或越界：${fact.authority}` });
}
const sliceIds = new Set(slices.map((slice) => slice?.id).filter(Boolean));
for (const slice of slices) {
  if (slice?.authority && (!registryRelativePath(target, slice.authority) || !existsSync(resolve(target, slice.authority)))) warnings.push({ code: "SLICE_AUTHORITY_MISSING", id: slice.id, message: `切片权威来源不存在或越界：${slice.authority}` });
}
const relationKeys = new Set();
for (const relation of relations) {
  const key = `${relation.from}|${relation.to}|${relation.type}`;
  if (relationKeys.has(key)) warnings.push({ code: "RELATION_DUPLICATE", message: `关系重复：${key}` });
  relationKeys.add(key);
  if (!nodes.has(relation.from) || !nodes.has(relation.to)) errors.push({ code: "RELATION_ENDPOINT", message: `关系端点不存在：${relation.from} -> ${relation.to}` });
  if (!RELATION_TYPES.has(relation.type)) errors.push({ code: "RELATION_TYPE", message: `关系类型无效：${relation.type}` });
  const authority = relation.authority ? registryRelativePath(target, relation.authority) : null;
  if (relation.authority && (!authority || !existsSync(authority))) warnings.push({ code: "RELATION_AUTHORITY", message: `关系权威来源不存在或越界：${relation.authority}` });
}
for (const fact of facts) {
  if (fact.delivery_slice && !sliceIds.has(fact.delivery_slice)) errors.push({ code: "SLICE_ENDPOINT", id: fact.id, message: `事实切片不存在：${fact.delivery_slice}` });
}
const connected = new Set(relations.flatMap((relation) => [relation.from, relation.to]));
const orphanFacts = facts.filter((fact) => fact?.lifecycle !== "archived" && !connected.has(fact.id)).map((fact) => fact.id);
const orphanSlices = slices.filter((slice) => !connected.has(slice.id)).map((slice) => slice.id);
for (const id of orphanFacts) warnings.push({ code: "ORPHAN_FACT", id, message: `事实没有任何显式关系：${id}` });
for (const id of orphanSlices) warnings.push({ code: "ORPHAN_SLICE", id, message: `切片没有任何显式关系：${id}` });

const activeFacts = facts.filter((fact) => fact?.lifecycle === "active" || fact?.delivery_scope === "active");
const scopedFacts = activeFacts.filter((fact) => fact.delivery_slice && sliceIds.has(fact.delivery_slice));
const authorityFacts = facts.filter((fact) => fact?.authority);
const coverage = {
  active_facts: activeFacts.length,
  facts_with_slice: scopedFacts.length,
  facts_with_authority: authorityFacts.length,
  slice_coverage: activeFacts.length ? Number((scopedFacts.length / activeFacts.length).toFixed(4)) : 1,
  authority_coverage: facts.length ? Number((authorityFacts.length / facts.length).toFixed(4)) : 1,
  relation_coverage: facts.length ? Number((facts.filter((fact) => connected.has(fact.id)).length / facts.length).toFixed(4)) : 1,
};
const byType = {};
for (const fact of facts) {
  const type = fact.type || "unknown";
  if (!byType[type]) byType[type] = { total: 0, connected: 0, with_authority: 0, with_slice: 0 };
  byType[type].total += 1;
  if (connected.has(fact.id)) byType[type].connected += 1;
  if (fact.authority) byType[type].with_authority += 1;
  if (fact.delivery_slice && sliceIds.has(fact.delivery_slice)) byType[type].with_slice += 1;
}
const uncoveredByType = facts.filter((fact) => fact?.lifecycle !== "archived" && !connected.has(fact.id)).map((fact) => ({ id: fact.id, type: fact.type || "unknown" }));
coverage.profile = coverageProfile;
coverage.by_type = byType;
coverage.uncovered_by_type = uncoveredByType;
if (strict && coverageProfile === "sdd" && uncoveredByType.length) {
  errors.push({ code: "TRACEABILITY_UNCOVERED", message: `SDD 追踪图存在未连接事实：${uncoveredByType.map((entry) => entry.id).join(", ")}` });
}
const threshold = Number(value("--min-coverage", policy.facts?.minCoverage ?? 0));
if (strict && threshold > 0 && (coverage.slice_coverage < threshold || coverage.authority_coverage < threshold)) {
  errors.push({ code: "COVERAGE_THRESHOLD", message: `覆盖率低于阈值 ${threshold}` });
}
const output = {
  schema: "spec-docs/traceability-report/v1",
  read_only: true,
  target,
  registry: relative(target, result.file).split(sep).join("/"),
  strict,
  errors,
  warnings,
  coverage,
  graph: { nodes: nodes.size, relations: relations.length, orphan_facts: orphanFacts, orphan_slices: orphanSlices },
  summary: { facts: facts.length, slices: slices.length, errors: errors.length, warnings: warnings.length },
};
console.log(JSON.stringify(output, null, 2));
process.exit(strict && errors.length ? 1 : 0);
