import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

export const FACT_TYPES = new Set(["requirement", "nfr", "release_gate", "feature", "operation", "entity", "decision", "acceptance", "evidence", "scenario", "constraint", "risk", "test_asset", "artifact", "migration"]);
export const RELATION_TYPES = new Set(["contains", "depends_on", "defines_operation", "reads_entity", "writes_entity", "verified_by", "decided_by", "supersedes", "implemented_by"]);

export function readRegistry(repoRoot, configuredFile = "docs-facts.json") {
  const file = resolve(repoRoot, configuredFile);
  if (!existsSync(file)) return { file, registry: null, error: "missing" };
  try { return { file, registry: JSON.parse(readFileSync(file, "utf8")), error: null }; }
  catch (error) { return { file, registry: null, error: error.message }; }
}

export function normalizeRelations(registry) {
  const relations = [];
  for (const relation of registry?.relations || []) {
    if (!relation || typeof relation !== "object") continue;
    relations.push({ from: relation.from, to: relation.to, type: relation.type || "depends_on", authority: relation.authority || null });
  }
  for (const slice of registry?.slices || []) {
    for (const feature of slice.features || []) relations.push({ from: slice.id, to: feature, type: "contains", authority: slice.authority || null });
    for (const dependency of slice.depends_on || []) relations.push({ from: slice.id, to: dependency, type: "depends_on", authority: slice.authority || null });
  }
  for (const fact of registry?.facts || []) {
    if (fact.delivery_slice) relations.push({ from: fact.delivery_slice, to: fact.id, type: "contains", authority: fact.authority || null });
    for (const dependency of fact.depends_on || []) relations.push({ from: fact.id, to: dependency, type: "depends_on", authority: fact.authority || null });
    for (const dependency of fact.relations?.depends_on || []) relations.push({ from: fact.id, to: dependency, type: "depends_on", authority: fact.authority || null });
  }
  const seen = new Set();
  return relations.filter((relation) => {
    const key = `${relation.from}|${relation.to}|${relation.type}`;
    if (!relation.from || !relation.to || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function registryNodes(registry) {
  const nodes = new Map();
  for (const fact of registry?.facts || []) if (fact?.id) nodes.set(fact.id, { ...fact, node_type: "fact" });
  for (const slice of registry?.slices || []) if (slice?.id) nodes.set(slice.id, { ...slice, node_type: "slice" });
  return nodes;
}

export function registryRelativePath(repoRoot, value) {
  if (!value || typeof value !== "string" || /^https?:\/\//.test(value)) return null;
  const absolute = value.startsWith("/") ? resolve(repoRoot, `.${value}`) : resolve(repoRoot, value);
  try {
    const realRepo = realpathSync(repoRoot);
    const realPath = realpathSync(absolute);
    if (realPath !== realRepo && !realPath.startsWith(`${realRepo}${sep}`)) return null;
  } catch { return null; }
  return absolute;
}

export function outgoingRelations(relations, nodeId) { return relations.filter((relation) => relation.from === nodeId); }
export function incomingRelations(relations, nodeId) { return relations.filter((relation) => relation.to === nodeId); }

export function factEvidenceRefs(node) {
  return Array.isArray(node?.evidence) ? node.evidence.filter((entry) => typeof entry === "string" || (entry && typeof entry === "object")) : [];
}

export function evidenceId(entry) {
  return typeof entry === "string" ? entry : entry?.id || entry?.report || entry?.path || null;
}
