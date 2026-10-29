// Acceptance criteria written as a table -> "#### ACNN 标题" blocks with Given / When / Then.
// Cell text is copied as it is, never reworded; verifyAcConversion proves nothing was lost.

import { extractTables, parseFrontmatter, cleanInline } from "./markdown.mjs";
import { parseAcceptance } from "./docs-model.mjs";

const TEST_DESIGN = /测试层级|目标命令|目标资产|测试文件/;
const TITLE = /标题|名称|验收重点|场景|描述|说明|内容/;
const GIVEN = /^(Given|前置|假设|给定)/i;
const WHEN = /^(When|操作|触发|动作)/i;
const THEN = /^(Then|预期|结果|期望|断言)/i;
const EMPTY = /^([-—–]|)$/;
const SHORT_TITLE = 40;

// The same tables parseAcceptance() reads as table-form acceptance criteria.
const isAcTable = table =>
  table.h2 && /验收/.test(table.h2.text) && !table.header.some(cell => TEST_DESIGN.test(cell)) && /^(AC|编号)/i.test(table.header[0]);

function renderRow(header, row) {
  const find = pattern => header.findIndex((cell, index) => index > 0 && pattern.test(cleanInline(cell)));
  const [given, when, then] = [find(GIVEN), find(WHEN), find(THEN)];
  let title = find(TITLE);
  if (title < 0 && ![given, when, then].includes(1)) title = 1;
  if ([given, when, then].includes(title)) title = -1;
  const cell = index => (index >= 0 && row[index] && !EMPTY.test(row[index].trim()) ? row[index].trim() : "");
  const text = cell(title);
  const short = text && text.length <= SHORT_TITLE;
  const out = [`#### ${cleanInline(row[0])}${short ? ` ${text}` : ""}`, ""];
  if (text && !short) out.push(text, "");
  for (const [word, index] of [["Given", given], ["When", when], ["Then", then]]) {
    if (cell(index)) out.push(`${word} ${cell(index)}`, "");
  }
  header.forEach((name, index) => {
    if ([0, title, given, when, then].includes(index) || !cell(index)) return;
    out.push(`- ${cleanInline(name)}：${cell(index)}`);
  });
  return out.join("\n").replace(/\n+$/, "");
}

// `source` uses \n line endings. Returns { text, rows, beforeIds, notes }; rows hold the cells to verify.
export function convertAcTables(source, docPath) {
  const notes = [];
  const parsed = parseAcceptance(parseFrontmatter(source).body);
  if (!parsed.length || parsed[0].form !== "table") return { text: source, rows: [], beforeIds: [], notes };
  const lines = source.split("\n");
  const rows = [];
  for (const table of extractTables(source).filter(isAcTable).sort((x, y) => y.line - x.line)) {
    if (!table.rows.every(row => /^AC\d{2,3}$/.test(cleanInline(row[0])))) {
      notes.push({ level: "manual", text: `${docPath}: 验收表里有不是 AC 编号的行，整张表未转换，请人工处理` });
      continue;
    }
    const blocks = table.rows.map(row => {
      const block = renderRow(table.header, row);
      if (!/^(Given|When|Then) /m.test(block)) {
        notes.push({ level: "manual", text: `${docPath}: ${cleanInline(row[0])} 没有拆出 Given / When / Then，请人工补写（原文已保留）` });
      }
      return block;
    });
    rows.unshift(...table.rows.map(row => ({
      id: cleanInline(row[0]),
      cells: row.slice(1).map(cellText => cellText.trim()).filter(cellText => cellText && !EMPTY.test(cellText))
    })));
    lines.splice(table.line, 2 + table.rows.length, ...blocks.join("\n\n").split("\n"));
    notes.push({ level: "info", text: `${docPath}: 验收表 ${table.rows.length} 行 → 标题块` });
  }
  return { text: lines.join("\n"), rows, beforeIds: parsed.map(item => item.id), notes };
}

// Empty result means the conversion kept every AC and every cell's original text.
export function verifyAcConversion({ rows, beforeIds }, after) {
  const problems = [];
  const parsed = parseAcceptance(parseFrontmatter(after).body);
  if (parsed.map(item => item.id).join(",") !== beforeIds.join(",")) {
    problems.push(`AC 编号转换前后不一致：${beforeIds.join(",")} → ${parsed.map(item => item.id).join(",") || "无"}`);
  }
  if (parsed.some(item => item.form !== "heading")) problems.push("转换后仍有表格形式的 AC");
  for (const row of rows) {
    for (const cellText of row.cells) if (!after.includes(cellText)) problems.push(`${row.id} 的原文丢失：${cellText}`);
  }
  return problems;
}
