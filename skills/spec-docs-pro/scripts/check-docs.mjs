#!/usr/bin/env node
// Static consistency checks for a spec-docs-pro docs/ tree. Read-only.
// Usage: node scripts/check-docs.mjs [--docs docs] [--config docs/spec-docs.config.json] [--json] [--only CODE,CODE]
//        [--max-warnings N]
// Exit code: 0 = no errors, 1 = errors found (or warnings above --max-warnings), 2 = bad usage.
// Rule codes are documented in references/check-rules.md.

import fs from "node:fs";
import path from "node:path";
import { buildModel, loadConfig, parseAcceptance, parseAcTestTable, cardFields } from "./lib/docs-model.mjs";
import { extractLinks, extractHeadings, extractTables, scanLines, cleanInline } from "./lib/markdown.mjs";
import { matchImplementationStatus, IMPLEMENTATION_STATUS, isCanonical, SPEC_STATUS, exactMatch, PASSING_STATUS } from "./lib/status.mjs";
import { evidenceFindings, belowLocal, evidenceCeiling } from "./lib/evidence.mjs";
import { parseReserved } from "./lib/reserved.mjs";
import { validateConfig } from "./lib/config-check.mjs";
import { planFeatureRenames } from "./lib/renames.mjs";
import { PROFILES } from "./lib/rules.mjs";

function parseArgs(argv) {
  const args = { docs: "docs", config: null, json: false, only: null, maxWarnings: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage(`${arg} 需要一个值`);
      return argv[++i];
    };
    if (arg === "--docs") args.docs = next();
    else if (arg === "--config") args.config = next();
    else if (arg === "--json") args.json = true;
    else if (arg === "--only") args.only = new Set(next().split(",").map(item => item.trim().toUpperCase()));
    else if (arg === "--max-warnings") args.maxWarnings = Number(next());
    else if (arg === "-h" || arg === "--help") usage();
    else usage(`未知参数: ${arg}`);
  }
  return args;
}

