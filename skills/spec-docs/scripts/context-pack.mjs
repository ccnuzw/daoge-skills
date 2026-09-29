#!/usr/bin/env node
/**
 * Generate a read-only, task-scoped context package from docs-facts.json.
 * Usage: node context-pack.mjs [--dir <project-root>] [--feature V1-FR-001] [--slice V1-core] [--out <file>]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRelations, registryNodes } from "./facts-utils.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const target = resolve(value("--dir", process.cwd()));
const feature = value("--feature");
const slice = value("--slice");
const outputPath = value("--out");
if ((feature && slice) || (!feature && !slice)) {
  console.error("[context-pack] 必须且只能指定 --feature 或 --slice");
  process.exit(2);
}
if (feature && !/^V\d+-FR-\d{3}$/.test(feature)) {
  console.error(`[context-pack] --feature 必须是 Vx-FR-NNN，收到：${feature}`);
  process.exit(2);
}
if (slice && !/^(?:V\d+-[A-Za-z0-9][A-Za-z0-9._-]*)$/.test(slice)) {
  console.error(`[context-pack] --slice 格式无效，收到：${slice}`);
  process.exit(2);
}

function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) {
    console.error(`[context-pack] JSON 无效：${path}：${error.message}`);
    process.exit(2);
  }
}
function repoPath(path) {
  const absolute = resolve(target, path);
  const rel = relative(target, absolute).split(sep).join("/");
  if (!rel || rel.startsWith("../") || rel === "..") return null;
  return { absolute, relative: rel };
}
function unique(items) { return [...new Set(items.filter(Boolean))]; }

const policy = readJson(join(target, "docs-policy.json"), {}) || {};
const factsPath = resolve(target, value("--facts", policy.facts?.file || "docs-facts.json"));
const registry = readJson(factsPath);
if (!registry || !Array.isArray(registry.facts) || !Array.isArray(registry.slices)) {
  console.error(`[context-pack] 找不到有效事实注册表：${factsPath}`);
  process.exit(1);
}

const warnings = [];
const selectedSliceIds = new Set();
const selectedFactIds = new Set();
const sliceById = new Map(registry.slices.map((entry) => [entry.id, entry]));
const factById = new Map(registry.facts.map((entry) => [entry.id, entry]));
const nodes = registryNodes(registry);
const relations = normalizeRelations(registry);
const traversalTypes = new Set(["contains", "depends_on", "defines_operation", "reads_entity", "writes_entity", "verified_by", "decided_by", "implemented_by"]);
if (slice) selectedSliceIds.add(slice);
for (const entry of registry.facts) {
  if (feature && entry.id === feature) selectedFactIds.add(entry.id);
  if (slice && entry.delivery_slice === slice) selectedFactIds.add(entry.id);
}
if (feature) {
  const entry = factById.get(feature);
  if (!entry) warnings.push(`未在事实注册表找到功能：${feature}`);
  else if (entry.delivery_slice) selectedSliceIds.add(entry.delivery_slice);
}
if (slice && !sliceById.has(slice)) warnings.push(`未在事实注册表找到交付切片：${slice}`);

const queue = [...selectedSliceIds];
while (queue.length) {
  const id = queue.shift();
  const entry = sliceById.get(id);
  if (!entry) continue;
  for (const dependency of entry.depends_on || []) {
    if (!selectedSliceIds.has(dependency)) {
      selectedSliceIds.add(dependency);
      queue.push(dependency);
    }
  }
  for (const factId of entry.features || []) selectedFactIds.add(factId);
}
for (const id of selectedFactIds) {
  const entry = factById.get(id);
  if (!entry) {
    warnings.push(`切片引用了未登记事实：${id}`);
    continue;
  }
  if (entry.delivery_slice) selectedSliceIds.add(entry.delivery_slice);
}
const relationQueue = [...selectedFactIds, ...selectedSliceIds];
while (relationQueue.length) {
  const current = relationQueue.shift();
  for (const relation of relations.filter((entry) => traversalTypes.has(entry.type) && (entry.from === current || entry.to === current))) {
    const related = relation.from === current ? relation.to : relation.from;
    if (!nodes.has(related)) {
      warnings.push(`关系引用了未登记节点：${related}`);
      continue;
    }
    if (nodes.get(related).node_type === "fact" && !selectedFactIds.has(related)) { selectedFactIds.add(related); relationQueue.push(related); }
    if (nodes.get(related).node_type === "slice" && !selectedSliceIds.has(related)) { selectedSliceIds.add(related); relationQueue.push(related); }
  }
}

const selectedFacts = [...selectedFactIds].map((id) => factById.get(id)).filter(Boolean);
const selectedSlices = [...selectedSliceIds].map((id) => sliceById.get(id)).filter(Boolean);
const documents = [];
for (const entry of [...selectedFacts, ...selectedSlices]) {
  for (const reference of [entry.authority, ...(entry.references || []), ...(entry.evidence || [])]) {
    if (!reference || /^https?:\/\//.test(reference)) continue;
    const safe = repoPath(reference);
    if (!safe) {
      warnings.push(`路径越出仓库：${reference}`);
      continue;
    }
    if (!existsSync(safe.absolute)) warnings.push(`引用文件不存在：${reference}`);
    else documents.push(safe.relative);
  }
}
const packageData = {
  schema: "spec-docs/context-pack/v1",
  read_only: true,
  generated_by: "scripts/context-pack.mjs",
  selector: { feature, slice },
  registry: relative(target, factsPath).split(sep).join("/"),
  active_version: registry.version || policy.activeVersion || null,
  facts: selectedFacts,
  slices: selectedSlices,
  relations: relations.filter((relation) => selectedFactIds.has(relation.from) || selectedFactIds.has(relation.to) || selectedSliceIds.has(relation.from) || selectedSliceIds.has(relation.to)),
  documents: unique(documents),
  warnings: unique(warnings),
};
const serialized = `${JSON.stringify(packageData, null, 2)}\n`;
if (outputPath) {
  const destination = resolve(target, outputPath);
  const safe = repoPath(outputPath);
  if (!safe) {
    console.error(`[context-pack] --out 必须位于仓库内：${outputPath}`);
    process.exit(2);
  }
  writeFileSync(destination, serialized, "utf8");
} else {
  process.stdout.write(serialized);
}
