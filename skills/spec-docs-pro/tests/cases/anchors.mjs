// Anchor checking (LNK002 / LNK004) and the single shared slug algorithm.

import fs from "node:fs";
import path from "node:path";
import { githubSlug, createSlugger, cleanInline, extractHeadings } from "../../scripts/lib/markdown.mjs";

const TARGET = `# 锚点目标

## mcp_connection_logs（MCP 连接事件）

## D007 局域网 HTTP 服务始终开启

## 概述

## 概述
`;

const LINKS = `# 链接

- [下划线保留](目标.md#mcp_connection_logsmcp-连接事件)
- [下划线丢失](目标.md#mcpconnectionlogsmcp-连接事件)
- [只写编号前缀](目标.md#d007)
- [完整锚点](目标.md#d007-局域网-http-服务始终开启)
- [重复标题第二个](目标.md#概述-1)
- [页内不存在](#没有这个标题)
`;

export function register({ ROOT, test, assert, docsWith, check }) {
  test("slug follows GitHub: keeps underscores, numbers repeated headings, no trimming after symbols", () => {
    const cases = [
      ["mcp_connection_logs（MCP 连接事件）", "mcp_connection_logsmcp-连接事件"],
      ["D007 局域网 HTTP 服务始终开启", "d007-局域网-http-服务始终开启"],
      ["`snake_case` 与 **粗体**", "snake_case-与-粗体"],
      ["[链接文字](a.md) 后", "链接文字-后"],
      ["🟢 状态", "-状态"],
      ["Learn C#", "learn-c"]
    ];
    for (const [input, expected] of cases) assert(githubSlug(input) === expected, `${input} => ${githubSlug(input)}, want ${expected}`);
    const slugger = createSlugger();
    const repeated = [slugger.slug("概述"), slugger.slug("概述"), slugger.slug("概述")].join(",");
    assert(repeated === "概述,概述-1,概述-2", `repeated headings: ${repeated}`);
    assert(extractHeadings("## C#\n## C# ##\n").map(h => h.slug).join(",") === "c,c-1", "closing # sequence must be stripped only after a space");
  });

  test("cleanInline keeps underscores inside identifiers and paths", () => {
    assert(cleanInline("`tests/auth_login_test.ts`") === "tests/auth_login_test.ts", "path in code span");
    assert(cleanInline("mcp_connection_logs") === "mcp_connection_logs", "snake_case");
    assert(cleanInline("**粗** _斜_") === "粗 斜", "emphasis markers removed");
  });

  test("check-docs accepts exact GitHub anchors and rejects prefixes and stripped underscores", () => {
    const dir = docsWith({ "01-项目概览/目标.md": TARGET, "01-项目概览/链接.md": LINKS });
    const { findings } = check(dir);
    const here = findings.filter(f => f.file === "01-项目概览/链接.md");
    const byCode = code => here.filter(f => f.code === code);
    assert(byCode("LNK002").length === 2, `LNK002 x${byCode("LNK002").length}: ${here.map(f => f.message).join(" | ")}`);
    assert(byCode("LNK002").some(f => f.message.includes("mcpconnectionlogs")), "stripped-underscore link must be reported");
    assert(byCode("LNK002").some(f => f.message.includes("没有这个标题")), "missing in-page anchor must be reported");
    assert(byCode("LNK004").length === 1 && byCode("LNK004")[0].message.includes("#d007-局域网-http-服务始终开启"), "prefix link must be reported with the full anchor");
    assert(!here.some(f => f.message.includes("-1") && f.code.startsWith("LNK")), "-1 suffixed duplicate heading must be accepted");
  });

  test("viewer inlines the same slug code as check-docs", () => {
    const source = fs.readFileSync(path.join(ROOT, "scripts", "lib", "markdown.mjs"), "utf8");
    const block = /\/\/ ---- shared:start[^\n]*\n([\s\S]*?)\/\/ ---- shared:end/.exec(source)[1].replace(/^export /gm, "");
    const inlined = new Function(`${block}\nreturn { githubSlug, createSlugger, stripInline };`)();
    for (const text of ["mcp_connection_logs（MCP 连接事件）", "D007 局域网 HTTP 服务始终开启", "`a_b` **c**", "🟢 状态"]) {
      assert(inlined.githubSlug(text) === githubSlug(text), `inlined slug differs for ${text}`);
    }
    for (const file of ["viewer.js", "viewer-markdown.js", "viewer-views.js"]) {
      const viewer = fs.readFileSync(path.join(ROOT, "assets", "browser", file), "utf8");
      assert(!/function slug\(/.test(viewer), `${file} still defines its own slug()`);
    }
  });
}
