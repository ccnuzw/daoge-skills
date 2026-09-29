#!/usr/bin/env node
/** Compare a frozen fact-registry baseline with current specifications. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { normalizeRelations, readRegistry, registryNodes, registryRelativePath } from "./facts-utils.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const target = resolve(value("--dir", process.cwd()));
const writeBaseline = argv.includes("--write-baseline");
const policyPath = join(target, "docs-policy.json");
let policy = {};
if (existsSync(policyPath)) {
  try { policy = JSON.parse(readFileSync(policyPath, "utf8")); } catch (error) {
    process.stderr.write(`[spec-diff] docs-policy.json 无效：${error.message}\n`);
    process.exit(2);
  }
}
const governancePolicy = policy.changeGovernance || {};
const strict = argv.includes("--strict") || (governancePolicy.enabled === true && governancePolicy.strict === true);
const registryResult = readRegistry(target, value("--facts", policy.facts?.file || "docs-facts.json"));
if (registryResult.error || !registryResult.registry) {
  process.stderr.write(`[spec-diff] 无法读取事实注册表：${registryResult.error || "missing"}\n`);
  process.exit(2);
}
const registry = registryResult.registry;
const version = value("--version", registry.version || policy.activeVersion || "unversioned");
if (!/^[A-Za-z0-9._-]+$/.test(version) || version === "." || version === "..") {
  process.stderr.write(`[spec-diff] 非法版本名：${version}\n`);
  process.exit(2);
}
const baselineRoot = resolve(target, value("--baseline-dir", governancePolicy.baselineDir || ".spec-docs/baselines"));
const baselinePath = join(baselineRoot, `${version}.json`);
const relativeBaseline = relative(target, baselinePath);
if (relativeBaseline.startsWith(`..${sep}`) || relativeBaseline === ".." || resolve(baselinePath) === resolve(target)) {
  process.stderr.write(`[spec-diff] 基线目录必须位于项目根目录内：${baselineRoot}\n`);
  process.exit(2);
}
const facts = Array.isArray(registry.facts) ? registry.facts : [];
const slices = Array.isArray(registry.slices) ? registry.slices : [];
const relations = normalizeRelations(registry);
function authorityFiles() {
  const paths = new Set([
    ...facts.map((fact) => fact.authority),
    ...slices.map((slice) => slice.authority),
  ].filter(Boolean));
  return [...paths].map((path) => {
    const absolute = registryRelativePath(target, path);
    if (!absolute || !existsSync(absolute)) return { path, sha256: null };
    return { path: relative(target, absolute).split(sep).join("/"), sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex") };
  }).sort((a, b) => a.path.localeCompare(b.path));
}
const snapshot = {
  schema: "spec-docs/baseline/v1",
  version,
  facts: [...facts].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  slices: [...slices].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  relations: [...relations].sort((a, b) => `${a.from}|${a.type}|${a.to}`.localeCompare(`${b.from}|${b.type}|${b.to}`)),
  authority_files: authorityFiles(),
};
const canonical = JSON.stringify(snapshot);
const digest = createHash("sha256").update(canonical).digest("hex");
if (writeBaseline) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  const document = { ...snapshot, digest, captured_at: new Date().toISOString() };
  writeFileSync(baselinePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ schema: "spec-docs/spec-diff/v1", read_only: false, action: "baseline_written", version, baseline: relative(target, baselinePath).split(sep).join("/"), digest }, null, 2)}\n`);
  process.exit(0);
}

const errors = [];
if (!existsSync(baselinePath)) errors.push({ code: "BASELINE_MISSING", message: `缺少冻结基线：${relative(target, baselinePath)}` });
let baseline = null;
if (existsSync(baselinePath)) {
  try { baseline = JSON.parse(readFileSync(baselinePath, "utf8")); }
  catch (error) { errors.push({ code: "BASELINE_INVALID", message: `基线 JSON 无效：${error.message}` }); }
}
if (baseline && baseline.schema !== "spec-docs/baseline/v1") errors.push({ code: "BASELINE_SCHEMA", message: "基线 schema 必须是 spec-docs/baseline/v1" });
if (baseline) {
  const baseCanonical = JSON.stringify({ schema: baseline.schema, version: baseline.version, facts: baseline.facts, slices: baseline.slices, relations: baseline.relations, ...(baseline.authority_files ? { authority_files: baseline.authority_files } : {}) });
  const actualDigest = createHash("sha256").update(baseCanonical).digest("hex");
  if (baseline.digest !== actualDigest) errors.push({ code: "BASELINE_DIGEST", message: "基线摘要不匹配；文件可能被手工修改" });
}

const baseFacts = new Map((baseline?.facts || []).map((entry) => [entry.id, entry]));
const currentFacts = new Map(facts.map((entry) => [entry.id, entry]));
const baseSlices = new Map((baseline?.slices || []).map((entry) => [entry.id, entry]));
const currentSlices = new Map(slices.map((entry) => [entry.id, entry]));
const changes = [];
const semanticKeys = ["type", "title", "lifecycle", "spec_status", "implementation_status", "delivery_scope", "delivery_slice", "authority", "references", "evidence"];
const stable = (value) => JSON.stringify(value === undefined ? null : value);
for (const [id, current] of currentFacts) {
  const previous = baseFacts.get(id);
  if (!previous) {
    changes.push({ id, kind: "added", category: "fact", current });
    continue;
  }
  const fields = semanticKeys.filter((key) => stable(previous[key]) !== stable(current[key]));
  if (fields.length) {
    const statusOnly = fields.every((key) => ["spec_status", "implementation_status", "lifecycle"].includes(key));
    changes.push({ id, kind: statusOnly ? "status_changed" : "modified", category: "fact", fields, previous, current });
  }
}
for (const [id, previous] of baseFacts) if (!currentFacts.has(id)) changes.push({ id, kind: "removed", category: "fact", previous });
for (const [id, current] of currentSlices) {
  const previous = baseSlices.get(id);
  if (!previous) changes.push({ id, kind: "added", category: "slice", current });
  else {
    const fields = ["status", "authority", "features", "depends_on", "evidence"].filter((key) => stable(previous[key]) !== stable(current[key]));
    if (fields.length) changes.push({ id, kind: fields.every((key) => key === "status") ? "status_changed" : "modified", category: "slice", fields, previous, current });
  }
}
for (const [id, previous] of baseSlices) if (!currentSlices.has(id)) changes.push({ id, kind: "removed", category: "slice", previous });
const baseAuthority = new Map((baseline?.authority_files || []).map((entry) => [entry.path, entry]));
const currentAuthority = new Map(snapshot.authority_files.map((entry) => [entry.path, entry]));
for (const [path, current] of currentAuthority) {
  const previous = baseAuthority.get(path);
  if (!previous) changes.push({ id: path, kind: "authority_added", category: "authority", path, current });
  else if (previous.sha256 !== current.sha256) changes.push({ id: path, kind: "authority_changed", category: "authority", path, previous, current });
}
for (const [path, previous] of baseAuthority) if (!currentAuthority.has(path)) changes.push({ id: path, kind: "authority_removed", category: "authority", path, previous });
const relationKey = (entry) => `${entry.from}|${entry.type}|${entry.to}|${entry.authority || ""}`;
const baseRelationMap = new Map((baseline?.relations || []).map((entry) => [relationKey(entry), entry]));
const currentRelationMap = new Map(relations.map((entry) => [relationKey(entry), entry]));
for (const [key, current] of currentRelationMap) if (!baseRelationMap.has(key)) changes.push({ id: `${current.from}->${current.to}`, kind: "relationship_added", category: "relationship", relation: current });
for (const [key, previous] of baseRelationMap) if (!currentRelationMap.has(key)) changes.push({ id: `${previous.from}->${previous.to}`, kind: "relationship_removed", category: "relationship", relation: previous });

const nodes = registryNodes(registry);
const changedIds = new Set(changes.flatMap((change) => change.category === "relationship" ? [change.relation.from, change.relation.to] : [change.id]));
const relatedSlices = new Set();
for (const change of changes.filter((entry) => entry.category === "authority")) {
  for (const fact of facts) if (fact.authority === change.path && fact.delivery_slice) relatedSlices.add(fact.delivery_slice);
  for (const slice of slices) if (slice.authority === change.path) relatedSlices.add(slice.id);
}
const queue = [...changedIds];
const visited = new Set(queue);
while (queue.length) {
  const id = queue.shift();
  const node = nodes.get(id);
  if (node?.node_type === "slice") relatedSlices.add(id);
  const fact = currentFacts.get(id);
  if (fact?.delivery_slice) relatedSlices.add(fact.delivery_slice);
  for (const slice of slices) if ((slice.features || []).includes(id)) relatedSlices.add(slice.id);
  for (const relation of relations) {
    if (relation.from !== id && relation.to !== id) continue;
    const other = relation.from === id ? relation.to : relation.from;
    if (!visited.has(other)) { visited.add(other); queue.push(other); }
  }
}
const changedNodes = [...visited].filter((id) => nodes.has(id));
const affectedFacts = changedNodes.map((id) => nodes.get(id));
const affectedPaths = [...new Set(affectedFacts.flatMap((entry) => [entry.authority, ...(entry.references || [])]).filter(Boolean))].sort();
for (const change of changes.filter((entry) => entry.category === "authority")) if (change.path && !affectedPaths.includes(change.path)) affectedPaths.push(change.path);
affectedPaths.sort();
const changeKinds = [...new Set(changes.map((change) => change.kind))].sort();
const governance = {
  requires_slice: changes.length > 0,
  requires_decision_review: changes.some((change) => change.category === "relationship" || change.category === "authority" || change.kind === "removed" || (change.fields || []).some((field) => ["authority", "delivery_scope", "type"].includes(field))),
  required_writebacks: [...new Set(changes.flatMap((change) => {
    if (change.category === "relationship") return ["facts_registry", "traceability_matrix"];
    if (change.category === "authority") return ["authority_documents", "facts_registry", "traceability_matrix"];
    const keys = change.fields || [];
    const result = ["facts_registry"];
    if (change.category === "slice" || keys.includes("delivery_slice")) result.push("change_slice", "implementation_status");
    if (keys.includes("authority") || keys.includes("references") || change.kind === "added" || change.kind === "removed") result.push("authority_documents", "indexes_and_traceability");
    if (keys.includes("evidence") || keys.includes("implementation_status")) result.push("verification_evidence");
    return result;
  }))].sort(),
  affected_slices: [...relatedSlices].filter((id) => currentSlices.has(id)).sort(),
  affected_facts: changedNodes.filter((id) => currentFacts.has(id)).sort(),
  affected_paths: affectedPaths,
  unbound_changes: changes.filter((change) => {
    if (change.category === "slice") return false;
    const current = currentFacts.get(change.id);
    return current?.delivery_scope === "active" && !current.delivery_slice;
  }).map((change) => change.id),
};
const output = {
  schema: "spec-docs/spec-diff/v1",
  read_only: true,
  target,
  version,
  baseline: relative(target, baselinePath).split(sep).join("/"),
  baseline_digest: baseline?.digest || null,
  current_digest: digest,
  strict,
  errors,
  changes,
  governance,
  summary: { changes: changes.length, kinds: changeKinds, errors: errors.length, affected_slices: governance.affected_slices.length, unbound_changes: governance.unbound_changes.length },
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
process.exit(strict && (errors.length > 0 || (governancePolicy.requireSliceBinding !== false && governance.unbound_changes.length > 0)) ? 1 : 0);
