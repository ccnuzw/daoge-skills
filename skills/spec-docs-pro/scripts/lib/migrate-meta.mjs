// Frontmatter and status-word migration. Everything here is derived from the parsed model or an exact
// vocabulary match; anything that needs a judgement call becomes a "manual" note instead of an edit.

import { extractTables, parseFrontmatter, cleanInline } from "./markdown.mjs";
import { expandAcIds } from "./docs-model.mjs";
import { IMPLEMENTATION_STATUS, EVIDENCE_LEVEL, exactMatch } from "./status.mjs";
import { replaceCell } from "./table-edit.mjs";

const FEATURE_ID = /^V\d+-FR-\d{3}$/;
const ONE_SIDED = new Set(["后端通过", "前端通过"]);
const isStatusRow = row => cleanInline(row[0]) === "状态";
const yaml = value => (/[:#"'\[\]{}&*!|>%@`]|^\s|\s$/.test(value) ? JSON.stringify(value) : value);

// Adds feature_id / version / domain / spec_status when missing. A legacy `status` (frontmatter or the
// 功能卡 "状态" row) is removed only when the implementation-status table already records the feature.
export function migrateFrontmatter(source, feature, docPath, recorded) {
  const notes = [];
  const info = text => notes.push({ level: "info", text: `${docPath}: ${text}` });
  const manual = text => notes.push({ level: "manual", text: `${docPath}: ${text}` });
  const fm = parseFrontmatter(source);
  const lines = source.split("\n");
  const inner = fm.hasFrontmatter ? lines.slice(1, fm.lineCount - 1) : [];
  let body = fm.hasFrontmatter ? lines.slice(fm.lineCount) : lines;
  const bodyLength = body.length;

  const additions = [];
  const want = (key, value, why) => {
    if (fm.data[key] || !value) return;
    additions.push(`${key}: ${yaml(value)}`);
    info(`补 frontmatter ${key}: ${value}（${why}）`);
  };
  if (fm.data.feature_id && !FEATURE_ID.test(fm.data.feature_id)) {
    manual(`feature_id“${fm.data.feature_id}”格式不对，应为 V1-FR-001 这类写法`);
  }
  want("feature_id", feature.id, "来自功能卡或文件序号");
  want("version", feature.version, "来自所在目录");
  want("domain", feature.domain, "来自功能卡或所在目录名");
  want("spec_status", feature.specStatus, "来自功能卡“规格状态”");

  let kept = inner;
  if (fm.data.status) {
    if (recorded) {
      kept = inner.filter(line => !/^status:/.test(line));
      info("删除 frontmatter status（实现状态表已记录）");
    } else manual(`frontmatter status“${fm.data.status}”不在实现状态表里，请先写入实现状态表再删除`);
  }
  const card = extractTables(body.join("\n")).find(table => table.header[0] === "项目" && table.rows.some(isStatusRow));
  if (card) {
    const at = card.line + 2 + card.rows.findIndex(isStatusRow);
    if (recorded) {
      body = [...body.slice(0, at), ...body.slice(at + 1)];
      info("删除功能卡“状态”行（实现状态表已记录）");
    } else manual("功能卡“状态”行需要先写入实现状态表再删除");
  }

  if (!additions.length && kept.length === inner.length && body.length === bodyLength) return { text: source, notes };
  const head = additions.length || fm.hasFrontmatter ? ["---", ...kept, ...additions, "---"] : [];
  return { text: [...head, ...body].join("\n"), notes };
}

// Exact aliases become the canonical word. Prose is never guessed: it is reported together with the
// highest status the AC evidence supports (context.ceilingFor), for the decision table in status-update.md.
export function normalizeStatus(source, doc, context) {
  const notes = [];
  const lines = source.split("\n");
  const tables = extractTables(source);
  const manual = text => notes.push({ level: "manual", text: `${doc.path}: ${text}` });
  const rewrite = (table, column, rowIndex, label, what, raw) => {
    const at = table.line + 2 + rowIndex;
    lines[at] = replaceCell(lines[at], column, label);
    notes.push({ level: "info", text: `${doc.path}: ${what}“${raw}”→“${label}”` });
  };

  if (doc.kind === "status") {
    for (const table of tables) {
      const column = table.header.findIndex(cell => /^(当前)?状态$/.test(cell));
      if (column < 0) continue;
      table.rows.forEach((row, rowIndex) => {
        const id = cleanInline(row[0]);
        const value = cleanInline(row[column]);
        if (!/^(V\d+-FR-\d{3}|\d{1,3})$/.test(id) || !value || /^\{.*\}$/.test(value)) return;
        if (IMPLEMENTATION_STATUS.some(item => item.label === value)) return;
        const exact = exactMatch(IMPLEMENTATION_STATUS, value);
        if (exact) return rewrite(table, column, rowIndex, exact.label, `${id} 实现状态`, value);
        const ceiling = context.ceilingFor(id, doc);
        manual(`${id} 的实现状态“${value}”无法自动映射${ceiling ? `，AC 证据最多支持“${ceiling.label}”（${ceiling.reason}）` : ""}，按 references/modes/status-update.md 的判定表选词`);
      });
    }
  }
  if (doc.kind === "feature") {
    const table = tables.find(item => /^AC(\s*编号)?$/i.test(item.header[0]) && item.header.some(cell => /测试层级|目标命令|目标资产/.test(cell)));
    const column = table ? table.header.findIndex(cell => /状态/.test(cell)) : -1;
    if (table && column >= 0) {
      table.rows.forEach((row, rowIndex) => {
        const value = cleanInline(row[column]);
        if (!value || EVIDENCE_LEVEL.some(item => item.label === value)) return;
        const exact = ONE_SIDED.has(value) ? null : exactMatch(EVIDENCE_LEVEL, value);
        const name = expandAcIds(row[0]).join("/") || cleanInline(row[0]);
        if (exact) return rewrite(table, column, rowIndex, exact.label, `${name} 证据状态`, value);
        manual(`${name} 的证据状态“${value}”无法自动映射，请改成 ${EVIDENCE_LEVEL.map(item => item.label).join(" / ")} 之一`);
      });
    }
  }
  return { text: lines.join("\n"), notes };
}
