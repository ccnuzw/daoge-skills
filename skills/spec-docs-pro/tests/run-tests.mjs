#!/usr/bin/env node
// Self-test for the bundled scripts. Uses only Node built-ins; writes to a temp directory.
// Usage: node tests/run-tests.mjs [--browser /path/to/playwright]
// With --browser (or SPEC_DOCS_PLAYWRIGHT), also renders every view in headless Chromium.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const temps = [];

function copyFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `spec-docs-${name}-`));
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  temps.push(dir);
  return dir;
}

// A copy of the minimal fixture with files added or replaced: { "docs-relative/path.md": "content" }.
// A value of null deletes the file. Returns the project directory (run scripts with --docs docs).
function docsWith(files = {}, base = "minimal") {
  const dir = copyFixture(base);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, "docs", ...rel.split("/"));
    if (content === null) { fs.rmSync(target, { force: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return dir;
}

function check(dir, extra = []) {
  const run = runNode("check-docs.mjs", ["--docs", "docs", "--json", ...extra], dir);
  const out = JSON.parse(run.stdout || "{}");
  return { status: run.status, findings: out.findings || [], summary: out.summary || {}, stderr: run.stderr };
}

function runNode(script, args, cwd) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { cwd, encoding: "utf8" });
}

function loadData(dataFile) {
  const sandbox = { window: {} };
  new Function("window", fs.readFileSync(dataFile, "utf8"))(sandbox.window);
  return sandbox.window.SPEC_DOCS_DATA;
}

const syntaxFiles = [
  ...fs.readdirSync(path.join(ROOT, "scripts")).filter(f => f.endsWith(".mjs")).map(f => path.join(ROOT, "scripts", f)),
  ...fs.readdirSync(path.join(ROOT, "scripts", "lib")).map(f => path.join(ROOT, "scripts", "lib", f))
];
test("scripts pass node --check", () => {
  for (const file of syntaxFiles) execFileSync(process.execPath, ["--check", file]);
});

// Top-level rules only: a padding rule inside @media does not style the table at desktop widths.
function topLevelCssRules(css) {
  const rules = [];
  let depth = 0, start = 0, bodyStart = 0, selector = "";
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") {
      if (depth === 0) { selector = source.slice(start, i).trim(); bodyStart = i + 1; }
      depth += 1;
    } else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) { rules.push({ selector, body: source.slice(bodyStart, i) }); start = i + 1; }
    }
  }
  return rules.filter(rule => !rule.selector.startsWith("@"));
}

test("every table the viewer emits is covered by a th/td padding rule in viewer.css", () => {
  const browserDir = path.join(ROOT, "assets", "browser");
  const css = fs.readFileSync(path.join(browserDir, "viewer.css"), "utf8");
  const tagsByClass = new Map();
  for (const { selector, body } of topLevelCssRules(css)) {
    if (!/(?:^|[;\s])padding(?:-[a-z]+)?\s*:/.test(body)) continue;
    for (const part of selector.split(",")) {
      const match = part.trim().match(/^\.([\w-]+)(?:\s+.*)?\s+(th|td)$/);
      if (match) tagsByClass.set(match[1], (tagsByClass.get(match[1]) || new Set()).add(match[2]));
    }
  }
  const styled = new Set([...tagsByClass].filter(([, tags]) => tags.has("th") && tags.has("td")).map(([cls]) => cls));

  const scripts = fs.readdirSync(browserDir).filter(f => /^viewer.*\.js$/.test(f));
  // Markdown tables render inside <article class="article">; confirm every host really does.
  const unwrapped = scripts.flatMap(file => fs.readFileSync(path.join(browserDir, file), "utf8").split("\n"))
    .filter(line => line.includes("${rendered.html}") && !line.includes('class="article"'));
  assert(!unwrapped.length, `markdown rendered outside .article, its tables lose styling: ${unwrapped.join(" | ").trim()}`);

  const unstyled = [];
  let sites = 0;
  for (const file of scripts) {
    const source = fs.readFileSync(path.join(browserDir, file), "utf8");
    for (const match of source.matchAll(/<table\b([^>]*)>/g)) {
      sites += 1;
      const wrapper = source.slice(0, match.index).match(/<[a-z][^<>]*\sclass="([^"]*)"[^<>]*>\s*$/i);
      const own = match[1].match(/\sclass="([^"]*)"/);
      const classes = [own && own[1], wrapper && wrapper[1], file === "viewer-markdown.js" ? "article" : ""]
        .filter(Boolean).join(" ").split(/\s+/);
      if (!classes.some(cls => styled.has(cls))) {
        const line = source.slice(0, match.index).split("\n").length;
        unstyled.push(`${file}:${line} <table> (classes: ${classes.join(" ") || "none"})`);
      }
    }
  }
  assert(sites > 0, "found no <table> in viewer scripts; the scan pattern is stale");
  assert(!unstyled.length, `no th+td padding rule in viewer.css for: ${unstyled.join("; ")}`);
});

