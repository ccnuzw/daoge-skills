#!/usr/bin/env node
/**
 * Read-only impact analysis for an incremental change slice.
 * Usage: node change-impact.mjs --dir <project-root> [--docs-root <docs-dir>] [--slice V1-CS-001] [--feature V1-FR-001]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { normalizeRelations, readRegistry, registryNodes } from "./facts-utils.mjs";

function fail(message) {
  console.error(`[spec-docs] ${message}`);
  process.exit(1);
}

function args(argv) {
  const value = (name, fallback = null) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
  };
  return {
    target: resolve(value("--dir", process.cwd())),
    docsRoot: value("--docs-root", null),
    slice: value("--slice"),
    feature: value("--feature"),
  };
}

function files(root) {
  const result = [];
  if (!existsSync(root)) return result;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) result.push(...files(path));
    else if ([".md", ".yaml", ".yml", ".json"].includes(extname(path))) result.push(path);
  }
  return result.sort();
}

function unique(values) {
  return [...new Set(values)].sort();
}

function collect(text) {
  return {
    ids: unique([...text.matchAll(/\bV\d+-(?:FR|NFR|RG|E2E|CS)-\d{2,3}[A-Z]?\b/g)].map((m) => m[0])),
    operationIds: unique([...text.matchAll(/\boperationId\s*[:：]\s*["']?([A-Za-z][A-Za-z0-9_.-]*)/g)].map((m) => m[1])),
    entities: unique([...text.matchAll(/(?:表|实体|模型|table|entity|model)\s*[:：]?\s*[`"']?([A-Za-z][A-Za-z0-9_.-]*)/gi)].map((m) => m[1])),
    paths: unique([...text.matchAll(/(?:GET|POST|PUT|PATCH|DELETE)\s+(`[^`]+`|\/[A-Za-z0-9_./:{}-]+)/g)].map((m) => m[1].replaceAll("`", ""))),
  };
}

function resolveLinks(file, text, root) {
  const links = [];
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split("#")[0].split("?")[0];
    if (!target || /^(https?:|mailto:|data:|#)/.test(target) || target.includes("{{")) continue;
    const abs = resolve(dirname(file), target);
    links.push({ target, exists: existsSync(abs), path: relative(root, abs).split("\\").join("/") });
  }
  return links;
}

const opts = args(process.argv.slice(2));
const policyPath = join(opts.target, "docs-policy.json");
let configuredRoot = "docs";
if (existsSync(policyPath)) {
  try { configuredRoot = JSON.parse(readFileSync(policyPath, "utf8")).root || "docs"; } catch { configuredRoot = "docs"; }
}
const docsRoot = resolve(opts.target, opts.docsRoot || configuredRoot);
const allFiles = files(docsRoot);
if (!existsSync(docsRoot)) fail(`找不到 docs/ 目录：${docsRoot}`);
if (opts.slice && !/^V\d+-CS-\d{3}$/.test(opts.slice)) fail(`--slice 必须是 Vx-CS-NNN，收到：${opts.slice}`);
if (opts.feature && !/^V\d+-FR-\d{3}$/.test(opts.feature)) fail(`--feature 必须是 Vx-FR-NNN，收到：${opts.feature}`);

const selected = opts.slice
  ? allFiles.filter((path) => readFileSync(path, "utf8").includes(opts.slice))
  : allFiles;
const records = selected.map((path) => {
  const text = readFileSync(path, "utf8");
  return { path: relative(opts.target, path), ...collect(text), links: resolveLinks(path, text, opts.target) };
});
const anchor = opts.slice || opts.feature;
const anchorFiles = anchor ? records.filter((record) => record.ids.includes(anchor) || readFileSync(join(opts.target, record.path), "utf8").includes(anchor)) : records;
const aggregate = anchorFiles.reduce((out, record) => {
  out.ids.push(...record.ids);
  out.operationIds.push(...record.operationIds);
  out.entities.push(...record.entities);
  out.paths.push(...record.paths);
  return out;
}, { ids: [], operationIds: [], entities: [], paths: [] });
const related = records.filter((record) => {
  if (anchorFiles.includes(record)) return false;
  return record.ids.some((id) => aggregate.ids.includes(id)) ||
    record.operationIds.some((id) => aggregate.operationIds.includes(id)) ||
    record.entities.some((id) => aggregate.entities.includes(id)) ||
    record.paths.some((path) => aggregate.paths.includes(path));
});
const brokenLinks = records.flatMap((record) => record.links.filter((link) => !link.exists).map((link) => ({ file: record.path, target: link.target })));
const sliceRecords = records.filter((record) => record.ids.some((id) => /^V\d+-CS-\d{3}$/.test(id)));

let policy = null;
if (existsSync(policyPath)) {
  try { policy = JSON.parse(readFileSync(policyPath, "utf8")); } catch { policy = { parse_error: true }; }
}
const factsConfig = policy?.facts || {};
const registryResult = readRegistry(opts.target, factsConfig.file || "docs-facts.json");
const registry = registryResult.registry;
const graphRelations = normalizeRelations(registry);
const graphNodes = registryNodes(registry);
const graphDiagnostics = { enabled: Boolean(registry), registry: registry ? relative(opts.target, registryResult.file).split("\\").join("/") : null, broken_relations: [], unknown_nodes: [] };
for (const relation of graphRelations) {
  if (!graphNodes.has(relation.from)) graphDiagnostics.unknown_nodes.push({ side: "from", id: relation.from, relation });
  if (!graphNodes.has(relation.to)) graphDiagnostics.unknown_nodes.push({ side: "to", id: relation.to, relation });
}
const graphAnchorIds = new Set();
if (opts.slice && graphNodes.has(opts.slice)) graphAnchorIds.add(opts.slice);
if (opts.feature && graphNodes.has(opts.feature)) graphAnchorIds.add(opts.feature);
for (const id of aggregate.ids) if (graphNodes.has(id) && (!opts.slice || id === opts.slice) && (!opts.feature || id === opts.feature)) graphAnchorIds.add(id);
if (opts.slice) for (const id of aggregate.ids) if (graphNodes.has(id) && /^V\d+-(?:FR|NFR|RG|E2E)-/.test(id)) graphAnchorIds.add(id);
for (const [id, node] of graphNodes) {
  if ((opts.slice && id === opts.slice) || (opts.feature && id === opts.feature)) continue;
  const paths = [node.authority, ...(node.references || [])].filter(Boolean).map((path) => resolve(opts.target, path));
  if (paths.some((path) => anchorFiles.some((record) => resolve(opts.target, record.path) === path))) graphAnchorIds.add(id);
}
const traversableTypes = new Set(["contains", "depends_on", "defines_operation", "reads_entity", "writes_entity", "verified_by", "decided_by", "implemented_by"]);
const graphVisited = new Set(graphAnchorIds);
const graphQueue = [...graphAnchorIds];
const graphPaths = [];
while (graphQueue.length) {
  const from = graphQueue.shift();
  for (const relation of graphRelations.filter((entry) => entry.from === from && traversableTypes.has(entry.type))) {
    const path = { from, to: relation.to, type: relation.type, authority: relation.authority || null };
    graphPaths.push(path);
    if (!graphVisited.has(relation.to) && graphNodes.has(relation.to)) {
      graphVisited.add(relation.to);
      graphQueue.push(relation.to);
    }
  }
}
const graphFacts = [...graphVisited].map((id) => ({ id, ...(graphNodes.get(id) || {}) }));
const graphFiles = graphFacts.flatMap((entry) => [entry.authority, ...(entry.references || [])]).filter(Boolean).map((path) => resolve(opts.target, path)).filter((path) => existsSync(path)).map((path) => relative(opts.target, path).split("\\").join("/"));
const graphRelated = unique(graphFiles);
const output = {
  schema: "spec-docs/change-impact/v1",
  read_only: true,
  target: opts.target,
  selector: { slice: opts.slice, feature: opts.feature, docs_root: relative(opts.target, docsRoot).split("\\").join("/") || "." },
  policy: policy ? { present: true, root: policy.root || "docs", tier: policy.tier || null } : { present: false },
  anchor: {
    files: anchorFiles.map((record) => record.path),
    ids: unique(aggregate.ids),
    operationIds: unique(aggregate.operationIds),
    entities: unique(aggregate.entities),
    paths: unique(aggregate.paths),
  },
  related: related.map((record) => ({ path: record.path, ids: record.ids, operationIds: record.operationIds, entities: record.entities, paths: record.paths, links: record.links })),
  graph: {
    mode: registry ? "explicit+text" : "text-compatible",
    nodes: graphFacts,
    edges: graphPaths,
    files: graphRelated,
    paths: graphPaths,
  },
  slices: sliceRecords.map((record) => ({ path: record.path, ids: record.ids, links: record.links })),
  diagnostics: { broken_links: brokenLinks, anchor_without_feature: Boolean(opts.slice && !aggregate.ids.some((id) => /^V\d+-FR-\d{3}$/.test(id))), graph: { ...graphDiagnostics, unknown_nodes: unique(graphDiagnostics.unknown_nodes.map((entry) => JSON.stringify(entry))).map((entry) => JSON.parse(entry)) } },
  summary: { scanned_files: allFiles.length, anchor_files: anchorFiles.length, related_files: related.length, slice_files: sliceRecords.length, broken_links: brokenLinks.length },
};
console.log(JSON.stringify(output, null, 2));
