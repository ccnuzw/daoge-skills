#!/usr/bin/env node
/** Validate the Skill's version and capability release contract. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const rootOption = argv.indexOf("--skill-root");
const skillRoot = resolve(rootOption >= 0 && argv[rootOption + 1] ? argv[rootOption + 1] : resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const manifestPath = join(skillRoot, "release-manifest.json");
const issues = [];

function read(path, label) {
  if (!existsSync(path)) {
    issues.push({ code: "FILE_MISSING", file: label, message: `缺少文件：${label}` });
    return "";
  }
  return readFileSync(path, "utf8");
}

let manifest = null;
try {
  manifest = JSON.parse(read(manifestPath, "release-manifest.json"));
} catch (error) {
  issues.push({ code: "MANIFEST_INVALID", file: "release-manifest.json", message: `release manifest 无效：${error.message}` });
}

const skill = read(join(skillRoot, "SKILL.md"), "SKILL.md");
const readme = read(join(skillRoot, "README.md"), "README.md");
const changelog = read(join(skillRoot, "CHANGELOG.md"), "CHANGELOG.md");
const declared = manifest?.declared_version || "";
const skillVersion = skill.match(/^\s*version:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1] || "";
const readmeVersion = readme.match(/版本：`([^`]+)`/)?.[1] || "";
const changelogVersion = changelog.match(/^##\s+\[?([^\]\s]+)\]?/m)?.[1] || "";

if (!manifest || manifest.$schema !== "spec-docs/release/v1") {
  issues.push({ code: "MANIFEST_SCHEMA", file: "release-manifest.json", message: "release manifest 的 $schema 必须是 spec-docs/release/v1" });
}
if (!declared) issues.push({ code: "VERSION_MISSING", file: "release-manifest.json", message: "缺少 declared_version" });
for (const [label, value] of [["SKILL.md", skillVersion], ["README.md", readmeVersion], ["CHANGELOG.md", changelogVersion]]) {
  if (value !== declared) issues.push({ code: "VERSION_DRIFT", file: label, message: `${label} 声明 ${value || "<空>"}，应为 ${declared || "<空>"}` });
}

const tracks = Array.isArray(manifest?.tracks) ? manifest.tracks : [];
const trackVersions = new Set();
for (const track of tracks) {
  if (!track || typeof track !== "object" || !/^\d+\.\d+\.\d+$/.test(track.version || "")) {
    issues.push({ code: "TRACK_INVALID", file: "release-manifest.json", message: "能力线必须包含合法 SemVer version" });
    continue;
  }
  if (trackVersions.has(track.version)) issues.push({ code: "TRACK_DUPLICATE", file: "release-manifest.json", message: `能力线重复：${track.version}` });
  trackVersions.add(track.version);
  if (!["declared", "implemented_in_worktree", "released", "deprecated"].includes(track.status)) {
    issues.push({ code: "TRACK_STATUS_INVALID", file: "release-manifest.json", message: `能力线状态无效：${track.version}` });
  }
  if (!Array.isArray(track.capabilities) || track.capabilities.length === 0) {
    issues.push({ code: "TRACK_CAPABILITIES_MISSING", file: "release-manifest.json", message: `能力线缺少 capabilities：${track.version}` });
  }
}
if (!trackVersions.has(declared)) issues.push({ code: "DECLARED_TRACK_MISSING", file: "release-manifest.json", message: `没有为当前声明版本登记能力线：${declared}` });

const result = {
  schema: "spec-docs/release-status/v1",
  read_only: true,
  declared_version: declared || null,
  source_versions: { skill: skillVersion || null, readme: readmeVersion || null, changelog: changelogVersion || null },
  tracks,
  issues,
  ok: issues.length === 0,
};
if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
else {
  console.log(`[release-status] ${result.ok ? "OK" : "FAILED"}: ${declared || "unknown"}`);
  for (const issue of issues) console.log(`[${issue.code}] ${issue.file}: ${issue.message}`);
}
process.exit(result.ok ? 0 : 1);
