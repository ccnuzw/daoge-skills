// Evidence-state rules: AC009 (vocabulary), AC010 (contradiction), ST007 (status vs evidence), ST004 hints.

import fs from "node:fs";
import path from "node:path";

const REGISTER = "03-功能规格/V1/01-账户/01-用户注册.md";
const LOGIN = "03-功能规格/V1/01-账户/02-用户登录.md";
const STATUS = "02-产品与版本/当前版本/V1-实现状态.md";

export function register({ FIXTURES, test, assert, docsWith, check }) {
  const fixture = rel => fs.readFileSync(path.join(FIXTURES, "minimal", "docs", ...rel.split("/")), "utf8");
  const edit = (rel, ...pairs) => pairs.reduce((text, [from, to]) => {
    assert(text.includes(from), `fixture ${rel} no longer contains: ${from}`);
    return text.replace(from, to);
  }, fixture(rel));
  const messages = (findings, code, file) => findings.filter(f => f.code === code && (!file || f.file === file)).map(f => f.message);

  test("AC009 flags evidence words outside the vocabulary and says how to fix them", () => {
    const dir = docsWith({
      [REGISTER]: edit(REGISTER,
        ["`npm test -- register` | 本地通过 |", "`npm test -- register` | 已通过 |"],
        ["rollback` | 本地通过 |", "rollback` | 后端通过 |"])
    });
    const found = messages(check(dir).findings, "AC009", REGISTER);
    assert(found.length === 2, `AC009 x${found.length}: ${found.join(" | ")}`);
    assert(found.some(m => m.includes("AC01") && m.includes("应写作“本地通过”")), "alias must map to the canonical word");
    assert(found.some(m => m.includes("AC02") && m.includes("拆成两条 AC")), "one-sided evidence must not be mapped to a level");
  });

  test("AC009 reports a missing 证据状态 column once", () => {
    const table = "| AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 |\n| --- | --- | --- | --- | --- |\n| AC01 | 正常登录 | 集成 | `tests/login.test.ts` | `npm test -- login` |\n";
    const dir = docsWith({ [LOGIN]: fixture(LOGIN).replace(/\| AC \|[\s\S]*$/, table) });
    const found = messages(check(dir).findings, "AC009", LOGIN);
    assert(found.length === 1 && found[0].includes("缺少“证据状态”列"), `got: ${found.join(" | ")}`);
  });

  test("AC010 flags evidence that outruns its asset or command, but not an honest 未创建", () => {
    const row = ["`tests/login.test.ts` | `npm test -- login` | 未创建 |", "规划中 | `待定：命令未定` | 本地通过 |"];
    const lying = messages(check(docsWith({ [LOGIN]: edit(LOGIN, row) })).findings, "AC010", LOGIN);
    assert(lying.length === 2, `AC010 x${lying.length}: ${lying.join(" | ")}`);
    assert(lying.some(m => m.includes("目标资产")) && lying.some(m => m.includes("目标命令")), "asset and command both reported");
    const honest = edit(LOGIN, ["`tests/login.test.ts` |", "规划中 |"]);
    assert(!messages(check(docsWith({ [LOGIN]: honest })).findings, "AC010").length, "未创建 with a planned asset is consistent");
  });

  test("an extra 备注 column on the AC test table is read by name and triggers nothing", () => {
    const dir = docsWith({
      [REGISTER]: edit(REGISTER,
        ["| 证据状态 |\n| --- | --- | --- | --- | --- | --- |", "| 证据状态 | 备注 |\n| --- | --- | --- | --- | --- | --- | --- |"],
        ["`npm test -- register` | 本地通过 |", "`npm test -- register` | 本地通过 | 历史：旧编号 T-3 |"],
        ["rollback` | 本地通过 |", "rollback` | 本地通过 | - |"])
    });
    const { findings } = check(dir);
    assert(!findings.length, `unexpected findings: ${findings.map(f => `${f.code} ${f.message}`).join(" | ")}`);
  });

  test("ST007 flags a passing implementation status whose AC evidence is below 本地通过", () => {
    const dir = docsWith({ [REGISTER]: edit(REGISTER, ["rollback` | 本地通过 |", "rollback` | 未创建 |"]) });
    const { findings } = check(dir);
    const found = messages(findings, "ST007", STATUS);
    assert(found.length === 1 && found[0].includes("V1-FR-001") && found[0].includes("AC02（未创建）"), `got: ${found.join(" | ")}`);
    assert(!messages(findings, "AC010").length, "an honest 未创建 must not trigger AC010");
  });

  test("ST004 rewrites only exact aliases; prose gets the evidence ceiling, never a guess", () => {
    const dir = docsWith({
      [STATUS]: edit(STATUS,
        ["| V1-FR-002 | 用户登录 | 开发中 |", "| V1-FR-002 | 用户登录 | 🟢 核心实现完成，待正式验收 |"],
        ["| V1-FR-001 | 用户注册 | 本地验证 |", "| V1-FR-001 | 用户注册 | 设计中 |"])
    });
    const found = messages(check(dir).findings, "ST004", STATUS);
    assert(found.length === 2, `ST004 x${found.length}: ${found.join(" | ")}`);
    const prose = found.find(m => m.includes("核心实现完成"));
    assert(prose.includes("无法自动映射") && prose.includes("最多支持“开发中”") && !prose.includes("建议改为"), `prose hint: ${prose}`);
    assert(found.find(m => m.includes("设计中")).includes("应写作“规划中”"), "exact alias gets a rewrite");
  });
}