const minimal = copyFixture("minimal");
const gen = runNode("generate-browser.mjs", ["--docs", "docs", "--json"], minimal);
const outDir = path.join(minimal, "docs", "90-参考资料");
const htmlFile = path.join(outDir, "产品文档浏览器.html");
const dataFile = path.join(outDir, "产品文档浏览器-文档数据.js");

test("generate-browser succeeds on minimal fixture", () => {
  assert(gen.status === 0, `exit ${gen.status}: ${gen.stderr}`);
  assert(fs.existsSync(htmlFile) && fs.existsSync(dataFile), "output files missing");
});

test("viewer HTML has no template placeholders or project-specific leftovers", () => {
  const html = fs.readFileSync(htmlFile, "utf8");
  assert(!/\{\{[A-Z_]+\}\}/.test(html), "unreplaced {{PLACEHOLDER}}");
  assert(!/TUZAI|DG-OS|DGOS|协议网关|供给路由/.test(html), "project-specific content in viewer");
  const inline = html.split("<script>")[1].split("</script>")[0];
  new Function(inline);
});

test("data model extracts features, versions, tracks, decisions", () => {
  const data = loadData(dataFile);
  assert(data.project.name === "Acme", `project name ${data.project.name}`);
  assert(data.features.length === 2, `features ${data.features.length}`);
  const reg = data.features.find(f => f.id === "V1-FR-001");
  assert(reg && reg.risk === "high" && reg.design, "V1-FR-001 should be high risk with design doc");
  assert(reg.implementation.statusLabel === "本地验证", `status ${reg.implementation.statusLabel}`);
  assert(reg.track, "V1-FR-001 should map to a track");
  assert(data.versions.map(v => `${v.id}:${v.kind}`).join(",") === "V1:current,V2:planned", `versions ${data.versions.map(v => v.id + v.kind)}`);
  assert(data.tracks.length === 1 && data.tracks[0].stages.length === 3, "track stages");
  assert(data.tracks[0].stages.some(s => s.gate), "gate stage detected");
  assert(data.decisions.length === 1 && data.decisions[0].statusKey === "frozen", "decision parsed");
  assert(data.adrs.length === 1, "adr parsed");
  assert(data.warnings.length === 0, `unexpected warnings ${JSON.stringify(data.warnings)}`);
});

test("check-docs passes on minimal fixture", () => {
  const run = runNode("check-docs.mjs", ["--docs", "docs", "--json"], minimal);
  const out = JSON.parse(run.stdout);
  assert(run.status === 0, `exit ${run.status}: ${JSON.stringify(out.findings, null, 1)}`);
  assert(out.summary.errors === 0 && out.summary.warnings === 0, `findings ${JSON.stringify(out.findings)}`);
});

const broken = copyFixture("broken");
test("check-docs reports every seeded problem in broken fixture", () => {
  const run = runNode("check-docs.mjs", ["--docs", "docs", "--json"], broken);
  assert(run.status === 1, `expected exit 1, got ${run.status}`);
  const codes = new Set(JSON.parse(run.stdout).findings.map(f => f.code));
  const expected = ["ID001", "ID002", "AC002", "AC003", "AC005", "AC007", "LNK001", "REF001", "REF002", "BR001", "BR002",
    "ST002", "ST004", "DC001", "EV001", "EV005", "TPL001"];
  const missing = expected.filter(code => !codes.has(code));
  assert(!missing.length, `missing codes: ${missing.join(", ")}; got ${[...codes].join(", ")}`);
});

