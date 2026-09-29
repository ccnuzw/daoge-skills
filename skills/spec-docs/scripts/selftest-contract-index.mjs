#!/usr/bin/env node
/** Regression tests for the multi-type contract index. */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(HERE, "..");
const fixture = mkdtempSync(join(tmpdir(), "spec-docs-contract-index-"));
const failures = [];
function assert(name, condition, detail = "") {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : `: ${detail}`}`);
  if (!condition) failures.push(name);
}
const init = spawnSync(process.execPath, [join(skillRoot, "scripts/init-docs.mjs"), "--target", fixture, "--profile", "standard"], { encoding: "utf8" });
assert("initialize contract fixture", init.status === 0);
if (init.status === 0) {
  const policyPath = join(fixture, "docs-policy.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  policy.facts.enabled = true;
  policy.contracts = { sources: [{ type: "driver", path: "docs/04-技术架构/current-driver.json", operationPattern: "driver_key\\s*[:=]\\s*[\\\"']?([A-Za-z0-9._:-]+)" }] };
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  writeFileSync(join(fixture, "docs/04-技术架构/current-driver.json"), JSON.stringify({ driver_key: "openai.chat" }));
  const openapi = join(fixture, "docs/04-技术架构/当前版本/V1-openapi.yaml");
  writeFileSync(openapi, `openapi: 3.1.0\npaths:\n  /api/account:\n    post:\n      operationId: createAccount\n      x-tag-feature: V1-FR-001\n      responses:\n        '200':\n          description: ok\n`);
  const migrationDir = join(fixture, "server/migrations");
  mkdirSync(migrationDir, { recursive: true });
  writeFileSync(join(migrationDir, "0001_init.sql"), "create table accounts(id uuid);\n");
  const index = spawnSync(process.execPath, [join(fixture, "scripts/contract-index.mjs"), "--dir", fixture, "--json"], { encoding: "utf8" });
  let report = null;
  try { report = JSON.parse(index.stdout); } catch {}
  assert("indexes HTTP and configured driver contracts", index.status === 0 && report?.schema === "spec-docs/contract-index/v1" && report.contracts.some((entry) => entry.type === "http") && report.contracts.some((entry) => entry.type === "driver"), `${index.stderr}\n${index.stdout}`);
  assert("maps OpenAPI operation to feature", report?.coverage?.operations >= 1 && report.coverage.mapped_operations >= 1, `${index.stderr}\n${index.stdout}`);
  assert("indexes migration source", report?.contracts?.some((entry) => entry.type === "migration"));
  const output = join(fixture, ".tmp/contract-index.json");
  const written = spawnSync(process.execPath, [join(fixture, "scripts/contract-index.mjs"), "--dir", fixture, "--out", output], { encoding: "utf8" });
  assert("contract index output is explicit", written.status === 0 && JSON.parse(readFileSync(output, "utf8")).read_only === false);
}
rmSync(fixture, { recursive: true, force: true });
console.log(`\n[selftest] ${failures.length ? `${failures.length} failures` : "all passed"}`);
if (failures.length) process.exit(1);
