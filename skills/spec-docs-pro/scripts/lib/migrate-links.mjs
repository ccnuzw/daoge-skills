// Renames feature files and rewrites the links that point at them. Link text and anchors are kept;
// only the file name inside the href changes. Plain-text mentions are reported, never edited.

import fs from "node:fs";
import path from "node:path";

const LINK = /\]\(\s*<?([^)\s>#]+)((?:#[^)\s>]*)?)/dg;

// Blank out `code` so links inside inline code are left alone; offsets stay valid because lengths match.
const mask = line => line.replace(/`[^`]*`/g, match => " ".repeat(match.length));

function resolve(fromPath, href) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
  let decoded = href;
  try { decoded = decodeURIComponent(href); } catch { /* keep raw */ }
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), decoded));
}

// texts: Map<docs-relative path, text with \n endings>; renames: [{ from, to }] (docs-relative).
// Returns the rewritten texts and the number of links changed per file.
export function rewriteLinks(texts, renames) {
  const moved = new Map(renames.map(item => [item.from, item.to]));
  const result = new Map();
  const counts = new Map();
  for (const [file, text] of texts) {
    let count = 0;
    let inFence = false;
    const lines = text.split("\n").map(line => {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return line; }
      if (inFence) return line;
      const edits = [];
      for (const match of mask(line).matchAll(LINK)) {
        const target = moved.get(resolve(file, match[1]));
        if (!target) continue;
        const [start, end] = match.indices[1];
        const original = line.slice(start, end);
        const encoded = /%[0-9A-Fa-f]{2}/.test(original);
        const base = path.posix.basename(target);
        edits.push({ start: end - original.split("/").pop().length, end, text: encoded ? encodeURIComponent(base) : base });
      }
      for (const edit of edits.sort((a, b) => b.start - a.start)) {
        line = line.slice(0, edit.start) + edit.text + line.slice(edit.end);
        count += 1;
      }
      return line;
    });
    result.set(file, lines.join("\n"));
    if (count) counts.set(file, count);
  }
  return { texts: result, counts };
}

// Files that still mention an old name as plain text after the rewrite.
export function plainMentions(texts, renames) {
  const found = [];
  for (const [file, text] of texts) {
    for (const item of renames) {
      if (text.includes(path.posix.basename(item.from, ".md"))) found.push({ file, name: path.posix.basename(item.from) });
    }
  }
  return found;
}

// Two phases (to a temporary name, then to the final one) so swaps and chains cannot overwrite each other.
export function applyRenames(docsRoot, renames) {
  const abs = rel => path.join(docsRoot, ...rel.split("/"));
  const staged = renames.map((item, index) => ({ ...item, temp: `${abs(item.from)}.migrate-${index}` }));
  for (const item of staged) fs.renameSync(abs(item.from), item.temp);
  for (const item of staged) fs.renameSync(item.temp, abs(item.to));
}