test("generate-browser escapes hostile content in data file", () => {
  const run = runNode("generate-browser.mjs", ["--docs", "docs"], broken);
  assert(run.status === 0, `exit ${run.status}: ${run.stderr}`);
  const data = fs.readFileSync(path.join(broken, "docs", "90-参考资料", "产品文档浏览器-文档数据.js"), "utf8");
  assert(!/<\/script/i.test(data), "raw </script in data file");
  assert(!/<img/i.test(data), "raw <img in data file");
});

test("--strict exits non-zero when data warnings exist", () => {
  const run = runNode("generate-browser.mjs", ["--docs", "docs", "--strict"], broken);
  assert(run.status === 1, `expected exit 1, got ${run.status}`);
});

// Rule and behaviour tests live in tests/cases/*.mjs. Each file exports register(ctx).
const ctx = { ROOT, FIXTURES, test, assert, copyFixture, docsWith, check, runNode, loadData, results };
const casesDir = path.join(ROOT, "tests", "cases");
for (const file of fs.existsSync(casesDir) ? fs.readdirSync(casesDir).filter(f => f.endsWith(".mjs")).sort() : []) {
  await (await import(pathToFileURL(path.join(casesDir, file)).href)).register(ctx);
}

// Browser tests need Playwright. Order: --browser <path>, SPEC_DOCS_PLAYWRIGHT, then a normal
// require("playwright") from here or the working directory. --require-browser turns "not run" into a failure.
const explicitPlaywright = (() => {
  const index = process.argv.indexOf("--browser");
  return index > 0 ? process.argv[index + 1] : process.env.SPEC_DOCS_PLAYWRIGHT;
})();
const requireBrowser = process.argv.includes("--require-browser");
const browserStatus = { ran: false, note: "" };

function loadPlaywright() {
  const requirers = [createRequire(import.meta.url), createRequire(path.join(process.cwd(), "noop.js"))];
  for (const candidate of explicitPlaywright ? [explicitPlaywright] : ["playwright", "playwright-core"]) {
    for (const load of requirers) {
      try { return load(candidate); } catch { /* try the next place */ }
    }
  }
  return null;
}

