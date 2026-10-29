#!/usr/bin/env node
// Upgrades an existing docs/ tree to the current standard. Dry run by default: prints a diff and writes nothing.
// Usage: node scripts/migrate-docs.mjs [--docs docs] [--config 文件] [--only frontmatter,ac-table,status,renumber]
//        [--write] [--json]
// Steps: frontmatter  补 feature_id / version / domain / spec_status，删除已被实现状态表记录的旧 status
//        ac-table     验收标准表格 → "#### ACNN" 标题块（原文逐字保留，写入前校验）
//        status       实现状态与证据状态的别名改为标准词；含糊的只提示，不猜
//        renumber     文件序号对齐功能编号，并改写所有指向它们的链接
// Exit code: 0 = done (or dry run), 1 = verification failed (nothing written), 2 = bad usage.

import fs from "node:fs";
import path from "node:path";
import { buildModel, loadConfig, parseAcceptance, parseAcTestTable } from "./lib/docs-model.mjs";
import { parseFrontmatter } from "./lib/markdown.mjs";
import { evidenceCeiling } from "./lib/evidence.mjs";
import { planFeatureRenames } from "./lib/renames.mjs";
import { convertAcTables, verifyAcConversion } from "./lib/migrate-ac.mjs";
import { migrateFrontmatter, normalizeStatus } from "./lib/migrate-meta.mjs";
import { rewriteLinks, plainMentions, applyRenames } from "./lib/migrate-links.mjs";
import { unifiedDiff } from "./lib/table-edit.mjs";

const STEPS = ["frontmatter", "ac-table", "status", "renumber"];

