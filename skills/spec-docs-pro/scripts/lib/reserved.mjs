// Reserved and deprecated numbers. A number registered on purpose ("V1-FR-011～016 预留") is not a
// typo, so REF001 / REF002 skip it; REF001 stays active for every number that is not registered.

import { extractTables, cleanInline } from "./markdown.mjs";

const RANGE_SEPARATOR = "[～~–—-]|至|到";
const FEATURE_RANGE = new RegExp(`\\b(V\\d+-FR-)(\\d{3})(?:\\s*(?:${RANGE_SEPARATOR})\\s*(?:V\\d+-FR-)?(\\d{3}))?`, "g");
const DECISION_RANGE = new RegExp(`(?<![A-Za-z0-9-])(D)(\\d{3,})(?:\\s*(?:${RANGE_SEPARATOR})\\s*D?(\\d{3,}))?`, "g");
const HEADING_HINT = /保留|预留|废弃|废止/;
const MAX_RANGE = 200;

function expand(text, pattern, kind) {
  const ids = [];
  for (const match of text.matchAll(pattern)) {
    const width = match[2].length;
    const start = Number(match[2]);
    const end = match[3] ? Number(match[3]) : start;
    for (let n = start; n <= end && n - start < MAX_RANGE; n += 1) ids.push({ id: `${match[1]}${String(n).padStart(width, "0")}`, kind });
  }
  return ids;
}

// Tables under a "保留 / 预留 / 废弃" heading in a requirement-numbering document.
// Returns Map<id, { reason: "reserved" | "deprecated", doc }>.
export function parseReserved(docs) {
  const reserved = new Map();
  for (const doc of docs.filter(item => item.kind === "numbering")) {
    for (const table of extractTables(doc.body)) {
      const heading = table.heading ? table.heading.text : "";
      if (!HEADING_HINT.test(heading)) continue;
      const reason = /废弃|废止/.test(heading) ? "deprecated" : "reserved";
      for (const row of table.rows) {
        const cell = cleanInline(row[0] || "");
        for (const { id } of [...expand(cell, FEATURE_RANGE, "feature"), ...expand(cell, DECISION_RANGE, "decision")]) {
          reserved.set(id, { reason, doc: doc.path });
        }
      }
    }
  }
  return reserved;
}
