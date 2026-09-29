#!/usr/bin/env node
/** Regression tests for release metadata and legacy-document compatibility audit. */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, "..");
const fixture = join(tmpdir(), `spec-docs-release-selftest-${Date.now()}`);
const failures = [];
function assert(name, condition, detail = "") {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${condition || !detail ? "" : `: ${detail}`}`);
  if (!condition) failures.push(name);
}

const release = spawnSync(process.execPath, [join(SKILL_ROOT, "scripts/release-status.mjs"), "--json"], { encoding: "utf8" });
let releaseReport = null;
try { releaseReport = JSON.parse(release.stdout); } catch {}
assert("current version declarations agree", release.status === 0 && releaseReport?.ok === true);
assert("capability tracks have explicit release states", releaseReport?.tracks?.length >= 3 && releaseReport.tracks.every((track) => track.release_status) && releaseReport.tracks.some((track) => track.version === releaseReport.declared_version && track.status === "released"));

const mismatchRoot = join(fixture, "version-mismatch");
mkdirSync(mismatchRoot, { recursive: true });
for (const name of ["release-manifest.json", "SKILL.md", "README.md", "CHANGELOG.md"]) {
  writeFileSync(join(mismatchRoot, name), readFileSync(join(SKILL_ROOT, name), "utf8"));
}
writeFileSync(join(mismatchRoot, "README.md"), readFileSync(join(mismatchRoot, "README.md"), "utf8").replace(/版本：`[^`]+`/, "版本：`9.9.9`"));
const mismatch = spawnSync(process.execPath, [join(SKILL_ROOT, "scripts/release-status.mjs"), "--skill-root", mismatchRoot, "--json"], { cwd: mismatchRoot, encoding: "utf8" });
assert("version drift is rejected", mismatch.status !== 0 && JSON.parse(mismatch.stdout).issues.some((issue) => issue.code === "VERSION_DRIFT"));

mkdirSync(fixture, { recursive: true });
const initialized = spawnSync(process.execPath, [join(SKILL_ROOT, "scripts/init-docs.mjs"), "--target", fixture, "--tier", "s"], { encoding: "utf8" });
assert("initializer copies compatibility audit", initialized.status === 0 && existsSync(join(fixture, "scripts/compatibility-audit.mjs")));

if (initialized.status === 0) {
  const feature = join(fixture, "docs/03-功能规格/V1/01-领域/01-功能主文档.md");
  let content = readFileSync(feature, "utf8");
  content = content.replace("domain: <领域名>\n", "domain: <领域名>\nstatus: 基础实现\n");
  writeFileSync(feature, content);

  const audit = spawnSync(process.execPath, [join(fixture, "scripts/compatibility-audit.mjs"), "--repo", fixture, "--json"], { encoding: "utf8" });
  const auditReport = JSON.parse(audit.stdout);
  assert("legacy status is reported without modifying files", audit.status === 0 && auditReport.findings.some((item) => item.code === "LEGACY_IMPLEMENTATION_STATUS_FRONTMATTER") && readFileSync(feature, "utf8").includes("status: 基础实现"));

  const strict = spawnSync(process.execPath, [join(fixture, "scripts/compatibility-audit.mjs"), "--repo", fixture, "--strict", "--json"], { encoding: "utf8" });
  assert("strict audit blocks unresolved legacy status", strict.status === 1);

  const docsRootLayout = join(fixture, "docs-root-layout");
  mkdirSync(join(docsRootLayout, "03-功能规格"), { recursive: true });
  writeFileSync(join(docsRootLayout, "03-功能规格", "01-feature.md"), content, "utf8");
  const directRoot = spawnSync(process.execPath, [join(fixture, "scripts/compatibility-audit.mjs"), "--repo", docsRootLayout, "--json"], { encoding: "utf8" });
  assert("audit accepts a directory that is itself the docs root", directRoot.status === 0 && JSON.parse(directRoot.stdout).summary.findings > 0);

  const refresh = spawnSync(process.execPath, [join(SKILL_ROOT, "scripts/init-docs.mjs"), "--target", fixture, "--refresh"], { encoding: "utf8" });
  assert("refresh updates compatibility audit copy", refresh.status === 0 && existsSync(join(fixture, "scripts/compatibility-audit.mjs")));
}

rmSync(fixture, { recursive: true, force: true });
console.log(`\n[selftest] ${failures.length ? `${failures.length} failures` : "all passed"}`);
if (failures.length) process.exit(1);
