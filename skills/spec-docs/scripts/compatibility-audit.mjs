#!/usr/bin/env node
/** Read-only audit for legacy implementation-status patterns in existing docs. */
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : fallback;
};
const repoRoot = resolve(value("--repo", process.cwd()));
const configuredDocsRoot = value("--docs-root", "docs");
let docsRoot = resolve(repoRoot, configuredDocsRoot);
const json = argv.includes("--json");
const strict = argv.includes("--strict");
const includeArchive = argv.includes("--include-archive");
const findings = [];

if (configuredDocsRoot === "docs" && !existsSync(docsRoot) && existsSync(join(repoRoot, "03-功能规格"))) {
  docsRoot = repoRoot;
}

function add(code, file, line, message, migration) {
  findings.push({ code, file: relative(repoRoot, file).split(sep).join("/"), line, message, migration });
}
function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const info = lstatSync(abs);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) files.push(...walk(abs));
    else files.push(abs);
  }
  return files;
}
function lineNumber(text, index) { return text.slice(0, index).split(/\r?\n/).length; }

if (!existsSync(docsRoot)) {
  const result = { schema: "spec-docs/compatibility-audit/v1", read_only: true, ok: false, issues: [{ code: "DOCS_ROOT_MISSING", message: `找不到文档根目录：${docsRoot}` }] };
  if (json) console.log(JSON.stringify(result, null, 2)); else console.log(`[compatibility-audit] ${result.issues[0].message}`);
  process.exit(2);
}

for (const file of walk(docsRoot)) {
  if (!file.endsWith(".md")) continue;
  const relativePath = relative(docsRoot, file).split(sep).join("/");
  if (!includeArchive && (relativePath.startsWith("90-参考资料/") || relativePath.startsWith("99-历史归档/"))) continue;
  const text = readFileSync(file, "utf8");
  const featureLike = relativePath.includes("03-功能规格/") && !relativePath.endsWith("README.md") && !relativePath.includes("技术设计");
  if (!featureLike && !/^---\r?\n[\s\S]*?\bfeature_id:\s*V\d+-FR-\d+/m.test(text)) continue;

  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const status = frontmatter[1].match(/^status:\s*(.+)$/m) || frontmatter[1].match(/^implementation_status:\s*(.+)$/m);
    if (status) add("LEGACY_IMPLEMENTATION_STATUS_FRONTMATTER", file, lineNumber(text, status.index), `功能文档 frontmatter 维护了实现状态：${status[1].trim()}`, "迁移到版本实现状态表或 docs-facts.json；功能文档只保留规格状态。");
  }
  const card = text.match(/##\s+功能卡([\s\S]*?)(?=\n##\s|$)/);
  const cardStatus = card?.[1]?.match(/^\|\s*状态\s*\|/m);
  if (cardStatus) {
    const index = text.indexOf(card[1]) + card[1].indexOf(cardStatus[0]);
    add("LEGACY_IMPLEMENTATION_STATUS_CARD", file, lineNumber(text, index), "功能卡使用‘状态’字段，可能与‘规格状态’混淆", "将实现状态移入版本实现状态表；功能卡改为‘规格状态’或删除该行。");
  }
}

const result = {
  schema: "spec-docs/compatibility-audit/v1",
  read_only: true,
  repo: repoRoot,
  docs_root: relative(repoRoot, docsRoot).split(sep).join("/") || ".",
  strict,
  findings,
  summary: { findings: findings.length, files: new Set(findings.map((item) => item.file)).size },
  ok: findings.length === 0,
};
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  console.log(`[compatibility-audit] ${result.ok ? "OK" : `${findings.length} findings`}`);
  for (const finding of findings) console.log(`${finding.file}:${finding.line} [${finding.code}] ${finding.message}；${finding.migration}`);
}
process.exit(strict && findings.length > 0 ? 1 : 0);