function usage(message) {
  if (message) console.error(`错误：${message}`);
  console.error("用法: node migrate-docs.mjs [--docs docs] [--config 文件] [--only frontmatter,ac-table,status,renumber] [--write] [--json]");
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const args = { docs: "docs", config: null, only: new Set(STEPS), write: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : usage(`${arg} 需要一个值`));
    if (arg === "--docs") args.docs = next();
    else if (arg === "--config") args.config = next();
    else if (arg === "--only") args.only = new Set(next().split(",").map(item => item.trim()));
    else if (arg === "--write") args.write = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "-h" || arg === "--help") usage();
    else usage(`未知参数: ${arg}`);
  }
  for (const step of args.only) if (!STEPS.includes(step)) usage(`未知步骤“${step}”，可用：${STEPS.join("、")}`);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const docsRoot = path.resolve(args.docs);
  if (!fs.existsSync(docsRoot)) usage(`docs 目录不存在: ${docsRoot}`);
  const configPath = args.config ? path.resolve(args.config) : path.join(docsRoot, "spec-docs.config.json");
  if (args.config && !fs.existsSync(configPath)) usage(`配置文件不存在: ${configPath}`);
  const config = loadConfig(configPath);
  const { docs, model } = buildModel(docsRoot, { config });
  const archived = doc => /^99-|(^|\/)历史归档\//.test(doc.path);

  // Line endings and BOM are restored on write; every transform works on \n text.
  const raw = new Map(docs.map(doc => [doc.path, doc.source]));
  const original = new Map(docs.map(doc => [doc.path, doc.source.replace(/^﻿/, "").replace(/\r\n/g, "\n")]));
  const texts = new Map(original);
  const featureByDoc = new Map(model.features.map(feature => [`${feature.doc}.md`, feature]));
  const notes = [];
  const acChecks = new Map();
  const context = {
    ceilingFor(id, statusDoc) {
      const bare = /^\d{1,3}$/.test(id) ? id.padStart(3, "0") : null;
      const feature = model.features.find(item => item.id === id || (bare && item.version === (statusDoc.version || "V1") && item.number.padStart(3, "0") === bare));
      const doc = feature && docs.find(item => `${feature.doc}.md` === item.path);
      return doc ? evidenceCeiling(parseAcTestTable(doc.body)) : null;
    }
  };

  for (const doc of docs.filter(item => !archived(item))) {
    const feature = featureByDoc.get(doc.path);
    const apply = result => { texts.set(doc.path, result.text); notes.push(...result.notes); };
    if (feature && args.only.has("frontmatter")) {
      apply(migrateFrontmatter(texts.get(doc.path), feature, doc.path, feature.implementation.statusKey !== "unknown"));
    }
    if (feature && args.only.has("ac-table")) {
      const result = convertAcTables(texts.get(doc.path), doc.path);
      if (result.rows.length) acChecks.set(doc.path, result);
      apply(result);
    }
    if (args.only.has("status")) apply(normalizeStatus(texts.get(doc.path), doc, context));
  }

  let renames = [];
  if (args.only.has("renumber")) {
    const plan = planFeatureRenames(docs, model.features, docsRoot);
    for (const item of plan.filter(entry => entry.conflict)) notes.push({ level: "manual", text: `${item.from}: 应改名为 ${path.posix.basename(item.to)}，但目标已存在，未改名` });
    renames = plan.filter(entry => !entry.conflict).map(({ from, to }) => ({ from, to }));
    const rewritten = rewriteLinks(texts, renames);
    for (const [file, text] of rewritten.texts) texts.set(file, text);
    for (const item of renames) notes.push({ level: "info", text: `${item.from} → ${path.posix.basename(item.to)}（改写了 ${[...rewritten.counts.values()].reduce((sum, n) => sum + n, 0)} 处链接）` });
    for (const hit of plainMentions(texts, renames)) notes.push({ level: "manual", text: `${hit.file}: 文字里仍提到旧文件名 ${hit.name}，请人工确认` });
    for (const item of renames) if ((config.docGoals || {})[item.from]) notes.push({ level: "manual", text: `spec-docs.config.json 的 docGoals 仍用旧路径 ${item.from}` });
  }

  const changed = [...texts].filter(([file, text]) => text !== original.get(file));
  const problems = [];
  for (const [file, check] of acChecks) problems.push(...verifyAcConversion(check, texts.get(file)).map(text => `${file}: ${text}`));
  for (const [file, text] of changed) {
    if (acChecks.has(file)) continue;
    const ids = source => parseAcceptance(parseFrontmatter(source).body).map(item => item.id).join(",");
    if (ids(text) !== ids(original.get(file))) problems.push(`${file}: AC 编号在迁移前后不一致`);
  }

  const diffs = changed.map(([file, text]) => ({ file, diff: unifiedDiff(original.get(file), text, file) }));
  if (args.json) {
    console.log(JSON.stringify({ write: args.write && !problems.length, changed: diffs, renames, notes, problems }, null, 2));
  } else {
    for (const item of diffs) console.log(`${item.diff}\n`);
    for (const item of renames) console.log(`重命名 ${item.from} → ${item.to}`);
    const manual = notes.filter(note => note.level === "manual");
    console.log(`\n自动处理 ${notes.length - manual.length} 项，需要人工处理 ${manual.length} 项`);
    for (const note of manual) console.log(`  ✋ ${note.text}`);
    for (const text of problems) console.error(`  ✖ 校验失败 ${text}`);
  }
  if (problems.length) process.exit(1);

  if (args.write) {
    for (const [file, text] of changed) {
      const source = raw.get(file);
      const body = /\r\n/.test(source) ? text.replace(/\n/g, "\r\n") : text;
      fs.writeFileSync(path.join(docsRoot, ...file.split("/")), (source.startsWith("﻿") ? "﻿" : "") + body, "utf8");
    }
    applyRenames(docsRoot, renames);
    if (!args.json) console.log(`\n已写入 ${changed.length} 个文件${renames.length ? `，重命名 ${renames.length} 个` : ""}。接着运行 check-docs.mjs 和 generate-browser.mjs`);
  } else if (!args.json) {
    console.log(changed.length || renames.length ? "\n这是预演，没有写入任何文件。确认后加 --write 执行" : "\n没有需要迁移的内容");
  }
}

main();
