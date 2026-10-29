// Evidence-state checks for the "AC 逐项测试设计" table: hard rule 7 ("证据分级，不许升格") as code.
// Pure functions over parseAcTestTable() output; check-docs.mjs turns the results into findings.

import { EVIDENCE_LEVEL, EVIDENCE_RANK, IMPLEMENTATION_STATUS, exactMatch } from "./status.mjs";

// "后端通过 / 前端通过" say which side passed, not which environment, so they cannot be mapped to a level.
const ONE_SIDED = new Set(["后端通过", "前端通过"]);
const EMPTY = /^(\{.*\}|[-—–]|)$/;
// A target asset that says the test does not exist yet. Empty cells and "-" are AC006's job.
const ASSET_MISSING = /^(待定|待补|待创建|规划|尚未|tbd)|^无$|未创建/i;
const COMMAND_UNDECIDED = /^(待定|待补|tbd)/i;
const ROW_ID = /^AC\d+/;

const VOCABULARY = EVIDENCE_LEVEL.map(item => item.label).join(" / ");

export function evidenceOf(raw) {
  const text = String(raw || "").trim();
  if (ONE_SIDED.has(text)) return null; // listed as aliases of "本地通过", but they name no environment
  const hit = exactMatch(EVIDENCE_LEVEL, text);
  return hit ? { key: hit.key, label: hit.label, canonical: hit.label === text } : null;
}

// AC009: the column exists and holds one standard word. AC010: the word does not outrun the asset.
export function evidenceFindings(table) {
  const findings = [];
  if (!table.statusColumn) {
    findings.push({ code: "AC009", message: `AC 逐项测试设计表缺少“证据状态”列，无法核对证据级别（可选值：${VOCABULARY}）` });
    return findings;
  }
  for (const row of table.rows) {
    if (!ROW_ID.test(row.id)) continue;
    const raw = String(row.status || "").trim();
    if (EMPTY.test(raw)) {
      findings.push({ code: "AC009", message: `${row.id} 的证据状态为空；没有证据时写“未创建”` });
      continue;
    }
    const evidence = evidenceOf(raw);
    if (!evidence) {
      const hint = ONE_SIDED.has(raw)
        ? "只说明哪一侧通过，没有说明环境；拆成两条 AC，或写“本地通过”并把前后端说明放到备注列"
        : `请改为：${VOCABULARY}；一个单元格只写一个词，补充说明放到备注列`;
      findings.push({ code: "AC009", message: `${row.id} 的证据状态“${raw}”不在标准词表中，${hint}` });
      continue;
    }
    if (!evidence.canonical) {
      const env = evidence.key === "local" ? "；如果证据来自预发或生产环境，写“预发通过”或“生产通过”，不要写成本地通过" : "";
      findings.push({ code: "AC009", message: `${row.id} 的证据状态“${raw}”应写作“${evidence.label}”${env}` });
    }
    const claimsAsset = ["created", "local", "staging", "production", "failed"].includes(evidence.key);
    if (claimsAsset && ASSET_MISSING.test(row.asset || "")) {
      findings.push({ code: "AC010", message: `${row.id} 证据状态是“${evidence.label}”，目标资产却写“${row.asset}”：证据不能先于测试资产` });
    }
    if (["local", "staging", "production"].includes(evidence.key) && COMMAND_UNDECIDED.test(row.command || "")) {
      findings.push({ code: "AC010", message: `${row.id} 证据状态是“${evidence.label}”，目标命令却写“${row.command}”：没有可执行的命令就没有可复现的证据` });
    }
  }
  return findings;
}

// Rows that have a standard evidence word below "本地通过" (or failed). Unknown words are AC009's concern.
export function belowLocal(table) {
  return table.rows.filter(row => {
    if (!ROW_ID.test(row.id)) return false;
    const evidence = evidenceOf(row.status);
    if (!evidence || evidence.key === "na") return false;
    return evidence.key === "failed" || EVIDENCE_RANK[evidence.key] < EVIDENCE_RANK.local;
  });
}

// The highest implementation status the AC evidence can support. An upper bound, not a verdict:
// the script cannot see whether code exists, only how far the tests got.
export function evidenceCeiling(table) {
  if (!table || !table.statusColumn) return null;
  let lowest = Infinity;
  let weakest = null;
  for (const row of table.rows.filter(item => ROW_ID.test(item.id))) {
    const evidence = evidenceOf(row.status);
    if (evidence && evidence.key === "na") continue;
    const rank = !evidence || evidence.key === "failed" ? -1 : EVIDENCE_RANK[evidence.key];
    if (rank < lowest) { lowest = rank; weakest = row; }
  }
  if (!weakest) return null;
  const key = lowest < EVIDENCE_RANK.local ? "in-progress"
    : lowest === EVIDENCE_RANK.local ? "local-verified"
    : lowest === EVIDENCE_RANK.staging ? "pending-acceptance" : "done";
  const label = IMPLEMENTATION_STATUS.find(item => item.key === key).label;
  return { key, label, reason: `${weakest.id} 的证据状态是“${String(weakest.status || "").trim() || "空"}”` };
}
