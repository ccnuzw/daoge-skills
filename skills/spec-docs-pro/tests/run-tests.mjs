#!/usr/bin/env node
// Self-test for the bundled scripts. Uses only Node built-ins; writes to a temp directory.
// Usage: node tests/run-tests.mjs [--browser /path/to/playwright]
// With --browser (or SPEC_DOCS_PLAYWRIGHT), also renders every view in headless Chromium.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

function copyFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `spec-docs-${name}-`));
  fs.cpSync(path.join(FIXTURES, name), dir, { recursive: true });
  return dir;
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

const playwrightPath = (() => {
  const index = process.argv.indexOf("--browser");
  return index > 0 ? process.argv[index + 1] : process.env.SPEC_DOCS_PLAYWRIGHT;
})();

async function browserTests() {
  if (!playwrightPath) return;
  const { chromium } = createRequire(import.meta.url)(playwrightPath);
  const browser = await chromium.launch();
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
  } finally {
    await browser.close();
  }
}

await browserTests();

for (const dir of [minimal, broken]) fs.rmSync(dir, { recursive: true, force: true });
let failed = 0;
for (const result of results) {
  console.log(`${result.ok ? "✔" : "✖"} ${result.name}${result.ok ? "" : `\n    ${result.error}`}`);
  if (!result.ok) failed += 1;
}
console.log(`\n${results.length - failed}/${results.length} passed${playwrightPath ? "" : "（未运行浏览器测试：传入 --browser <playwright 模块路径> 启用）"}`);
process.exit(failed ? 1 : 0);