function usage(message) {
  if (message) console.error(`错误：${message}`);
  console.error("用法: node check-docs.mjs [--docs docs] [--config 文件] [--json] [--only ID001,LNK001] [--max-warnings N]");
  process.exit(message ? 2 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const docsRoot = path.resolve(args.docs);
  if (!fs.existsSync(docsRoot)) usage(`docs 目录不存在: ${docsRoot}`);
  const configPath = args.config ? path.resolve(args.config) : path.join(docsRoot, "spec-docs.config.json");
  if (args.config && !fs.existsSync(configPath)) usage(`配置文件不存在: ${configPath}`);
  const config = loadConfig(configPath);
  const { docs, model } = buildModel(docsRoot, { config });
  const byPath = new Map(docs.map(doc => [doc.path, doc]));
  const ignored = new Set(Array.isArray(config.check && config.check.ignore) ? config.check.ignore : []);
  const archived = doc => /^99-|(^|\/)历史归档\//.test(doc.path);
  const findings = [];

  // profile "small": completeness rules wait until a feature's spec is Ready (see lib/rules.mjs).
  const profile = PROFILES[config.profile] ? config.profile : "medium";
  const draftDocs = new Set(model.features.filter(feature => feature.specStatus === "Draft").map(feature => `${feature.doc}.md`));
  const exempted = {};

  const report = (code, severity, doc, line, message, extra = {}) => {
    if (ignored.has(code) || (args.only && !args.only.has(code))) return;
    if (doc && PROFILES[profile].draftExempt.includes(code) && draftDocs.has(doc.path)) {
      exempted[code] = (exempted[code] || 0) + 1;
      return;
    }
    findings.push({ code, severity, file: doc ? doc.path : "", line: line == null ? null : line + 1, message, ...extra });
  };
  const bodyLine = (doc, line) => line + doc.frontmatterLines;
  const reserved = parseReserved(docs);
  const renamePlan = planFeatureRenames(docs, model.features, docsRoot);

  // ---- IDs ----
  const featureIds = new Map();
  for (const feature of model.features) {
    const doc = byPath.get(`${feature.doc}.md`);
    if (featureIds.has(feature.id)) {
      report("ID001", "error", doc, 0, `功能编号 ${feature.id} 重复，另见 ${featureIds.get(feature.id)}.md`);
    } else featureIds.set(feature.id, feature.doc);
    if (!/^V\d+-FR-\d{3}$/.test(String(doc.fm.feature_id || ""))) {
      report("ID002", "warning", doc, 0, `frontmatter 缺少规范的 feature_id（推断为 ${feature.id}）`);
    }
    const fileNumber = /^(\d{2,3})-/.exec(path.posix.basename(doc.path));
    if (fileNumber && Number(fileNumber[1]) !== Number(feature.id.slice(-3))) {
      const renames = renamePlan.filter(item => item.feature === feature.id);
      const main = renames.find(item => item.from === doc.path);
      let message = `文件序号 ${fileNumber[1]} 与 ${feature.id} 不一致`;
      if (main) {
        const refs = new Set(renames.flatMap(item => item.referencedBy.map(ref => ref.file)));
        message += main.conflict
          ? `；应改为 ${path.posix.basename(main.to)}，但目标文件已存在，需要先处理冲突`
          : `；应改为 ${path.posix.basename(main.to)}${renames.length > 1 ? "（同名技术设计一并改）" : ""}，引用它的文件有 ${refs.size} 个${refs.size ? `：${[...refs].slice(0, 5).join("、")}${refs.size > 5 ? " 等" : ""}` : ""}`;
      }
      report("ID003", "warning", doc, 0, message, { suggestion: { renames } });
    }
  }

  const decisionIds = new Map();
  for (const decision of model.decisions) {
    const doc = byPath.get(`${decision.doc}.md`);
    if (decisionIds.has(decision.id)) report("ID004", "error", doc, bodyLine(doc, decision.line), `决策编号 ${decision.id} 重复`);
    decisionIds.set(decision.id, decision);
  }
  const adrIds = new Set();
  for (const adr of model.adrs) {
    if (adrIds.has(adr.id)) report("ID004", "error", byPath.get(`${adr.doc}.md`), 0, `ADR 编号 ${adr.id} 重复`);
    adrIds.add(adr.id);
  }

  // ---- references to IDs and links ----
  const referenced = { features: new Set(), decisions: new Set() };
  for (const doc of docs) {
    for (const item of scanLines(doc.body)) {
      if (item.inCode) continue;
      for (const match of item.line.matchAll(/\bV\d+-FR-\d{3}\b/g)) referenced.features.add(match[0]);
      for (const match of item.line.matchAll(/(?<![A-Za-z0-9-])D\d{3,}\b/g)) referenced.decisions.add(match[0]);
    }
    if (archived(doc)) continue;

    for (const item of scanLines(doc.body)) {
      if (item.inCode) continue;
      for (const match of item.line.matchAll(/\bV\d+-FR-\d{3}\b/g)) {
        // Numbers registered as reserved or deprecated in the numbering document are intentional.
        if (!featureIds.has(match[0]) && model.features.length && !reserved.has(match[0])) {
          report("REF001", "warning", doc, bodyLine(doc, item.index), `引用了不存在的功能编号 ${match[0]}（有意预留的编号请登记到需求编号文档的“保留编号”或“已废弃编号”表）`);
        }
      }
      for (const match of item.line.matchAll(/(?<![A-Za-z0-9-])(D\d{3,})\b/g)) {
        if (model.decisions.length && !decisionIds.has(match[1]) && !reserved.has(match[1]) && !/^D\d{3,}\s/.test(cleanInline(item.line.replace(/^#+\s*/, "")))) {
          report("REF002", "warning", doc, bodyLine(doc, item.index), `引用了不存在的决策编号 ${match[1]}`);
        }
      }
    }

    for (const link of extractLinks(doc.body)) {
      const href = link.href;
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
      const [target, anchor] = href.split("#");
      let decoded = target;
      try { decoded = decodeURIComponent(target); } catch { /* keep raw */ }
      if (!decoded) {
        if (anchor) checkAnchor(doc, doc, anchor, `#${anchor}`, link.line);
        continue;
      }
      const resolved = path.resolve(path.dirname(path.join(docsRoot, doc.path)), decoded);
      const insideDocs = !path.relative(docsRoot, resolved).startsWith("..");
      if (!fs.existsSync(resolved)) {
        if (insideDocs) report("LNK001", "error", doc, bodyLine(doc, link.line), `${link.image ? "图片" : "链接"}目标不存在：${href}`);
        else report("LNK003", "info", doc, bodyLine(doc, link.line), `链接指向 docs/ 之外且当前不存在（可能是仓库代码路径）：${href}`);
        continue;
      }
      if (anchor && /\.md$/i.test(decoded)) {
        const rel = path.relative(docsRoot, resolved).split(path.sep).join("/");
        const targetDoc = byPath.get(rel);
        if (targetDoc) checkAnchor(doc, targetDoc, anchor, href, link.line);
      }
    }
  }

  // GitHub only jumps to an exact heading slug. A prefix hit ("#d007" for "d007-局域网-...") works
  // in the offline viewer but is a dead link on GitHub, so it is reported separately, never accepted.
  function anchorState(doc, anchor) {
    let wanted = anchor;
    try { wanted = decodeURIComponent(anchor); } catch { /* keep raw */ }
    wanted = wanted.toLowerCase();
    const headings = extractHeadings(doc.body);
    if (headings.some(heading => heading.slug === wanted)) return { ok: true };
    const near = headings.find(heading => heading.slug.startsWith(wanted) || heading.text.toLowerCase().startsWith(`${wanted} `));
    return { ok: false, near: near ? near.slug : null };
  }

  function checkAnchor(doc, targetDoc, anchor, href, line) {
    const state = anchorState(targetDoc, anchor);
    if (state.ok) return;
    if (state.near) report("LNK004", "warning", doc, bodyLine(doc, line), `锚点 #${anchor} 只是标题锚点的前缀，GitHub 上不会跳转；应写完整锚点 #${state.near}（${href}）`);
    else report("LNK002", "warning", doc, bodyLine(doc, line), `${targetDoc === doc ? "页内" : ""}锚点不存在：${href}`);
  }

  // ---- features: AC, test table, design branches, status placement ----
  const acTables = new Map();
  for (const feature of model.features) {
    const doc = byPath.get(`${feature.doc}.md`);
    if (archived(doc)) continue;
    const acs = parseAcceptance(doc.body);
    const deprecated = /废弃|deprecated/i.test(feature.specStatus);
    if (!acs.length && !deprecated) report("AC001", "error", doc, null, "没有找到验收标准（#### AC01 标题）");
    const seen = new Set();
    if (acs.length && acs[0].form === "table") {
      report("AC008", "warning", doc, bodyLine(doc, acs[0].line), "验收标准使用了表格简写，建议改为“#### ACNN 标题”+ Given / When / Then");
    }
    for (const ac of acs) {
      if (seen.has(ac.id)) report("AC002", "error", doc, bodyLine(doc, ac.line), `${ac.id} 重复`);
      seen.add(ac.id);
      if (ac.form === "heading" && !(ac.given && ac.when && ac.then)) {
        report("AC003", "warning", doc, bodyLine(doc, ac.line), `${ac.id} 没有完整的 Given / When / Then`);
      }
    }
    const table = parseAcTestTable(doc.body);
    if (acs.length && !table) report("AC004", "error", doc, null, "缺少 AC 逐项测试设计表（列：AC | 验收重点 | 测试层级 | 目标资产 | 目标命令 | 证据状态）");
    if (table) {
      acTables.set(feature.id, table);
      for (const item of evidenceFindings(table)) report(item.code, "warning", doc, bodyLine(doc, table.line), item.message);
      const rows = new Map(table.rows.map(row => [row.id, row]));
      for (const ac of acs) {
        const row = rows.get(ac.id);
        if (!row) {
          report("AC005", "error", doc, bodyLine(doc, table.line), `${ac.id} 没有出现在 AC 逐项测试设计表中`);
          continue;
        }
        const missing = ["level", "asset", "command"].filter(key => !row[key] || /^\{.*\}$|^[-—]$/.test(row[key]));
        if (missing.length) {
          report("AC006", "warning", doc, bodyLine(doc, table.line), `${ac.id} 测试设计缺少：${missing.map(key => ({ level: "测试层级", asset: "目标资产", command: "目标命令" })[key]).join("、")}`);
        }
      }
      for (const row of table.rows) {
        if (/^AC\d+/.test(row.id) && !seen.has(row.id)) report("AC007", "warning", doc, bodyLine(doc, table.line), `测试设计表中的 ${row.id} 没有对应的 AC 定义`);
      }
    }

    if (doc.fm.status || /^\|\s*状态\s*\|/m.test(doc.body.split(/\n## /)[1] || "")) {
      report("ST002", "warning", doc, 0, "功能主文档内记录了实现状态（frontmatter status 或功能卡“状态”行）。实现状态只在版本实现状态表维护，请改用 spec_status 表示规格状态");
    }
    if (feature.specStatus && !isCanonical(SPEC_STATUS, feature.specStatus)) {
      report("ST003", "warning", doc, 0, `规格状态“${feature.specStatus}”不在标准词表（Draft / Ready / Deprecated）中`);
    }

    if (feature.risk === "high" && !feature.design && !deprecated) {
      report("TD001", "warning", doc, null, "高风险功能没有独立技术设计文档（同目录 NN-功能名-技术设计.md）");
    }
    if (!deprecated) {
      // A missing field renders as a blank in the viewer, and a missing risk level silently reads as "标准".
      const card = cardFields(doc.body);
      const fields = [
        ["领域", doc.fm.domain || card["领域"]],
        ["规格状态", doc.fm.spec_status || card["规格状态"]],
        ["风险等级", doc.fm.risk || card["风险等级"] || card["风险"]],
        ["上游依赖", card["上游依赖"]]
      ];
      const unfilled = value => !value || /^\{.*\}$|^[-—–]$|\{|标准\s*\/\s*高风险/.test(value);
      const missing = fields.filter(([, value]) => unfilled(String(value || "").trim())).map(([name]) => name);
      if (missing.length) {
        report("FC001", "warning", doc, null, `功能卡缺少或未填写：${missing.join("、")}（没有可写的内容时写“无”或“不适用：理由”）`);
      }
    }
    const designDoc = feature.design ? byPath.get(`${feature.design}.md`) : null;
    const branchSources = [doc, designDoc].filter(Boolean);
    checkBranches(feature, branchSources, seen);
  }

  function checkBranches(feature, sources, acIds) {
    const number = String(Number(feature.id.slice(-3))).padStart(2, "0");
    const defined = new Map();
    let tableDoc = null;
    const mapped = new Set();
    for (const doc of sources) {
      for (const item of scanLines(doc.body)) {
        if (!item.inCode) continue;
        for (const match of item.line.matchAll(/\bB(\d{2,3})-(\d{2})\b/g)) {
          defined.set(match[0], { doc, line: item.index });
          if (match[1].padStart(2, "0") !== number && Number(match[1]) !== Number(number)) {
            report("BR001", "warning", doc, bodyLine(doc, item.index), `分支 ${match[0]} 的功能号与 ${feature.id} 不一致（应为 B${number}-NN）`);
          }
        }
      }
      for (const table of extractTables(doc.body)) {
        if (!/^分支/.test(table.header[0])) continue;
        tableDoc = doc;
        for (const row of table.rows) {
          for (const id of expandBranches(row[0])) mapped.add(id);
          const acRefs = (row.join(" ").match(/\bAC\d{2,3}\b/g) || []);
          for (const ac of acRefs) {
            if (acIds.size && !acIds.has(ac)) report("BR003", "warning", doc, bodyLine(doc, table.line), `分支追踪表引用了不存在的 ${ac}`);
          }
        }
      }
    }
    if (!defined.size) return;
    if (!tableDoc) {
      const doc = sources[sources.length - 1];
      report("BR002", "error", doc, null, `伪代码定义了 ${defined.size} 个分支 ID，但缺少“分支到测试追踪”表`);
      return;
    }
    for (const [id, where] of defined) {
      if (!mapped.has(id)) report("BR002", "warning", where.doc, bodyLine(where.doc, where.line), `分支 ${id} 没有出现在分支到测试追踪表中`);
    }
  }

  function expandBranches(cell) {
    const ids = [];
    const text = cleanInline(cell);
    for (const match of text.matchAll(/B(\d{2,3})-(\d{2})(?:\s*[～~–-]\s*(?:B\d{2,3}-)?(\d{2}))?/g)) {
      const start = Number(match[2]);
      const end = match[3] ? Number(match[3]) : start;
      for (let n = start; n <= end; n += 1) ids.push(`B${match[1]}-${String(n).padStart(2, "0")}`);
    }
    return ids;
  }

  // ---- status table ----
  const statusDocs = docs.filter(doc => doc.kind === "status" && !archived(doc));
  for (const doc of statusDocs) {
    for (const table of extractTables(doc.body)) {
      const statusCol = table.header.findIndex(cell => /^(当前)?状态$/.test(cell));
      if (statusCol < 0) continue;
      for (const row of table.rows) {
        if (!/^(V\d+-FR-\d{3}|\d{1,3})$/.test(cleanInline(row[0]))) continue;
        const value = cleanInline(row[statusCol]);
        if (!value || /^\{.*\}$/.test(value)) continue;
        const rowId = cleanInline(row[0]);
        const bare = /^\d{1,3}$/.test(rowId) ? rowId.padStart(3, "0") : null;
        const feature = model.features.find(item => item.id === rowId || (bare && item.version === (doc.version || "V1") && item.number.padStart(3, "0") === bare));
        const acTable = feature ? acTables.get(feature.id) : null;
        const exact = exactMatch(IMPLEMENTATION_STATUS, value);
        if (!isCanonical(IMPLEMENTATION_STATUS, value)) {
          // Only a whole-cell match is a safe rewrite. Prose such as "核心实现完成，待正式验收" needs the
          // decision table in references/modes/status-update.md, so say what the AC evidence can support.
          const ceiling = evidenceCeiling(acTable);
          const hint = exact
            ? `，应写作“${exact.label}”`
            : `，无法自动映射；按 references/modes/status-update.md 的判定表选词${ceiling ? `（该功能的 AC 证据最多支持“${ceiling.label}”：${ceiling.reason}）` : ""}`;
          report("ST004", "warning", doc, bodyLine(doc, table.line), `实现状态“${value}”不在标准词表中${hint}`);
        }
        if (exact && PASSING_STATUS.has(exact.key) && acTable) {
          const behind = belowLocal(acTable);
          if (behind.length) {
            report("ST007", "warning", doc, bodyLine(doc, table.line), `${rowId} 的状态是“${exact.label}”，但 ${feature.doc}.md 中 ${behind.map(item => `${item.id}（${item.status || "空"}）`).join("、")} 的证据状态还没到“本地通过”`);
          }
        }
      }
    }
    const featureTables = extractTables(doc.body).filter(table => table.rows.some(row => /^(V\d+-FR-\d{3}|\d{1,3})$/.test(cleanInline(row[0]))));
    if (featureTables.length && !featureTables.some(table => table.header.some(cell => /^(当前)?状态$/.test(cell)))) {
      report("ST005", "warning", doc, null, "实现状态表缺少单独的“状态”列，生成器只能从后端/前端描述中推断状态");
    }
  }
  if (model.features.length && !statusDocs.length) {
    report("ST006", "warning", null, null, "存在功能主文档，但没有版本实现状态文档（02-产品与版本/当前版本/V1-实现状态.md）");
  }
  for (const warning of model.warnings.filter(item => item.code === "ST001")) {
    report("ST001", "warning", byPath.get(`${warning.doc}.md`), null, warning.message);
  }

  // ---- decisions ----
  for (const decision of model.decisions) {
    const doc = byPath.get(`${decision.doc}.md`);
    if (decision.statusKey === "unknown") report("DC001", "warning", doc, bodyLine(doc, decision.line), `${decision.id} 没有标准状态（已冻结 / 草案 / 已取代 / 已撤销）`);
  }

  // ---- evolution matrix ----
  const evolutionDoc = docs.find(doc => doc.kind === "evolution");
  if (evolutionDoc) {
    for (const warning of model.warnings.filter(item => item.code.startsWith("EV"))) {
      report(warning.code, "warning", byPath.get(`${warning.doc}.md`) || evolutionDoc, null, warning.message);
    }
    for (const track of model.tracks) {
      if (track.columns && track.columns < 5) report("EV003", "warning", evolutionDoc, bodyLine(evolutionDoc, track.line), `能力主线“${track.title}”的阶段表少于 5 列`);
      for (const stage of track.stages) {
        if (!stage.version) report("EV004", "warning", evolutionDoc, bodyLine(evolutionDoc, track.line), `阶段“${stage.stage}”没有以 V{n} / 后续 开头，时间线无法归属版本`);
      }
    }
    const headings = extractHeadings(evolutionDoc.body);
    for (const heading of headings) {
      if (heading.level === 3 && /^\d+\.\d+\s*V\d+/.test(heading.text)) {
        report("EV005", "warning", evolutionDoc, bodyLine(evolutionDoc, heading.line), `“${heading.text}”使用了层级标题描述阶段，请改为能力主线下的阶段表格行`);
      }
    }
  }

  // ---- roadmap versions need their own doc (hard rule 11) ----
  for (const version of model.versions) {
    if (version.kind === "planned" && !version.doc) {
      report("VR001", "warning", docs.find(doc => doc.kind === "roadmap"), null, `规划中的 ${version.id} 没有独立的版本规划文档（02-产品与版本/后续版本/${version.id}-{主题}.md）`);
    }
  }

  // ---- template leftovers ----
  for (const doc of docs) {
    if (archived(doc)) continue;
    for (const item of scanLines(doc.body)) {
      if (item.inCode) continue;
      const hit = /\{(?:YYYY-MM-DD|编号|功能名|中文功能名|领域|日期|版本|项目名称|负责人|测试命令|测试文件路径)[^}]*\}/.exec(item.line);
      if (hit) {
        report("TPL001", "warning", doc, bodyLine(doc, item.index), `残留模板占位符 ${hit[0]}`);
        break;
      }
    }
  }

  // ---- reserved numbers must not be live features ----
  for (const feature of model.features) {
    const entry = reserved.get(feature.id);
    if (entry && !/废弃|deprecated/i.test(feature.specStatus)) {
      report("REF003", "warning", byPath.get(`${feature.doc}.md`), 0, `${feature.id} 登记为${entry.reason === "deprecated" ? "已废弃" : "保留"}编号（${entry.doc}），却有一份正在使用的功能文档；从保留表移除，或把该功能标为 Deprecated`);
    }
  }

  // ---- config ----
  const configRel = path.relative(docsRoot, configPath).split(path.sep).join("/");
  if (fs.existsSync(configPath)) {
    for (const item of validateConfig({ config, docs, model, docsRoot })) {
      report(item.code, "warning", { path: configRel }, null, item.message);
    }
  }

  // ---- output ----
  const rank = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || a.file.localeCompare(b.file) || (a.line || 0) - (b.line || 0));
  const errors = findings.filter(item => item.severity === "error").length;
  const warnings = findings.filter(item => item.severity === "warning").length;
  const infos = findings.length - errors - warnings;
  const summary = {
    docs: docs.length,
    features: model.features.length,
    decisions: model.decisions.length,
    errors,
    warnings,
    infos,
    profile,
    exempted,
    byCode: findings.reduce((acc, item) => ((acc[item.code] = (acc[item.code] || 0) + 1), acc), {})
  };

  if (args.json) {
    console.log(JSON.stringify({ summary, findings }, null, 2));
  } else {
    let lastFile = null;
    for (const item of findings) {
      if (item.file !== lastFile) {
        console.log(`\n${item.file || "(全局)"}`);
        lastFile = item.file;
      }
      const icon = { error: "✖", warning: "⚠", info: "ℹ" }[item.severity];
      console.log(`  ${icon} ${item.code}${item.line ? ` L${item.line}` : ""}  ${item.message}`);
    }
    console.log(`\n检查 ${summary.docs} 份文档、${summary.features} 个功能、${summary.decisions} 条决策：${errors} 个错误，${warnings} 个警告，${infos} 条提示`);
    const codes = Object.entries(summary.byCode).sort((a, b) => b[1] - a[1]).map(([code, count]) => `${code}×${count}`);
    if (codes.length) console.log(`按规则：${codes.join("  ")}（规则说明见 references/check-rules.md）`);
    const skipped = Object.entries(exempted).map(([code, count]) => `${code}×${count}`);
    if (skipped.length) {
      console.log(`profile=${profile}：Draft 状态功能暂不检查 ${skipped.join("  ")}（规格改为 Ready 后恢复检查；用 --json 的 summary.exempted 可核对）`);
    }
  }
  const tooManyWarnings = Number.isFinite(args.maxWarnings) && warnings > args.maxWarnings;
  process.exit(errors || tooManyWarnings ? 1 : 0);
}

main();