async function browserTests() {
  const unavailable = note => {
    browserStatus.note = note;
    if (explicitPlaywright || requireBrowser) results.push({ name: "browser tests can start", ok: false, error: note });
  };
  const playwright = loadPlaywright();
  if (!playwright) return unavailable(explicitPlaywright ? `无法加载 playwright：${explicitPlaywright}` : "没有找到 playwright 模块");
  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (error) {
    return unavailable(`找到了 playwright，但无法启动 Chromium：${String(error.message).split("\n")[0]}`);
  }
  browserStatus.ran = true;
  try {
    for (const [label, file] of [["minimal", htmlFile], ["broken", path.join(broken, "docs", "90-参考资料", "产品文档浏览器.html")]]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", dialog => { errors.push(`dialog: ${dialog.message()}`); dialog.dismiss(); });
      await page.goto(`file://${file}`);
      const problems = [];
      for (const view of ["overview", "reader", "features", "map", "evolution", "timeline"]) {
        await page.click(`.segmented button[data-view="${view}"]`);
        await page.waitForTimeout(80);
        const text = await page.locator("#content").innerText();
        if (/undefined|NaN|\[object Object\]/.test(text)) problems.push(`${view}: undefined/NaN in output`);
        if (text.trim().length < 20) problems.push(`${view}: empty view`);
      }
      for (const index of [0, 1, 2]) {
        const items = page.locator(".doc-item");
        if ((await items.count()) <= index) break;
        await page.locator(".doc-group > summary").first().click().catch(() => {});
        await page.evaluate(i => document.querySelectorAll(".doc-item")[i].click(), index);
        await page.waitForTimeout(50);
      }
      const pwned = await page.evaluate(() => window.__pwned === 1);
      const jsLinks = await page.locator('a[href^="javascript:"]').count();
      results.push({
        name: `browser renders all views without errors (${label})`,
        ok: !errors.length && !problems.length && !pwned && !jsLinks,
        error: [...errors, ...problems, pwned ? "script injection executed" : "", jsLinks ? "javascript: link rendered" : ""].filter(Boolean).join("; ")
      });
      await page.close();
    }

    // Table styling: a table missing its CSS renders with the browser defaults (th padding 1px, border-collapse separate).
    const page = await browser.newPage();
    await page.goto(`file://${htmlFile}`);
    const tableStyles = () => page.evaluate(() => [...document.querySelectorAll("#content table")].map(table => {
      const th = table.querySelector("th");
      const style = getComputedStyle(th);
      return { where: table.parentElement.className || table.className, padding: style.paddingTop, collapse: style.borderCollapse };
    }));
    const styleProblems = [];
    for (const view of ["overview", "reader", "features", "evolution"]) {
      await page.click(`.segmented button[data-view="${view}"]`);
      await page.waitForTimeout(80);
      if (view === "reader") {
        // The reader opens on a document without tables; open the first one that has a table.
        const count = await page.locator(".doc-item").count();
        for (let i = 0; i < count && !(await tableStyles()).length; i++) {
          await page.evaluate(index => document.querySelectorAll(".doc-item")[index].click(), i);
          await page.waitForTimeout(50);
        }
      }
      const tables = await tableStyles();
      if (!tables.length) styleProblems.push(`${view}: no table rendered, nothing to check`);
      for (const { where, padding, collapse } of tables) {
        if (padding === "1px") styleProblems.push(`${view} (${where}): th padding is the browser default 1px`);
        if (collapse !== "collapse") styleProblems.push(`${view} (${where}): border-collapse is ${collapse}`);
      }
    }
    results.push({ name: "browser tables are styled in overview, reader, features and evolution views", ok: !styleProblems.length, error: styleProblems.join("; ") });
    await page.close();

    // No view may scroll the page sideways at phone, tablet or desktop width; wide tables scroll inside .table-wrap.
    const overflowProblems = [];
    for (const width of [390, 820, 1440]) {
      const sized = await browser.newPage({ viewport: { width, height: 900 } });
      await sized.goto(`file://${htmlFile}`);
      for (const view of ["overview", "reader", "features", "map", "evolution", "timeline"]) {
        await sized.click(`.segmented button[data-view="${view}"]`);
        await sized.waitForTimeout(80);
        const m = await sized.evaluate(() => {
          const doc = document.documentElement;
          const wraps = [...document.querySelectorAll("#content .table-wrap")];
          return {
            page: doc.scrollWidth - doc.clientWidth,
            escaping: wraps.filter(wrap => wrap.getBoundingClientRect().right > doc.clientWidth + 1).length,
            hiddenWide: wraps.filter(wrap => wrap.scrollWidth > wrap.clientWidth && getComputedStyle(wrap).overflowX === "visible").length
          };
        });
        if (m.page > 0) overflowProblems.push(`${view}@${width}: page scrolls sideways by ${m.page}px`);
        if (m.escaping) overflowProblems.push(`${view}@${width}: ${m.escaping} table wrapper(s) extend past the viewport`);
        if (m.hiddenWide) overflowProblems.push(`${view}@${width}: wide table is not scrollable`);
      }
      await sized.close();
    }
    results.push({ name: "browser views have no page-level horizontal overflow at 390 / 820 / 1440", ok: !overflowProblems.length, error: overflowProblems.join("; ") });
  } finally {
    await browser.close();
  }
}

await browserTests();

for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
let failed = 0;
for (const result of results) {
  console.log(`${result.ok ? "✔" : "✖"} ${result.name}${result.ok ? "" : `\n    ${result.error}`}`);
  if (!result.ok) failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} passed（${browserStatus.ran ? "含浏览器测试" : "仅静态检查"}）`);
if (!browserStatus.ran) {
  console.log("\n⚠ 浏览器测试没有运行" + (browserStatus.note ? `：${browserStatus.note}` : ""));
  console.log("  表格样式、390 / 820 / 1440 宽度下的横向溢出、脚本注入只在真实浏览器里检查，上面的通过不覆盖这些。");
  console.log("  运行：node tests/run-tests.mjs --browser <playwright 模块路径>，或 npm run test:browser（找不到浏览器时失败）");
}
process.exit(failed ? 1 : 0);
