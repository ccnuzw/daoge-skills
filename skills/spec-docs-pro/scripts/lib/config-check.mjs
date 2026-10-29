// Validates spec-docs.config.json against the docs it configures. A typo in the config used to pass
// silently (an ignored rule that does not exist, a track mapping that matches nothing).

import fs from "node:fs";
import path from "node:path";
import { bestTrack } from "./docs-model.mjs";
import { RULE_CODES, CONFIG_KEYS, PROFILES, closestRule } from "./rules.mjs";

export function validateConfig({ config, docs, model, docsRoot }) {
  const findings = [];
  const add = (code, message) => findings.push({ code, message });

  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.includes(key)) add("CFG003", `未知的配置项“${key}”，可用：${CONFIG_KEYS.join("、")}`);
  }
  if (config.profile != null && !PROFILES[config.profile]) {
    add("CFG003", `profile“${config.profile}”无效，可用：${Object.keys(PROFILES).join(" / ")}`);
  }

  const ignore = config.check && config.check.ignore;
  if (ignore != null && !Array.isArray(ignore)) add("CFG001", "check.ignore 必须是规则号数组，例如 [\"BR002\"]");
  for (const code of Array.isArray(ignore) ? ignore : []) {
    if (RULE_CODES.includes(code)) continue;
    const close = closestRule(code);
    add("CFG001", `check.ignore 里的“${code}”不是已有规则号${close ? `，是否应写 ${close}` : ""}（规则列表见 references/check-rules.md）`);
  }

  const featureIds = new Set(model.features.map(feature => feature.id));
  for (const [id, label] of Object.entries(config.featureTracks || {})) {
    if (!featureIds.has(id)) {
      add("CFG002", `featureTracks 里的功能 ${id} 不存在`);
    } else if (!model.tracks.length) {
      add("CFG002", `featureTracks 映射了 ${id}，但功能演进矩阵里没有能力主线可供匹配`);
    } else if (!bestTrack(model.tracks, String(label))) {
      add("CFG002", `featureTracks：${id} → “${label}” 没有匹配到任何能力主线（现有：${model.tracks.map(track => track.title).join("、")}）`);
    }
  }

  const docPaths = new Set(docs.map(doc => doc.path));
  for (const key of Object.keys(config.docGoals || {})) {
    if (!docPaths.has(key)) add("CFG003", `docGoals 里的文档 ${key} 不存在`);
  }
  const decisionIds = new Set(model.decisions.map(decision => decision.id));
  for (const item of config.keyDecisions || []) {
    if (item && item.id && model.decisions.length && !decisionIds.has(item.id)) add("CFG003", `keyDecisions 里的决策 ${item.id} 不存在`);
  }
  for (const prefix of config.exclude || []) {
    const target = path.join(docsRoot, String(prefix).replace(/\/?\*\*$/, ""));
    if (!fs.existsSync(target)) add("CFG003", `exclude 里的路径 ${prefix} 在 docs 下不存在`);
  }
  return findings;
}
