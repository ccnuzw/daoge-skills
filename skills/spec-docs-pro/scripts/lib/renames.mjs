// Plans file renames that align a feature document's file number with its feature ID (ID003),
// and finds every link that points at the old name. Used by check-docs (suggestion) and migrate-docs.

import fs from "node:fs";
import path from "node:path";
import { extractLinks } from "./markdown.mjs";

function resolveLink(fromPath, href) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return null;
  const target = href.split("#")[0];
  if (!target) return null;
  let decoded = target;
  try { decoded = decodeURIComponent(target); } catch { /* keep raw */ }
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), decoded));
}

// Map<docs-relative path, [{ file, line }]> for every markdown link in every document.
function incomingLinks(docs) {
  const incoming = new Map();
  for (const doc of docs) {
    for (const link of extractLinks(doc.body)) {
      const resolved = resolveLink(doc.path, link.href);
      if (!resolved) continue;
      if (!incoming.has(resolved)) incoming.set(resolved, []);
      incoming.get(resolved).push({ file: doc.path, line: link.line + doc.frontmatterLines + 1 });
    }
  }
  return incoming;
}

function renamedPath(docPath, number) {
  const base = path.posix.basename(docPath);
  const match = /^(\d{2,3})(-.+)$/.exec(base);
  if (!match || Number(match[1]) === number) return null;
  const prefix = String(number).padStart(number > 99 ? 3 : 2, "0");
  return path.posix.join(path.posix.dirname(docPath), `${prefix}${match[2]}`);
}

// One entry per file to rename (the feature document and its 技术设计, which shares the number).
export function planFeatureRenames(docs, features, docsRoot) {
  const byPath = new Map(docs.map(doc => [doc.path, doc]));
  const incoming = incomingLinks(docs);
  const plan = [];
  const taken = new Set();
  for (const feature of features) {
    const number = Number(feature.id.slice(-3));
    for (const id of [feature.doc, feature.design].filter(Boolean)) {
      const from = `${id}.md`;
      const to = renamedPath(from, number);
      if (!to) continue;
      const clash = byPath.has(to) || taken.has(to) || fs.existsSync(path.join(docsRoot, ...to.split("/")));
      taken.add(to);
      plan.push({ feature: feature.id, from, to, conflict: clash, referencedBy: incoming.get(from) || [] });
    }
  }
  return plan;
}
