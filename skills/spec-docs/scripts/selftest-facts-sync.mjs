#!/usr/bin/env node
/** Regression tests for Markdown-to-facts synchronization. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(HERE, "..");
const fixture = join(tmpdir(), `spec-docs-facts-sync-${Date.now()}`);
const failures = [];
function assert(name, condition, detail = "") {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : `: ${detail}`}`);
  if (!condition) failures.push(name);
}
function run(args) { return spawnSync(process.execPath, args, { cwd: fixture, encoding: "utf8" }); }

mkdirSync(fixture, { recursive: true });
const init = spawnSync(process.execPath, [join(skillRoot, "scripts/init-docs.mjs"), "--target", fixture, "--profile", "standard"], { encoding: "utf8" });
assert("initialize sync fixture", init.status === 0);
if (init.status === 0) {
  const check = run([join(fixture, "scripts/facts-sync.mjs"), "--dir", fixture, "--json"]);
  const report = JSON.parse(check.stdout);
  assert("default sync is read-only", check.status === 0 && report.read_only === true && report.written === false);
  assert("sync detects derived fact drift", report.findings.some((finding) => ["FEATURE_MISSING", "FACT_DRIFT", "IMPLEMENTATION_STATUS_MISSING"].includes(finding.code)));
  const before = readFileSync(join(fixture, "docs-facts.json"), "utf8");
  const write = run([join(fixture, "scripts/facts-sync.mjs"), "--dir", fixture, "--write", "--json"]);
  const registry = JSON.parse(readFileSync(join(fixture, "docs-facts.json"), "utf8"));
  assert("explicit write updates only through --write", write.status === 0 && JSON.stringify(registry) !== before && Array.isArray(registry.relations));
  const strict = run([join(fixture, "scripts/facts-sync.mjs"), "--dir", fixture, "--strict", "--json"]);
  assert("strict sync blocks remaining drift", strict.status === 1 || JSON.parse(strict.stdout).findings.length === 0);
}
rmSync(fixture, { recursive: true, force: true });
console.log(`\n[selftest] ${failures.length ? `${failures.length} failures` : "all passed"}`);
if (failures.length) process.exit(1);
