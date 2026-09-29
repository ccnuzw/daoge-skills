#!/usr/bin/env node
/** Regression tests for the user-facing workflow router, profiles, and task packs. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const skillRoot = resolve(HERE, "..");
const fixture = join(tmpdir(), `spec-docs-workflow-selftest-${Date.now()}`);
const failures = [];
function assert(name, condition, detail = "") {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : `: ${detail}`}`);
  if (!condition) failures.push(name);
}
function run(args) {
  return spawnSync(process.execPath, args, { cwd: fixture, encoding: "utf8" });
}

mkdirSync(fixture, { recursive: true });
const router = join(skillRoot, "scripts/spec-docs.mjs");
const help = spawnSync(process.execPath, [router, "--help"], { cwd: fixture, encoding: "utf8" });
assert("workflow router exposes task-oriented commands", help.status === 0 && help.stdout.includes("task") && help.stdout.includes("profile"));
const statusBefore = spawnSync(process.execPath, [router, "status", "--dir", fixture, "--json"], { cwd: fixture, encoding: "utf8" });
assert("status reports an uninitialized project", statusBefore.status === 0 && JSON.parse(statusBefore.stdout).initialized === false);

const init = run([join(skillRoot, "scripts/init-docs.mjs"), "--target", fixture, "--profile", "lite"]);
assert("lite profile maps to S tier", init.status === 0 && JSON.parse(readFileSync(join(fixture, "docs-policy.json"), "utf8")).profile === "lite" && JSON.parse(readFileSync(join(fixture, "docs-policy.json"), "utf8")).tier === "s");
assert("initializer copies workflow and task-pack scripts", existsSync(join(fixture, "scripts/spec-docs.mjs")) && existsSync(join(fixture, "scripts/task-pack.mjs")) && existsSync(join(fixture, "scripts/golden-sample.mjs")));
for (const [profile, tier] of [["standard", "m"], ["regulated", "l"]]) {
  const profileRoot = join(fixture, profile);
  const result = spawnSync(process.execPath, [join(skillRoot, "scripts/init-docs.mjs"), "--target", profileRoot, "--profile", profile], { encoding: "utf8" });
  const policy = result.status === 0 ? JSON.parse(readFileSync(join(profileRoot, "docs-policy.json"), "utf8")) : null;
  assert(`${profile} profile maps to ${tier.toUpperCase()} tier`, result.status === 0 && policy?.profile === profile && policy?.tier === tier);
}
const statusAfter = spawnSync(process.execPath, [join(fixture, "scripts/spec-docs.mjs"), "status", "--dir", fixture, "--json"], { cwd: fixture, encoding: "utf8" });
assert("status reports profile and active version", statusAfter.status === 0 && JSON.parse(statusAfter.stdout).profile === "lite" && JSON.parse(statusAfter.stdout).active_version === "V1");

const task = run([join(fixture, "scripts/spec-docs.mjs"), "task", "--feature", "V1-FR-001", "--phase", "planning"]);
let taskReport = null;
try { taskReport = JSON.parse(task.stdout); } catch {}
assert("router generates a machine-readable task pack", task.status === 0 && taskReport?.schema === "spec-docs/task-pack/v1");
assert("task pack is read-only and actionable", taskReport?.read_only === true && taskReport?.commands?.some((command) => command.includes("review-docs")) && taskReport?.writeback?.length > 0);
const releaseTask = run([join(fixture, "scripts/spec-docs.mjs"), "task", "--feature", "V1-FR-001", "--phase", "release"]);
let releaseTaskReport = null;
try { releaseTaskReport = JSON.parse(releaseTask.stdout); } catch {}
assert("release task maps to review-docs release_candidate", releaseTask.status === 0 && releaseTaskReport?.commands?.some((command) => command.includes("--phase release_candidate")) && releaseTaskReport?.commands?.some((command) => command.includes("docs-gate.mjs --release")));

const sync = run([join(fixture, "scripts/spec-docs.mjs"), "facts-sync", "--dir", fixture, "--json"]);
let syncReport = null;
try { syncReport = JSON.parse(sync.stdout); } catch {}
assert("router exposes read-only facts synchronization", sync.status === 0 && syncReport?.schema === "spec-docs/facts-sync/v1" && syncReport?.read_only === true);
const contracts = run([join(fixture, "scripts/spec-docs.mjs"), "contracts", "--dir", fixture, "--json"]);
let contractsReport = null;
try { contractsReport = JSON.parse(contracts.stdout); } catch {}
assert("router exposes contract index", contracts.status === 0 && contractsReport?.schema === "spec-docs/contract-index/v1");

const badPhase = run([join(fixture, "scripts/spec-docs.mjs"), "task", "--feature", "V1-FR-001", "--phase", "unknown"]);
assert("task pack rejects invalid phases", badPhase.status === 2);

rmSync(fixture, { recursive: true, force: true });
console.log(`\n[selftest] ${failures.length ? `${failures.length} failures` : "all passed"}`);
if (failures.length) process.exit(1);
