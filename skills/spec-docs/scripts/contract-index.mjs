#!/usr/bin/env node
/** Build a read-only machine-readable index across HTTP, event, driver, migration, and page contracts. */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const target = resolve(value("--dir", process.cwd()));
const outputPath = value("--out");
const strict = argv.includes("--strict");
const json = argv.includes("--json") || Boolean(outputPath);
const errors = [];
const warnings = [];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", ".spec-docs"].includes(entry)) continue;
    const file = join(dir, entry);
    const info = lstatSync(file);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) files.push(...walk(file));
    else files.push(file);
  }
  return files;
}
function rel(file) { return relative(target, file).split(sep).join("/"); }
function safePath(path) { const absolute = resolve(target, path); return absolute === target || absolute.startsWith(`${target}${sep}`) ? absolute : null; }
const policy = readPolicy();
const docsRoot = resolve(target, policy.root || "docs");
function configuredPath(path) {
  const candidates = [resolve(docsRoot, path), resolve(target, path)];
  const safe = candidates.filter((candidate) => candidate === target || candidate.startsWith(`${target}${sep}`));
  return safe.find((candidate) => existsSync(candidate)) || safe[0] || null;
}
function featureIdsFrom(text) { return [...new Set([...String(text).matchAll(/\bV\d+-FR-\d{3}\b/g)].map((match) => match[0]))]; }
function readPolicy() {
  const path = join(target, "docs-policy.json");
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) { errors.push({ code: "POLICY_INVALID", message: error.message }); return {}; }
}
function addSourceContract(type, path, source, text = "") {
  const entry = { type, path: rel(path), authority: source || rel(path), feature_ids: featureIdsFrom(text), operations: [] };
  contracts.push(entry);
  return entry;
}
function parseOpenApi(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const pathRe = /^\s{2}(\/[^:#]+):\s*$/;
  const methodRe = /^\s{4}(get|post|put|patch|delete|head|options|trace):\s*$/i;
  let currentPath = null;
  const current = addSourceContract("http", path, null, "");
  let entry = null;
  const flush = () => {
    if (!entry) return;
    if (!entry.operation_id) warnings.push({ code: "OPERATION_ID_MISSING", path: rel(path), line: entry.line, message: `${currentPath} ${entry.method} 缺少 operationId` });
    if (entry.operation_id) current.operations.push(entry);
    entry = null;
  };
  for (const [index, line] of lines.entries()) {
    const pathMatch = line.match(pathRe);
    if (pathMatch) { flush(); currentPath = pathMatch[1].trim(); continue; }
    const methodMatch = line.match(methodRe);
    if (methodMatch && currentPath) { flush(); entry = { method: methodMatch[1].toUpperCase(), path: currentPath, line: index + 1, operation_id: null, feature_id: null, implementation_status: null }; continue; }
    if (!entry) continue;
    const operation = line.match(/^\s+operationId:\s*([^\s#]+)/);
    const feature = line.match(/^\s+x-tag-feature:\s*([^\s#]+)/);
    const implementation = line.match(/^\s+x-tag-implementation-status:\s*([^\s#]+)/);
    if (operation) entry.operation_id = operation[1];
    if (feature) entry.feature_id = feature[1];
    if (implementation) entry.implementation_status = implementation[1];
  }
  flush();
  return current;
}

const configuredOpenApi = policy.openapi ? configuredPath(String(policy.openapi).replaceAll("{{活跃版本}}", policy.activeVersion || "V1")) : null;
const files = walk(target);
const openapiFiles = configuredOpenApi ? [configuredOpenApi] : files.filter((file) => /(?:openapi|swagger)[^/]*\.(yaml|yml|json)$/i.test(rel(file)));
const contracts = [];
const openapiSeen = new Set();
for (const file of openapiFiles.filter(Boolean)) {
  if (!existsSync(file)) { errors.push({ code: "OPENAPI_MISSING", path: rel(file), message: `找不到 OpenAPI 文件：${rel(file)}` }); continue; }
  openapiSeen.add(file);
  parseOpenApi(file);
}

const configuredSources = Array.isArray(policy.contracts?.sources) ? policy.contracts.sources : [];
for (const source of configuredSources) {
  const path = configuredPath(String(source.path || ""));
  if (!path || !existsSync(path)) { errors.push({ code: "CONTRACT_SOURCE_MISSING", path: source.path, message: `契约来源不存在：${source.path}` }); continue; }
  const text = readFileSync(path, "utf8");
  const entry = addSourceContract(source.type || "custom", path, source.authority, text);
  const pattern = source.operationPattern ? new RegExp(source.operationPattern, "g") : /(?:operationId|event[_-]?name|driver[_-]key|schema[_-]id)\s*[:=]\s*["'`]?([A-Za-z0-9._:-]+)/gi;
  entry.operations = [...text.matchAll(pattern)].map((match, index) => ({ id: match[1] || match[0], line: text.slice(0, match.index || 0).split(/\r?\n/).length, feature_id: featureIdsFrom(match[0])[0] || null, ordinal: index + 1 }));
}

const migrationFiles = files.filter((file) => /(^|\/)(migrations?|db|database)\//i.test(rel(file)) && /\.sql$/i.test(file));
for (const file of migrationFiles) addSourceContract("migration", file, null, readFileSync(file, "utf8"));
const pageFiles = files.filter((file) => /(?:页面路由矩阵|route|router|routes)\.(md|json|ya?ml)$/i.test(rel(file)));
for (const file of pageFiles) addSourceContract("page", file, null, readFileSync(file, "utf8"));

const factsPath = policy.facts?.file ? safePath(policy.facts.file) : join(target, "docs-facts.json");
let knownFeatures = new Set();
if (factsPath && existsSync(factsPath)) {
  try {
    const facts = JSON.parse(readFileSync(factsPath, "utf8"));
    knownFeatures = new Set((facts.facts || []).map((fact) => fact.id).filter(Boolean));
  } catch { warnings.push({ code: "FACTS_INVALID", message: "无法解析 docs-facts.json，跳过 operation 功能 ID 校验" }); }
}
let operations = 0;
let mappedOperations = 0;
for (const contract of contracts) {
  for (const operation of contract.operations || []) {
    operations += 1;
    const featureId = operation.feature_id || featureIdsFrom(JSON.stringify(operation))[0] || null;
    if (featureId) mappedOperations += 1;
    if (featureId && knownFeatures.size && !knownFeatures.has(featureId)) errors.push({ code: "OPERATION_FEATURE_UNKNOWN", path: contract.path, operation: operation.operation_id || operation.id, feature_id: featureId, message: `操作引用未登记事实：${featureId}` });
  }
}
const result = {
  schema: "spec-docs/contract-index/v1",
  read_only: !outputPath,
  target,
  contracts,
  coverage: { contracts: contracts.length, operations, mapped_operations: mappedOperations, operation_mapping: operations ? Number((mappedOperations / operations).toFixed(4)) : 1 },
  errors,
  warnings,
};
if (outputPath) {
  const safe = safePath(outputPath);
  if (!safe) { console.error("[contract-index] --out 必须位于项目根目录内"); process.exit(2); }
  mkdirSync(resolve(safe, ".."), { recursive: true });
  writeFileSync(safe, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  console.log(`[contract-index] contracts=${contracts.length} operations=${operations} mapped=${mappedOperations}`);
  for (const issue of [...errors, ...warnings]) console.log(`[${issue.code}] ${issue.message}`);
}
process.exit(strict && errors.length ? 1 : 0);
