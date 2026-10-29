#!/usr/bin/env node
// Generates an offline, project-agnostic document viewer for a docs/ tree.
// Output: <docs>/<out>/产品文档浏览器.html + 产品文档浏览器-文档数据.js
// Usage: node scripts/generate-browser.mjs [--docs docs] [--out 90-参考资料] [--config docs/spec-docs.config.json]
//        [--project 名称] [--json] [--strict] [--stamp] [--check]
// The output is a pure function of the docs: no timestamp (unless --stamp) and no local paths, so
// --check can tell "stale" from "regenerated" by comparing bytes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, loadConfig } from "./lib/docs-model.mjs";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = path.join(SKILL_ROOT, "assets", "browser");
const HTML_NAME = "产品文档浏览器.html";
const DATA_NAME = "产品文档浏览器-文档数据.js";

function parseArgs(argv) {
  const args = { docs: "docs", out: null, config: null, project: null, json: false, strict: false, stamp: false, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${arg} 需要一个值`);
      return argv[++i];
    };
    if (arg === "--docs") args.docs = next();
    else if (arg === "--out") args.out = next();
    else if (arg === "--config") args.config = next();
    else if (arg === "--project") args.project = next();
    else if (arg === "--json") args.json = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--stamp") args.stamp = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "-h" || arg === "--help") {
      console.log("用法: node generate-browser.mjs [--docs docs] [--out 90-参考资料] [--config 文件] [--project 名称] [--json] [--strict] [--stamp] [--check]");
      console.log("  --stamp  在数据里写入生成时间（默认不写，同一份文档每次生成的结果完全一致）");
      console.log("  --check  不写文件，只比较现有产物是否过期；过期时退出码为 1");
      process.exit(0);
    } else fail(`未知参数: ${arg}`);
  }
  return args;
}

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(2);
}

// JSON is embedded in a <script> file; escape sequences that could end the script or break JS parsing.
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char]);
}

// The viewer shares stripInline / githubSlug / createSlugger with check-docs: one algorithm, inlined here.
function sharedMarkdownSource() {
  const source = fs.readFileSync(path.join(SKILL_ROOT, "scripts", "lib", "markdown.mjs"), "utf8");
  const match = /\/\/ ---- shared:start[^\n]*\n([\s\S]*?)\/\/ ---- shared:end/.exec(source);
  if (!match) fail("scripts/lib/markdown.mjs 缺少 shared:start / shared:end 标记");
  return match[1].replace(/^export /gm, "");
}

function brandMark(name) {
  const latin = String(name).match(/[A-Za-z0-9]/g);
  if (latin && latin.length >= 2) return latin.slice(0, 2).join("").toUpperCase();
  return Array.from(String(name).trim())[0] || "文";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const docsRoot = path.resolve(args.docs);
  if (!fs.existsSync(docsRoot) || !fs.statSync(docsRoot).isDirectory()) fail(`docs 目录不存在: ${docsRoot}`);

  const configPath = args.config ? path.resolve(args.config) : path.join(docsRoot, "spec-docs.config.json");
  if (args.config && !fs.existsSync(configPath)) fail(`配置文件不存在: ${configPath}`);
  const config = loadConfig(configPath);
  const outDir = path.join(docsRoot, args.out || (config.browser && config.browser.outDir) || "90-参考资料");
  const outRel = path.relative(docsRoot, outDir).split(path.sep).join("/");
  if (outRel.startsWith("..")) fail("--out 必须位于 docs 目录内");

  const { docs, model } = buildModel(docsRoot, { config, projectName: args.project });
  if (!docs.length) fail(`${docsRoot} 下没有 Markdown 文件`);

  const evolution = model.evolutionDoc ? docs.find(doc => doc.id === model.evolutionDoc) : null;
  const depth = outRel ? outRel.split("/").length : 0;
  const data = {
    schemaVersion: 2,
    ...(args.stamp ? { generatedAt: new Date().toISOString() } : {}),
    generator: "spec-docs-pro/generate-browser",
    docsBase: "../".repeat(depth),
    evolutionPath: evolution ? evolution.path : "",
    ...model,
    content: Object.fromEntries(docs.map(doc => [doc.id, doc.source]))
  };

  const read = name => fs.readFileSync(path.join(ASSETS, name), "utf8");
  const js = [sharedMarkdownSource(), ...["viewer.js", "viewer-markdown.js", "viewer-views.js"].map(read)].join("\n\n");
  const html = read("viewer.html")
    .replace("{{TITLE}}", () => escapeHtml(`${model.project.name} 产品文档浏览器`))
    .replace("{{PROJECT}}", () => escapeHtml(model.project.name))
    .replace("{{BRAND}}", () => escapeHtml(brandMark(model.project.name)))
    .replace("{{DATA_FILE}}", () => encodeURI(DATA_NAME))
    .replace("{{CSS}}", () => read("viewer.css"))
    .replace("{{JS}}", () => js.replace(/<\/script/gi, "<\\/script"));

  const htmlPath = path.join(outDir, HTML_NAME);
  const dataPath = path.join(outDir, DATA_NAME);
  // No path in the header: it would differ per machine and make every checkout look stale.
  const dataText = `// 由 spec-docs-pro 生成，请勿手工编辑。重新生成：node <skill>/scripts/generate-browser.mjs --docs <docs 目录>\nwindow.SPEC_DOCS_DATA = ${safeJson(data)};\n`;

  if (args.check) {
    // --stamp adds the only run-dependent field, so it is ignored when comparing.
    const unstamp = text => text.replace(/"generatedAt":"[^"]*",/, "");
    const stale = [[htmlPath, html], [dataPath, dataText]]
      .filter(([file, text]) => !fs.existsSync(file) || unstamp(fs.readFileSync(file, "utf8")) !== unstamp(text))
      .map(([file]) => path.relative(process.cwd(), file));
    if (args.json) console.log(JSON.stringify({ upToDate: !stale.length, stale }, null, 2));
    else if (stale.length) console.error(`文档浏览器已过期，需要重新生成：\n${stale.map(file => `  ${file}`).join("\n")}\n运行：node <skill>/scripts/generate-browser.mjs --docs ${args.docs}`);
    else console.log("文档浏览器与文档一致");
    process.exit(stale.length ? 1 : 0);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(dataPath, dataText, "utf8");
  fs.writeFileSync(htmlPath, html, "utf8");

  const summary = {
    project: model.project.name,
    docs: model.docs.length,
    features: model.features.length,
    featuresWithoutStatus: model.features.filter(item => item.implementation.statusKey === "unknown").length,
    decisions: model.decisions.length,
    adrs: model.adrs.length,
    versions: model.versions.map(item => `${item.id}(${item.kind})`),
    tracks: model.tracks.length,
    warnings: model.warnings.length,
    html: path.relative(process.cwd(), htmlPath),
    data: path.relative(process.cwd(), dataPath),
    sizeKB: {
      html: Number((fs.statSync(htmlPath).size / 1024).toFixed(1)),
      data: Number((fs.statSync(dataPath).size / 1024).toFixed(1))
    }
  };
  // Every document is inlined in full, which is fine offline until the set grows large.
  // The threshold is a hint, not an error: it never affects --strict.
  const limitKB = Number((config.browser && config.browser.dataWarnKB) || 2048);
  summary.sizeWarning = summary.sizeKB.data > limitKB
    ? `数据文件 ${summary.sizeKB.data} KB，超过提示阈值 ${limitKB} KB；打开会变慢。可在配置 exclude 里排除归档目录，或调整 browser.dataWarnKB`
    : null;

  if (args.json) {
    console.log(JSON.stringify({ ...summary, warningList: model.warnings }, null, 2));
  } else {
    console.log(`项目：${summary.project}`);
    console.log(`文档 ${summary.docs} · 功能 ${summary.features}（未同步状态 ${summary.featuresWithoutStatus}）· 决策 ${summary.decisions} · ADR ${summary.adrs}`);
    console.log(`版本：${summary.versions.join(" ") || "无"} · 能力主线 ${summary.tracks}`);
    console.log(`输出：${summary.html}（${summary.sizeKB.html} KB）`);
    console.log(`      ${summary.data}（${summary.sizeKB.data} KB）`);
    if (summary.sizeWarning) console.log(`提示：${summary.sizeWarning}`);
    if (model.warnings.length) {
      console.log(`\n数据质量提示 ${model.warnings.length} 条：`);
      for (const item of model.warnings.slice(0, 20)) console.log(`  [${item.code}] ${item.message}`);
      if (model.warnings.length > 20) console.log(`  … 另有 ${model.warnings.length - 20} 条，使用 --json 查看全部`);
    }
  }
  if (args.strict && model.warnings.length) process.exit(1);
}

main();
