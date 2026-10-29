// migrate-docs: dry run by default, verbatim AC text, idempotent, and a guard that refuses lossy conversions.

import fs from "node:fs";
import path from "node:path";
import { convertAcTables, verifyAcConversion } from "../../scripts/lib/migrate-ac.mjs";

const LEGACY = "03-功能规格/V1/01-账户/07-用户资料.md";
const STATUS = "02-产品与版本/当前版本/V1-实现状态.md";
const ENTRY = "01-项目概览/入口.md";

const PROFILE = `# V1-FR-003 用户资料

## 功能卡

| 项目 | 内容 |
| --- | --- |
| 编号 | V1-FR-003 |
| 规格状态 | Ready |
| 风险等级 | 标准 |
| 上游依赖 | 无 |
| 状态 | 设计中 |

## 目标

用户查看和修改自己的资料。

## 验收标准

| 编号 | 场景 | 前置 | 操作 | 预期 | 备注 |
| --- | --- | --- | --- | --- | --- |
| AC01 | 查看资料 | 已登录 | 打开资料页 | 显示昵称和邮箱 | - |
| AC02 | 修改昵称 | 已登录 | 提交新昵称 | 保存成功 | 历史需求 R-12 |

#### AC 逐项测试设计

| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 证据状态 |
| --- | --- | --- | --- | --- | --- |
| AC01 | 查看 | 集成 | \`tests/profile.test.ts\` | \`npm test -- profile\` | 已通过 |
| AC02 | 修改 | 集成 | \`tests/profile.test.ts\` | \`npm test -- profile -t edit\` | 后端通过 |
`;

export function register({ FIXTURES, test, assert, docsWith, check, runNode }) {
  const status = fs.readFileSync(path.join(FIXTURES, "minimal", "docs", ...STATUS.split("/")), "utf8");
  const legacyProject = () => docsWith({
    [LEGACY]: PROFILE,
    [STATUS]: `${status.trimEnd()}\n| V1-FR-003 | 用户资料 | 设计中 | 无 | 无 | 无 | 待实现 | 2026-10-28 |\n`,
    [ENTRY]: "# 入口\n\n[资料](../03-功能规格/V1/01-账户/07-用户资料.md#目标)\n"
  });
  const migrate = (dir, ...args) => runNode("migrate-docs.mjs", ["--docs", "docs", ...args], dir);
  const read = (dir, rel) => fs.readFileSync(path.join(dir, "docs", ...rel.split("/")), "utf8");

  test("migrate-docs is a dry run by default and writes nothing", () => {
    const dir = legacyProject();
    const before = read(dir, LEGACY);
    const run = migrate(dir);
    assert(run.status === 0 && run.stdout.includes("预演") && run.stdout.includes("#### AC01 查看资料"), `exit ${run.status}\n${run.stdout}${run.stderr}`);
    assert(read(dir, LEGACY) === before && fs.existsSync(path.join(dir, "docs", ...LEGACY.split("/"))), "dry run changed the tree");
  });

  test("migrate-docs --write upgrades the legacy feature, keeps AC text verbatim and rewrites links", () => {
    const dir = legacyProject();
    const run = migrate(dir, "--write");
    assert(run.status === 0, `exit ${run.status}\n${run.stdout}${run.stderr}`);
    const moved = "03-功能规格/V1/01-账户/03-用户资料.md";
    const text = read(dir, moved);
    assert(!fs.existsSync(path.join(dir, "docs", ...LEGACY.split("/"))), "old file name still present");
    assert(/^---\nfeature_id: V1-FR-003\nversion: V1\ndomain: 账户\nspec_status: Ready\n---/.test(text), "frontmatter not added");
    for (const original of ["已登录", "打开资料页", "显示昵称和邮箱", "提交新昵称", "保存成功", "历史需求 R-12"]) {
      assert(text.includes(original), `AC text lost: ${original}`);
    }
    assert(!text.includes("| 状态 | 设计中 |"), "card status row should be removed once the status table records it");
    assert(read(dir, STATUS).includes("| V1-FR-003 | 用户资料 | 规划中 |"), "status alias not normalised");
    assert(read(dir, ENTRY).includes("03-用户资料.md#目标"), "link not rewritten with its anchor kept");
    const after = check(dir).findings.filter(f => f.file === moved).map(f => f.code);
    assert(after.join(",") === "AC009", `remaining findings: ${after.join(",")}`);
  });

  test("migrate-docs does not guess: ambiguous words become manual notes and stay untouched", () => {
    const dir = legacyProject();
    const run = migrate(dir, "--write", "--json");
    const manual = JSON.parse(run.stdout).notes.filter(note => note.level === "manual");
    assert(manual.length === 1 && manual[0].text.includes("后端通过"), `manual notes: ${JSON.stringify(manual)}`);
    assert(read(dir, "03-功能规格/V1/01-账户/03-用户资料.md").includes("| 后端通过 |"), "ambiguous evidence word was rewritten");
  });

  test("a second migrate-docs run finds nothing left to change", () => {
    const dir = legacyProject();
    migrate(dir, "--write");
    const again = JSON.parse(migrate(dir, "--json").stdout);
    assert(!again.changed.length && !again.renames.length, `second run: ${JSON.stringify({ changed: again.changed.map(c => c.file), renames: again.renames })}`);
  });

  test("verifyAcConversion catches a lost AC and lost original text", () => {
    const result = convertAcTables(PROFILE, LEGACY);
    assert(!verifyAcConversion(result, result.text).length, "a correct conversion must verify");
    const lostText = result.text.replace("显示昵称和邮箱", "显示用户信息");
    assert(verifyAcConversion(result, lostText).some(problem => problem.includes("原文丢失")), "reworded cell must be caught");
    const lostAc = result.text.replace(/#### AC02[\s\S]*?(?=#### AC 逐项)/, "");
    assert(verifyAcConversion(result, lostAc).some(problem => problem.includes("不一致")), "dropped AC must be caught");
  });

  test("--only limits the steps and an unknown step is a usage error", () => {
    const dir = legacyProject();
    const only = JSON.parse(migrate(dir, "--only", "status", "--json").stdout);
    // The status step covers both status tables: implementation status and AC evidence status.
    assert(only.changed.map(c => c.file).sort().join(",") === [LEGACY, STATUS].sort().join(","), `only status: ${JSON.stringify(only.changed.map(c => c.file))}`);
    const featureDiff = only.changed.find(c => c.file === LEGACY).diff;
    assert(featureDiff.includes("+| AC01 | 查看 | 集成 | `tests/profile.test.ts` | `npm test -- profile` | 本地通过 |"), "evidence word not normalised");
    assert(!featureDiff.includes("feature_id") && !featureDiff.includes("#### AC01") && !only.renames.length, "other steps must not run");
    assert(migrate(dir, "--only", "nonsense").status === 2, "unknown step must exit 2");
  });
}
