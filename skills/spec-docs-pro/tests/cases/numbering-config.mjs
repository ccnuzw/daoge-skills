// Reserved numbers (REF001/REF003), config validation (CFG*), card completeness (FC001),
// the "small" profile and the ID003 rename suggestion.

import fs from "node:fs";
import path from "node:path";

const REGISTER = "03-功能规格/V1/01-账户/01-用户注册.md";
const LOGIN = "03-功能规格/V1/01-账户/02-用户登录.md";
const NUMBERING = "03-功能规格/V1/V1-需求编号.md";

const NUMBERS = `# V1 需求编号

## 保留编号

| 编号 | 用途 | 依据 |
| --- | --- | --- |
| V1-FR-011～013 | 预留给支付 | D001 |
| D090 | 预留 | - |

## 已废弃编号

| 编号 | 原功能 | 废弃日期 | 依据 |
| --- | --- | --- | --- |
| V1-FR-002 | 用户登录 | 2026-10-29 | 误登记 |
`;

const NOTES = `# 说明

预留：V1-FR-012、D090。
笔误：V1-FR-099、D091。
`;

export function register({ FIXTURES, test, assert, docsWith, check, runNode }) {
  const fixture = rel => fs.readFileSync(path.join(FIXTURES, "minimal", "docs", ...rel.split("/")), "utf8");
  const of = (findings, code) => findings.filter(f => f.code === code);

  test("REF001/REF002 skip registered reserved numbers but still catch typos; REF003 flags a live feature in the table", () => {
    const { findings } = check(docsWith({ [NUMBERING]: NUMBERS, "01-项目概览/说明.md": NOTES }));
    const refs = findings.filter(f => f.file === "01-项目概览/说明.md");
    assert(of(refs, "REF001").length === 1 && refs.find(f => f.code === "REF001").message.includes("V1-FR-099"), `REF001: ${JSON.stringify(of(refs, "REF001"))}`);
    assert(of(refs, "REF002").length === 1 && refs.find(f => f.code === "REF002").message.includes("D091"), `REF002: ${JSON.stringify(of(refs, "REF002"))}`);
    const live = of(findings, "REF003");
    assert(live.length === 1 && live[0].message.includes("V1-FR-002"), `REF003: ${JSON.stringify(live)}`);
  });

  test("config validation reports unknown rule codes, dead track mappings and unknown keys", () => {
    const config = {
      check: { ignore: ["BR002", "ac001", "XX999"] },
      featureTracks: { "V1-FR-001": "完全无关的名字", "V1-FR-999": "账户与权限" },
      docGoals: { "不存在.md": "x" },
      profile: "tiny",
      colour: "red"
    };
    const { findings } = check(docsWith({ "spec-docs.config.json": JSON.stringify(config) }));
    const text = code => of(findings, code).map(f => f.message).join(" | ");
    assert(of(findings, "CFG001").length === 2 && text("CFG001").includes("是否应写 AC001") && text("CFG001").includes("XX999"), `CFG001: ${text("CFG001")}`);
    assert(of(findings, "CFG002").length === 2 && text("CFG002").includes("V1-FR-999") && text("CFG002").includes("完全无关的名字"), `CFG002: ${text("CFG002")}`);
    assert(of(findings, "CFG003").length === 3, `CFG003 x${of(findings, "CFG003").length}: ${text("CFG003")}`);
    assert(of(findings, "CFG001").every(f => f.file === "spec-docs.config.json"), "config findings point at the config file");
  });

  test("check-docs and generate-browser fail when --config points to a missing file", () => {
    const dir = docsWith();
    for (const script of ["check-docs.mjs", "generate-browser.mjs"]) {
      const run = runNode(script, ["--docs", "docs", "--config", "nope.json"], dir);
      assert(run.status === 2 && run.stderr.includes("配置文件不存在"), `${script}: exit ${run.status}, stderr ${run.stderr.trim()}`);
    }
  });

  test("FC001 flags a card with missing fields; profile small waits for Ready, medium does not", () => {
    const noCard = fixture(LOGIN).replace(/## 功能卡[\s\S]*?\n## 目标/, "## 目标");
    const noDeps = fixture(REGISTER).replace("| 上游依赖 | 无 |\n", "");
    const files = { [LOGIN]: noCard, [REGISTER]: noDeps };
    const medium = check(docsWith(files));
    assert(of(medium.findings, "FC001").length === 2, `medium FC001 x${of(medium.findings, "FC001").length}`);
    const small = check(docsWith({ ...files, "spec-docs.config.json": JSON.stringify({ profile: "small" }) }));
    const left = of(small.findings, "FC001");
    assert(left.length === 1 && left[0].file === REGISTER && left[0].message.includes("上游依赖"), `small FC001: ${JSON.stringify(left)}`);
    assert(small.summary.profile === "small" && small.summary.exempted.FC001 === 1, `summary: ${JSON.stringify(small.summary)}`);
  });

  test("profile small keeps the hard rules: a Ready feature is never exempt, a Draft one only from completeness rules", () => {
    const noTable = fixture(REGISTER).replace(/#### AC 逐项测试设计[\s\S]*?\n\n详细设计/, "详细设计");
    const small = { "spec-docs.config.json": JSON.stringify({ profile: "small" }) };
    assert(of(check(docsWith({ [REGISTER]: noTable, ...small })).findings, "AC004").length === 1, "Ready feature still gets AC004 under small");
    const draftNoTable = fixture(LOGIN).replace(/#### AC 逐项测试设计[\s\S]*$/, "");
    assert(of(check(docsWith({ [LOGIN]: draftNoTable })).findings, "AC004").length === 1, "medium reports Draft AC004");
    const exempt = check(docsWith({ [LOGIN]: draftNoTable, ...small }));
    assert(!of(exempt.findings, "AC004").length && exempt.summary.exempted.AC004 === 1, `small exempts Draft only: ${JSON.stringify(exempt.summary.exempted)}`);
  });

  test("ID003 names the target file and lists the files that link to the old name", () => {
    const old = "03-功能规格/V1/01-账户/05-用户登录.md";
    const dir = docsWith({
      [LOGIN]: null,
      [old]: fixture(LOGIN),
      "01-项目概览/入口.md": "# 入口\n\n[登录](../03-功能规格/V1/01-账户/05-用户登录.md)\n"
    });
    const hit = of(check(dir).findings, "ID003");
    assert(hit.length === 1, `ID003 x${hit.length}`);
    assert(hit[0].message.includes("应改为 02-用户登录.md") && hit[0].message.includes("引用它的文件有 1 个") && hit[0].message.includes("入口.md"), hit[0].message);
    assert(hit[0].suggestion.renames[0].to === "03-功能规格/V1/01-账户/02-用户登录.md", "machine-readable suggestion");
  });
}
