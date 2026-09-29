#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "spec-docs-slice-check-"));
const skill = join(fileURLToPath(import.meta.url), "..", "..");
try {
  const init = spawnSync(process.execPath, [join(skill, "scripts/init-docs.mjs"), "--target", root, "--version", "V1", "--tier", "s"], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(init.stderr);
  const path = join(root, "docs", "07-变更切片", "V1", "V1-CS-001-变更.md");
  const dir = path.slice(0, path.lastIndexOf("/"));
  spawnSync("mkdir", ["-p", dir]);
  writeFileSync(path, `# V1-CS-001 变更\n\n## 元数据\n| 字段 | 值 |\n| --- | --- |\n| 主功能 | V1-FR-001 |\n\n## 基线与目标\n基线和目标说明超过最小长度。\n\n## 影响清单\n| 类型 | 资产 | 变化 | 负责人 | 状态 |\n| --- | --- | --- | --- | --- |\n| 接口 | update | 修改 | A | 未开始 |\n\n## 验收与证据\n| AC | 断言 | 测试层级 | 命令 | 证据路径 | 状态 |\n| --- | --- | --- | --- | --- | --- |\n| AC01 | 断言 | 集成 | npm test | test/x | 未验证 |\n\n## 回写清单\n- [ ] 功能主文档\n`);
  let result = spawnSync(process.execPath, [join(root, "scripts/check-docs.mjs"), "--repo", root, "--quiet"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`valid slice rejected: ${result.stderr}`);
  const original = readFileSync(path, "utf8");
  writeFileSync(path, original.replace("| 主功能 | V1-FR-001 |", "| 主功能 | <功能> |"));
  result = spawnSync(process.execPath, [join(root, "scripts/check-docs.mjs"), "--repo", root, "--quiet"], { encoding: "utf8" });
  if (result.status === 0) throw new Error("missing feature reference was not rejected");
  writeFileSync(path, original);
  console.log("selftest-change-slice-check: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
