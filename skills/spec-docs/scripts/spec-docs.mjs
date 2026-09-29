#!/usr/bin/env node
/** User-facing workflow router for spec-docs. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const command = argv[0] || "help";
const args = argv.slice(1);

const commands = {
  init: ["init-docs.mjs"],
  status: null,
  task: ["task-pack.mjs"],
  context: ["context-pack.mjs"],
  review: ["review-docs.mjs"],
  gate: ["docs-gate.mjs"],
  change: ["change-impact.mjs"],
  audit: ["compatibility-audit.mjs"],
  "facts-sync": ["facts-sync.mjs"],
  contracts: ["contract-index.mjs"],
  "golden-sample": ["golden-sample.mjs"],
  trace: ["traceability-report.mjs"],
  freshness: ["evidence-freshness.mjs"],
  diff: ["spec-diff.mjs"],
};

function help() {
  console.log(`spec-docs：面向任务的文档驱动开发入口

用法：
  node scripts/spec-docs.mjs init --profile lite|standard|regulated --target <项目根>
  node scripts/spec-docs.mjs status --dir <项目根>
  node scripts/spec-docs.mjs task --feature V1-FR-001 --phase planning
  node scripts/spec-docs.mjs context --feature V1-FR-001
  node scripts/spec-docs.mjs review --phase planning --feature V1-FR-001
  node scripts/spec-docs.mjs gate --phase planning|development|release
  node scripts/spec-docs.mjs change --feature V1-FR-001
  node scripts/spec-docs.mjs audit --repo <项目根>
  node scripts/spec-docs.mjs facts-sync --dir <项目根> --check|--write
  node scripts/spec-docs.mjs contracts --dir <项目根> --json
  node scripts/spec-docs.mjs golden-sample --sample <真实文档库> --json
  node scripts/spec-docs.mjs trace|freshness|diff ...

profile 映射：lite → S，standard → M，regulated → L。旧的底层脚本仍可直接调用。`);
}

function showStatus() {
  const dirIndex = args.indexOf("--dir");
  const target = resolve(dirIndex >= 0 && args[dirIndex + 1] ? args[dirIndex + 1] : process.cwd());
  const readJson = (name) => {
    const path = join(target, name);
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return { invalid: true }; }
  };
  const policy = readJson("docs-policy.json");
  const facts = readJson("docs-facts.json");
  const gate = readJson("docs-gate.json");
  const result = {
    schema: "spec-docs/workflow-status/v1",
    read_only: true,
    target,
    initialized: Boolean(policy),
    profile: policy?.profile || null,
    tier: policy?.tier || null,
    active_version: policy?.activeVersion || facts?.version || null,
    facts: { configured: Boolean(policy?.facts), enabled: policy?.facts?.enabled === true, present: Boolean(facts), valid: facts?.invalid !== true },
    gate: { configured: Boolean(gate), present: existsSync(join(target, "scripts", "docs-gate.mjs")) },
    next: [],
  };
  if (!result.initialized) result.next.push("node scripts/spec-docs.mjs init --profile standard --target <project>");
  else if (!result.facts.enabled) result.next.push("登记 docs-facts.json 后，在 docs-policy.json 启用 facts.strict 检查");
  else result.next.push("node scripts/spec-docs.mjs task --feature <feature-id> --phase planning");
  if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`[spec-docs] ${result.initialized ? "initialized" : "not initialized"}: ${target}`);
    console.log(`profile=${result.profile || "<none>"} tier=${result.tier || "<none>"} activeVersion=${result.active_version || "<none>"}`);
    console.log(`facts=${result.facts.enabled ? "enabled" : "disabled"} gate=${result.gate.configured ? "configured" : "not configured"}`);
    console.log("next:");
    for (const next of result.next) console.log(`- ${next}`);
  }
  process.exit(0);
}

if (command === "help" || command === "--help" || command === "-h") {
  help();
  process.exit(0);
}
if (command === "status") showStatus();
if (!commands[command]) {
  console.error(`[spec-docs] 未知命令：${command}`);
  help();
  process.exit(2);
}

const script = join(HERE, commands[command][0]);
const result = spawnSync(process.execPath, [script, ...args], { stdio: "inherit", cwd: process.cwd() });
if (result.error) {
  console.error(`[spec-docs] 无法执行 ${command}：${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 1);
