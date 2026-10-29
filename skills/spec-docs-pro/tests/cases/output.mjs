// generate-browser output: deterministic, no local paths, --check, --stamp, size hint.
// Also keeps references/check-rules.md and the rule registry in step.

import fs from "node:fs";
import path from "node:path";
import { RULE_CODES } from "../../scripts/lib/rules.mjs";

const OUT = ["docs", "90-参考资料"];

export function register({ ROOT, test, assert, docsWith, runNode }) {
  const generate = (dir, ...args) => runNode("generate-browser.mjs", ["--docs", "docs", ...args], dir);
  const outputs = dir => ["产品文档浏览器.html", "产品文档浏览器-文档数据.js"].map(name => fs.readFileSync(path.join(dir, ...OUT, name), "utf8"));

  test("generated files are byte-identical across runs and carry no timestamp or local path", () => {
    const dir = docsWith();
    assert(generate(dir).status === 0, "first run");
    const first = outputs(dir);
    const start = Date.now();
    while (Date.now() - start < 1100) { /* let the clock move past one second */ }
    assert(generate(dir).status === 0, "second run");
    const second = outputs(dir);
    assert(first[0] === second[0] && first[1] === second[1], "output differs between runs");
    const joined = first.join("\n");
    assert(!first[1].includes("generatedAt"), "timestamp written to the data file without --stamp");
    assert(!joined.includes(dir) && !joined.includes("/Users/"), "local path leaked into output");
  });

  test("--check exits 1 when the output is missing or stale and 0 when it is current", () => {
    const dir = docsWith();
    assert(generate(dir, "--check").status === 1, "missing output must count as stale");
    generate(dir);
    assert(generate(dir, "--check").status === 0, "fresh output must pass");
    fs.appendFileSync(path.join(dir, "docs", "01-项目概览", "README.md"), "\n新增一行\n");
    const stale = generate(dir, "--check");
    assert(stale.status === 1 && stale.stderr.includes("已过期"), `stale: exit ${stale.status} ${stale.stderr}`);
    assert(outputs(dir)[1].includes("新增一行") === false, "--check must not write files");
  });

  test("--stamp adds the timestamp and --check ignores it", () => {
    const dir = docsWith();
    generate(dir, "--stamp");
    assert(outputs(dir)[1].includes("generatedAt"), "--stamp must write generatedAt");
    assert(generate(dir, "--check").status === 0, "stamped output must still count as current");
  });

  test("a data file above browser.dataWarnKB gets a size hint that does not fail --strict", () => {
    const dir = docsWith({ "spec-docs.config.json": JSON.stringify({ browser: { dataWarnKB: 1 } }) });
    const run = generate(dir, "--json", "--strict");
    const summary = JSON.parse(run.stdout);
    assert(summary.sizeWarning && summary.sizeWarning.includes("browser.dataWarnKB"), `sizeWarning: ${summary.sizeWarning}`);
    assert(run.status === 0, `size hint must not affect --strict, exit ${run.status}`);
  });

  test("references/check-rules.md lists exactly the rule codes check-docs can emit", () => {
    const doc = fs.readFileSync(path.join(ROOT, "references", "check-rules.md"), "utf8");
    const documented = new Set([...doc.matchAll(/^\|\s*([A-Z]{2,4}\d{3})\s*\|/gm)].map(match => match[1]));
    const missing = RULE_CODES.filter(code => !documented.has(code));
    const unknown = [...documented].filter(code => !RULE_CODES.includes(code));
    assert(!missing.length && !unknown.length, `undocumented: ${missing.join(",") || "-"}; unknown to code: ${unknown.join(",") || "-"}`);
    const emitted = new Set();
    for (const file of ["check-docs.mjs", path.join("lib", "evidence.mjs"), path.join("lib", "config-check.mjs")]) {
      for (const match of fs.readFileSync(path.join(ROOT, "scripts", file), "utf8").matchAll(/"([A-Z]{2,4}\d{3})"/g)) emitted.add(match[1]);
    }
    const unregistered = [...emitted].filter(code => !RULE_CODES.includes(code));
    assert(!unregistered.length, `emitted but not in rules.mjs: ${unregistered.join(",")}`);
  });
}
