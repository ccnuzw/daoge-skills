// Text-editing helpers for migrate-docs: rewrite one table cell in place, and print a unified diff.

// Character spans of the cells in a table row, between its pipes. Mirrors splitRow() in markdown.mjs:
// "\|" and pipes inside backticks do not split a cell.
export function cellSpans(line) {
  const first = line.indexOf("|");
  const spans = [];
  let start = first + 1;
  let inCode = false;
  for (let i = first + 1; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\\" && line[i + 1] === "|") { i += 1; continue; }
    if (char === "`") inCode = !inCode;
    if (char === "|" && !inCode) { spans.push({ start, end: i }); start = i + 1; }
  }
  return spans;
}

// Replaces the text of one cell and keeps its surrounding padding, so the rest of the row is untouched.
export function replaceCell(line, column, text) {
  const span = cellSpans(line)[column];
  if (!span) return line;
  const raw = line.slice(span.start, span.end);
  if (!raw.trim()) return `${line.slice(0, span.start)} ${text} ${line.slice(span.end)}`;
  const lead = /^\s*/.exec(raw)[0];
  const trail = /\s*$/.exec(raw)[0];
  return line.slice(0, span.start) + lead + text + trail + line.slice(span.end);
}

function diffMiddle(a, b) {
  if (a.length * b.length > 4_000_000) {
    return [...a.map(text => ({ t: "-", text })), ...b.map(text => ({ t: "+", text }))];
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ t: " ", text: a[i] }); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { ops.push({ t: "-", text: a[i] }); i += 1; }
    else { ops.push({ t: "+", text: b[j] }); j += 1; }
  }
  for (; i < a.length; i += 1) ops.push({ t: "-", text: a[i] });
  for (; j < b.length; j += 1) ops.push({ t: "+", text: b[j] });
  return ops;
}

export function unifiedDiff(before, after, name, context = 2) {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const same = lines => lines.map(text => ({ t: " ", text }));
  const ops = [
    ...same(a.slice(0, head)),
    ...diffMiddle(a.slice(head, a.length - tail), b.slice(head, b.length - tail)),
    ...same(a.slice(a.length - tail))
  ];
  const changed = ops.flatMap((op, index) => (op.t === " " ? [] : [index]));
  if (!changed.length) return "";
  const out = [`--- ${name}`, `+++ ${name}`];
  let k = 0;
  while (k < changed.length) {
    let m = k;
    while (m + 1 < changed.length && changed[m + 1] - changed[m] <= context * 2) m += 1;
    const from = Math.max(0, changed[k] - context);
    const slice = ops.slice(from, Math.min(ops.length, changed[m] + context + 1));
    const before = ops.slice(0, from);
    out.push(`@@ -${before.filter(op => op.t !== "+").length + 1},${slice.filter(op => op.t !== "+").length} +${before.filter(op => op.t !== "-").length + 1},${slice.filter(op => op.t !== "-").length} @@`);
    for (const op of slice) out.push(`${op.t}${op.text}`);
    k = m + 1;
  }
  return out.join("\n");
}
