const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const { renderPortalTopLinks, renderPortalContextBar } = require('./portal_shared');
const { renderPortalHeadAssets } = require('./portal_ui_shared');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeFile(outputDir, targetPath) {
  if (!targetPath) return null;
  return path.relative(outputDir, targetPath);
}

function isNeedsReview(item) {
  const requestMode = String(item.requestMode || item.request_mode || '').trim();
  const editSource = String(item.editSource || item.edit_source || '').trim();
  return requestMode === 'masked-edit' || editSource === 'previous-output';
}

function hasWhitespaceSensitivePolicy(item) {
  const textPolicy = String(item.textPolicy || item.text_policy || '').toLowerCase();
  return /leave|blank|clean|typography|headline|copy|文案|留白/.test(textPolicy);
}

function deriveRiskTags(item) {
  const tags = [];
  const requestMode = String(item.requestMode || item.request_mode || '').trim();
  const slotId = String(item.slotId || item.slot_id || '').trim();
  const referenceImages = ensureArray(item.referenceImages || item.reference_images);

  if (!item.ok) tags.push('执行失败');
  if (isNeedsReview(item)) tags.push('局部编辑边界风险');
  if (requestMode === 'reference-assisted') tags.push('需检查参考图贴合度');
  if (requestMode === 'masked-edit') tags.push('需检查遮罩融合感');
  if (hasWhitespaceSensitivePolicy(item)) tags.push('需检查文案留白');
  if (!slotId) tags.push('槽位归属未记录');
  if (requestMode !== 'prompt-only' && !referenceImages.length) tags.push('参考素材记录缺失');
  if (String(item.error || '').trim()) tags.push('失败原因待确认');
  return Array.from(new Set(tags));
}

function computeReviewScore(item) {
  let score = item.ok ? 78 : 26;
  if (item.ok && !isNeedsReview(item)) score += 10;
  if (isNeedsReview(item)) score -= 14;
  if (!item.output && item.ok) score -= 18;
  if (!String(item.slotId || item.slot_id || '').trim()) score -= 10;
  if (!String(item.scene || '').trim()) score -= 6;
  if (!String(item.composition || '').trim()) score -= 6;
  if (hasWhitespaceSensitivePolicy(item)) score -= 4;
  if (String(item.requestMode || item.request_mode || '').trim() === 'reference-assisted') score -= 5;
  if (String(item.requestMode || item.request_mode || '').trim() === 'masked-edit') score -= 8;
  if (!item.ok) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function enrichItem(item) {
  const reviewScore = computeReviewScore(item);
  const riskTags = deriveRiskTags(item);
  return {
    ...item,
    reviewScore,
    riskTags,
  };
}

function summarizeKeepCandidates(success) {
  const scored = [...success].map(enrichItem).sort((a, b) => {
    if (a.reviewScore !== b.reviewScore) return b.reviewScore - a.reviewScore;
    const aLocal = isNeedsReview(a) ? 1 : 0;
    const bLocal = isNeedsReview(b) ? 1 : 0;
    if (aLocal !== bLocal) return aLocal - bLocal;
    const aSlot = String(a.slotId || a.slot_id || '');
    const bSlot = String(b.slotId || b.slot_id || '');
    return aSlot.localeCompare(bSlot);
  });
  return scored.slice(0, 6).map((item, idx) => ({
    rank: idx + 1,
    index: item.index,
    title: item.title || item.slug,
    slotId: item.slotId || item.slot_id || null,
    requestMode: item.requestMode || item.request_mode || 'prompt-only',
    reviewScore: item.reviewScore,
    reason: isNeedsReview(item)
      ? '已成功，但属于局部编辑结果，建议人工确认边界与融合感。'
      : '成功出图且不属于局部编辑，适合作为保留候选或下一轮参考底图。',
  }));
}

function summarizeActionCounts(success, failed, needsReview, averageScore) {
  return [
    { label: '建议保留', count: Math.min(success.length, 6), tone: 'keep' },
    { label: '建议重跑', count: failed.length, tone: 'rerun' },
    { label: '建议复核', count: needsReview.length, tone: 'review' },
    { label: '平均审阅分', count: averageScore, tone: 'score' },
  ];
}

function renderMetricCards(metrics) {
  return metrics.map((item) => `
    <div class="metric-card metric-${escapeHtml(item.tone)}">
      <div class="metric-label">${escapeHtml(item.label)}</div>
      <div class="metric-value">${escapeHtml(item.count)}</div>
    </div>
  `).join('\n');
}

function renderRecommendations(keepCandidates, rerunCandidates, needsReview) {
  const lines = [];
  if (keepCandidates.length) {
    lines.push('<section class="recommendation-block">');
    lines.push('<h2>建议保留</h2>');
    lines.push('<ul>');
    keepCandidates.forEach((item) => {
      lines.push(`<li>#${escapeHtml(item.rank)} ${escapeHtml(item.title)}${item.slotId ? ` · ${escapeHtml(item.slotId)}` : ''} · 审阅分 ${escapeHtml(item.reviewScore)} · ${escapeHtml(item.reason)}</li>`);
    });
    lines.push('</ul>');
    lines.push('</section>');
  }

  if (rerunCandidates.length) {
    lines.push('<section class="recommendation-block">');
    lines.push('<h2>建议重跑</h2>');
    lines.push('<ul>');
    rerunCandidates.forEach((item) => {
      lines.push(`<li>${escapeHtml(item.title || item.slug || item.index || '未命名结果')}${item.slotId ? ` · ${escapeHtml(item.slotId)}` : ''} · ${escapeHtml(item.error || '执行失败，建议失败续跑')}</li>`);
    });
    lines.push('</ul>');
    lines.push('</section>');
  }

  if (needsReview.length) {
    lines.push('<section class="recommendation-block">');
    lines.push('<h2>建议复核</h2>');
    lines.push('<ul>');
    needsReview.slice(0, 8).forEach((item) => {
      lines.push(`<li>${escapeHtml(item.title || item.slug || item.index || '未命名结果')}${item.slotId ? ` · ${escapeHtml(item.slotId)}` : ''} · 局部编辑结果，重点看遮罩边界、融合感与主体一致性。</li>`);
    });
    lines.push('</ul>');
    lines.push('</section>');
  }

  return lines.join('\n');
}

function renderLegend() {
  return `
    <div class="status-legend">
      <div class="legend-item legend-keep"><span class="legend-dot"></span><span>建议保留：适合先看、可进入下一轮扩图或保留候选</span></div>
      <div class="legend-item legend-review"><span class="legend-dot"></span><span>建议复核：局部编辑或视觉风险较高，先人工看细节</span></div>
      <div class="legend-item legend-rerun"><span class="legend-dot"></span><span>建议重跑：执行失败或当前结果明显不稳</span></div>
    </div>
  `;
}

function renderRiskTags(tags) {
  if (!tags.length) return '<div class="risk-tags"><span class="risk-tag risk-tag-clean">风险较低</span></div>';
  return `<div class="risk-tags">${tags.map((tag) => `<span class="risk-tag">${escapeHtml(tag)}</span>`).join('')}</div>`;
}

function cardSearchText(item) {
  return [
    item.title || item.slug || item.index,
    item.slotId || item.slot_id,
    item.shotLabel || item.shot_label,
    item.requestMode || item.request_mode,
    item.scene,
    item.composition,
    item.timecode,
    item.textPolicy || item.text_policy,
    ...(item.riskTags || []),
    item.visualReviewReason,
    item.visualNextAction,
  ].filter(Boolean).join(' ').toLowerCase();
}

function buildVisualReviewMap(reviewAnalysis) {
  const map = new Map();
  const items = ensureArray(reviewAnalysis?.items);
  items.forEach((item) => {
    if (!item?.output) return;
    map.set(path.resolve(item.output), item);
  });
  return map;
}

function renderCard(item, outputDir, storyboardBoardRelative, assetsBoardRelative) {
  const enriched = item.reviewScore === undefined || !Array.isArray(item.riskTags) ? enrichItem(item) : item;
  const relativeImage = relativeFile(outputDir, item.output);
  const requestMode = enriched.requestMode || enriched.request_mode || 'prompt-only';
  const slotId = enriched.slotId || enriched.slot_id || '';
  const shotLabel = enriched.shotLabel || enriched.shot_label || '';
  const title = enriched.title || enriched.slug || enriched.index || '未命名结果';
  const statusTone = enriched.ok ? (isNeedsReview(enriched) ? 'review' : 'keep') : 'rerun';
  const statusText = enriched.ok
    ? (isNeedsReview(enriched) ? '建议复核' : '建议保留')
    : '建议重跑';
  const priorityText = statusTone === 'keep'
    ? '优先看'
    : (statusTone === 'review' ? '需要细看' : '最后处理');
  const meta = [
    enriched.index ? `#${enriched.index}` : null,
    slotId || null,
    shotLabel || null,
    requestMode || null,
  ].filter(Boolean).join(' · ');

  const detailLines = [];
  if (enriched.scene) detailLines.push(`场景：${enriched.scene}`);
  if (enriched.composition) detailLines.push(`构图：${enriched.composition}`);
  if (enriched.timecode) detailLines.push(`时间码：${enriched.timecode}`);
  if (enriched.textPolicy || enriched.text_policy) detailLines.push(`文案策略：${enriched.textPolicy || enriched.text_policy}`);
  if (enriched.error) detailLines.push(`错误：${enriched.error}`);
  if (!enriched.error && enriched.revisedPrompt) detailLines.push(`修订提示：${enriched.revisedPrompt}`);
  if (enriched.visualReviewReason) detailLines.push(`视觉结论：${enriched.visualReviewReason}`);
  if (enriched.visualNextAction) detailLines.push(`视觉建议：${enriched.visualNextAction}`);
  const verdict = enriched.visualVerdict || statusTone;
  const primaryNotes = detailLines.slice(0, 2);
  const extraNotes = detailLines.slice(2);

  return `
    <article
      class="review-card review-${escapeHtml(statusTone)}"
      data-title="${escapeHtml(title.toLowerCase())}"
      data-slot="${escapeHtml(String(slotId || '').toLowerCase())}"
      data-mode="${escapeHtml(String(requestMode || '').toLowerCase())}"
      data-status="${escapeHtml(String(statusTone || '').toLowerCase())}"
      data-verdict="${escapeHtml(String(verdict || '').toLowerCase())}"
      data-score="${escapeHtml(enriched.reviewScore)}"
      data-search="${escapeHtml(cardSearchText(enriched))}"
    >
      <div class="card-media ${relativeImage ? 'has-image' : 'missing-image'}">
        ${relativeImage ? `<img src="${escapeHtml(relativeImage)}" alt="${escapeHtml(title)}" />` : '<div class="card-placeholder">No image</div>'}
        <div class="card-status">${escapeHtml(statusText)}</div>
        <div class="card-score">审阅分 ${escapeHtml(enriched.reviewScore)}</div>
      </div>
      <div class="card-body">
        <h3>${escapeHtml(title)}</h3>
        <div class="card-meta">${escapeHtml(meta || '未记录元数据')}</div>
        <div class="card-priority">处理优先级：<strong>${escapeHtml(priorityText)}</strong></div>
        <div class="card-jump-group">
          ${storyboardBoardRelative && slotId ? `<div class="card-jump"><a href="${escapeHtml(storyboardBoardRelative)}#slot-${escapeHtml(slotId)}">查看整板位置</a></div>` : ''}
          ${assetsBoardRelative && slotId ? `<div class="card-jump"><a href="${escapeHtml(assetsBoardRelative)}#slot-${escapeHtml(slotId)}">查看素材来源</a></div>` : ''}
        </div>
        ${renderRiskTags(enriched.riskTags)}
        <div class="card-notes card-notes-primary">${primaryNotes.length ? primaryNotes.map((line) => `<p>${escapeHtml(line)}</p>`).join('') : '<p>无额外备注。</p>'}</div>
        ${detailLines.length ? `
          <details class="card-details">
            <summary>展开更多细节</summary>
            <div class="card-notes card-notes-extra">${(extraNotes.length ? extraNotes : ['当前无更多细节。']).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>
          </details>
        ` : ''}
      </div>
    </article>
  `;
}

function renderSection(title, subtitle, items, outputDir, storyboardBoardRelative, assetsBoardRelative) {
  const averageScore = items.length
    ? Math.round(items.reduce((sum, item) => sum + Number(item.reviewScore || 0), 0) / items.length)
    : 0;
  const statusBreakdown = {
    keep: items.filter((item) => (item.visualVerdict || (item.ok ? (isNeedsReview(item) ? 'review' : 'keep') : 'rerun')) === 'keep').length,
    review: items.filter((item) => (item.visualVerdict || (item.ok ? (isNeedsReview(item) ? 'review' : 'keep') : 'rerun')) === 'review').length,
    rerun: items.filter((item) => (item.visualVerdict || (item.ok ? (isNeedsReview(item) ? 'review' : 'keep') : 'rerun')) === 'rerun').length,
  };
  return `
    <section class="board-section">
      <div class="section-header">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <div class="section-summary">
          <span>数量 ${escapeHtml(items.length)}</span>
          <span>均分 ${escapeHtml(averageScore)}</span>
          <span>保留 ${escapeHtml(statusBreakdown.keep)}</span>
          <span>复核 ${escapeHtml(statusBreakdown.review)}</span>
          <span>重跑 ${escapeHtml(statusBreakdown.rerun)}</span>
        </div>
      </div>
      <div class="card-grid">
        ${items.length ? items.map((item) => renderCard(item, outputDir, storyboardBoardRelative, assetsBoardRelative)).join('\n') : '<div class="empty-state">这一组当前没有项目。</div>'}
      </div>
    </section>
  `;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const outputDir = path.resolve(args['output-dir'] || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'review_board.html'));
  const manifest = readJson(manifestPath);
  const successFile = path.join(outputDir, 'success.json');
  const failedFile = path.join(outputDir, 'failed.json');
  const needsReviewFile = path.join(outputDir, 'needs_review.json');
  const rerunCandidatesFile = path.join(outputDir, 'rerun_candidates.json');
  const operationsReportFile = path.join(outputDir, 'operations_report.json');
  const reviewAnalysisFile = path.join(outputDir, 'review_analysis.json');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  const assetsBoardFile = path.join(outputDir, 'assets_board.html');
  const resultHubFile = path.join(outputDir, 'result_hub.html');
  const resultHubMarkdownFile = path.join(outputDir, 'daoge_result_hub.md');
  const completionReportFile = path.join(outputDir, 'daoge_completion_report.md');
  const portalHomeFile = path.join(outputDir, 'daoge_portal.html');
  const storyboardBoardRelative = fileExists(storyboardBoardFile) ? relativeFile(outputDir, storyboardBoardFile) : null;
  const assetsBoardRelative = fileExists(assetsBoardFile) ? relativeFile(outputDir, assetsBoardFile) : null;

  const success = fileExists(successFile) ? readJson(successFile) : [];
  const failed = fileExists(failedFile) ? readJson(failedFile) : [];
  const needsReview = fileExists(needsReviewFile) ? readJson(needsReviewFile) : [];
  const rerunCandidates = fileExists(rerunCandidatesFile) ? readJson(rerunCandidatesFile) : [];
  const operations = fileExists(operationsReportFile) ? readJson(operationsReportFile) : null;
  const reviewAnalysis = fileExists(reviewAnalysisFile) ? readJson(reviewAnalysisFile) : null;
  const visualReviewMap = buildVisualReviewMap(reviewAnalysis);
  const mergeVisualReview = (item) => {
    const absoluteOutput = item.output ? path.resolve(item.output) : null;
    const visualReview = absoluteOutput ? visualReviewMap.get(absoluteOutput) : null;
    const base = enrichItem(item);
    if (!visualReview) return base;
    return {
      ...base,
      reviewScore: Number.isFinite(Number(visualReview.score)) ? Number(visualReview.score) : base.reviewScore,
      riskTags: Array.isArray(visualReview.risk_tags) && visualReview.risk_tags.length
        ? Array.from(new Set([...base.riskTags, ...visualReview.risk_tags]))
        : base.riskTags,
      visualVerdict: visualReview.verdict || null,
      visualConfidence: Number.isFinite(Number(visualReview.confidence)) ? Number(visualReview.confidence) : null,
      visualReviewReason: visualReview.reason || null,
      visualNextAction: visualReview.next_action || null,
    };
  };
  const enrichedSuccess = success.map(mergeVisualReview);
  const enrichedFailed = failed.map(mergeVisualReview);
  const enrichedNeedsReview = needsReview.map(mergeVisualReview);
  const averageScore = enrichedSuccess.length
    ? Math.round(enrichedSuccess.reduce((sum, item) => sum + item.reviewScore, 0) / enrichedSuccess.length)
    : 0;
  const keepCandidates = summarizeKeepCandidates(success);
  const metrics = summarizeActionCounts(success, failed, needsReview, averageScore);
  const reviewContextBar = renderPortalContextBar({
    runLabel: path.basename(outputDir),
    boardLabel: manifest.boardId || manifest.board_id || manifest.storyboardBoardId || '',
    phaseLabel: '结果审阅',
    flowLabel: '运行 -> 审阅 -> 整板 / 完成 / 补跑',
    counts: [
      { label: '成功', value: success.length },
      { label: '失败', value: failed.length },
      { label: '复核', value: needsReview.length },
      { label: '均分', value: averageScore },
    ],
    hints: [
      reviewAnalysis?.enabled ? `视觉审阅已启用，覆盖 ${reviewAnalysis.itemCount || 0} 张结果` : '当前仅使用规则型审阅分与风险标签',
      failed.length ? '当前存在失败项，结果判断要结合补跑看板一起看' : '当前可以优先在保留候选和整板之间来回判断',
    ],
  });
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE 结果审阅看板</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --bg: #0e1318;
      --bg-soft: #141b23;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --keep: #7cc5a3;
      --rerun: #ff8c7a;
      --review: #e2c070;
      --score: #88b9ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(217,179,109,0.18), transparent 26%),
        linear-gradient(135deg, #0a0f13 0%, #101720 45%, #0e1318 100%);
      color: var(--text-main);
      font-family: "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }
    .shell {
      max-width: 1520px;
      margin: 0 auto;
      padding: 28px 24px 56px;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.7fr);
      gap: 20px;
      margin-bottom: 24px;
    }
    .hero-panel,
    .side-panel,
    .board-section {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero-panel {
      padding: 28px 28px 24px;
      background:
        linear-gradient(160deg, rgba(217,179,109,0.15), transparent 38%),
        rgba(255,255,255,0.04);
    }
    .hero-topline {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 0.8fr);
      gap: 18px;
      align-items: start;
    }
    .eyebrow {
      display: inline-flex;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    h1 {
      margin: 0;
      font-size: 34px;
      line-height: 1.1;
      letter-spacing: 0.02em;
    }
    .hero-copy {
      margin: 14px 0 18px;
      color: var(--text-sub);
      line-height: 1.7;
      max-width: 72ch;
    }
    .hero-callout {
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.08);
      background:
        linear-gradient(180deg, rgba(136,185,255,0.1), rgba(255,255,255,0.02)),
        rgba(255,255,255,0.03);
      padding: 16px 16px 14px;
    }
    .hero-callout h2 {
      margin: 0 0 8px;
      font-size: 16px;
    }
    .hero-callout p {
      margin: 0;
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.6;
    }
    .hero-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .hero-links a {
      color: var(--text-main);
      text-decoration: none;
      padding: 10px 14px;
      border-radius: 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      font-size: 13px;
    }
    .control-panel {
      margin-top: 18px;
      display: grid;
      grid-template-columns: minmax(220px, 1.4fr) repeat(4, minmax(140px, 0.65fr));
      gap: 12px;
    }
    .control-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .control-item label {
      color: var(--text-sub);
      font-size: 12px;
    }
    .control-item input,
    .control-item select {
      width: 100%;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.06);
      color: var(--text-main);
      border-radius: 14px;
      padding: 10px 12px;
      font-size: 13px;
      outline: none;
    }
    .control-item input::placeholder {
      color: rgba(243,239,230,0.4);
    }
    .side-panel {
      padding: 22px 20px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .side-title {
      margin: 0 0 10px;
      font-size: 18px;
      color: var(--accent);
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metric-card {
      border-radius: 18px;
      padding: 16px 16px 18px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .metric-label {
      color: var(--text-sub);
      font-size: 12px;
      margin-bottom: 10px;
    }
    .metric-value {
      font-size: 28px;
      font-weight: 700;
    }
    .metric-keep .metric-value { color: var(--keep); }
    .metric-rerun .metric-value { color: var(--rerun); }
    .metric-review .metric-value { color: var(--review); }
    .metric-score .metric-value { color: var(--score); }
    .status-legend {
      display: grid;
      gap: 10px;
      margin-top: 8px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.04);
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.5;
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      flex: 0 0 auto;
    }
    .legend-keep .legend-dot { background: var(--keep); }
    .legend-review .legend-dot { background: var(--review); }
    .legend-rerun .legend-dot { background: var(--rerun); }
    .recommendation-block h2,
    .board-section h2 {
      margin: 0 0 10px;
      font-size: 18px;
    }
    .recommendation-block ul {
      margin: 0;
      padding-left: 18px;
      color: var(--text-sub);
      line-height: 1.65;
    }
    .section-stack {
      display: grid;
      gap: 18px;
      margin-top: 18px;
    }
    .board-section {
      padding: 22px;
    }
    .board-section:first-child {
      border-color: rgba(124,197,163,0.18);
      background:
        linear-gradient(180deg, rgba(124,197,163,0.08), rgba(255,255,255,0.02)),
        rgba(255,255,255,0.04);
    }
    .board-section:nth-child(2) {
      border-color: rgba(226,192,112,0.18);
      background:
        linear-gradient(180deg, rgba(226,192,112,0.08), rgba(255,255,255,0.02)),
        rgba(255,255,255,0.04);
    }
    .board-section:nth-child(3) {
      border-color: rgba(255,140,122,0.18);
      background:
        linear-gradient(180deg, rgba(255,140,122,0.08), rgba(255,255,255,0.02)),
        rgba(255,255,255,0.04);
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
      margin-bottom: 16px;
    }
    .section-header > div:first-child {
      max-width: 68ch;
    }
    .section-header p {
      margin: 0;
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.5;
      max-width: 72ch;
    }
    .section-summary {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .section-summary span {
      display: inline-flex;
      align-items: center;
      padding: 7px 10px;
      border-radius: 999px;
      font-size: 12px;
      color: var(--text-sub);
      border: 1px solid rgba(255,255,255,0.08);
      background: rgba(255,255,255,0.05);
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    body.gallery-density .card-grid {
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 14px;
    }
    .card-grid.filtered-empty::after {
      content: '当前筛选条件下没有结果。';
      display: block;
      padding: 24px;
      border-radius: 18px;
      background: rgba(255,255,255,0.04);
      color: var(--text-sub);
      text-align: center;
      border: 1px dashed rgba(255,255,255,0.14);
      grid-column: 1 / -1;
    }
    .review-card {
      border-radius: 20px;
      overflow: hidden;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .card-media {
      position: relative;
      aspect-ratio: 4 / 5;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)),
        repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 12px, transparent 12px, transparent 24px);
    }
    .card-media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .card-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-sub);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .card-status {
      position: absolute;
      left: 12px;
      top: 12px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: rgba(14,19,24,0.72);
      border: 1px solid rgba(255,255,255,0.12);
    }
    .card-score {
      position: absolute;
      right: 12px;
      top: 12px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      color: var(--score);
      background: rgba(14,19,24,0.72);
      border: 1px solid rgba(255,255,255,0.12);
    }
    .review-keep .card-status { color: var(--keep); }
    .review-rerun .card-status { color: var(--rerun); }
    .review-review .card-status { color: var(--review); }
    .card-body {
      padding: 14px 14px 16px;
    }
    body.gallery-density .card-body {
      padding: 12px 12px 14px;
    }
    .card-body h3 {
      margin: 0 0 8px;
      font-size: 16px;
      line-height: 1.35;
    }
    body.gallery-density .card-body h3 {
      font-size: 15px;
      margin-bottom: 6px;
    }
    .card-meta {
      color: var(--accent);
      font-size: 12px;
      margin-bottom: 10px;
    }
    body.gallery-density .card-meta {
      margin-bottom: 8px;
      font-size: 11px;
    }
    .card-priority {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
      font-size: 12px;
      color: var(--text-sub);
    }
    body.gallery-density .card-priority,
    body.gallery-density .card-jump,
    body.gallery-density .card-notes,
    body.gallery-density .card-details {
      display: none;
    }
    .card-priority strong {
      color: var(--text-main);
      font-size: 14px;
    }
    .card-jump {
      margin-bottom: 10px;
    }
    .card-jump-group {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 10px;
    }
    .card-jump a {
      color: var(--accent);
      font-size: 12px;
      text-decoration: none;
      border-bottom: 1px solid rgba(217,179,109,0.35);
      padding-bottom: 1px;
    }
    .card-jump a:hover {
      color: var(--text-main);
      border-bottom-color: rgba(243,239,230,0.45);
    }
    .risk-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .risk-tag {
      display: inline-flex;
      align-items: center;
      padding: 5px 9px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.1);
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1;
    }
    .risk-tag-clean {
      color: var(--keep);
    }
    .card-notes p {
      margin: 0 0 6px;
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.55;
    }
    .card-notes-primary {
      min-height: 42px;
    }
    .card-details {
      margin-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.08);
      padding-top: 10px;
    }
    .card-details summary {
      cursor: pointer;
      color: var(--accent);
      font-size: 12px;
      list-style: none;
      user-select: none;
    }
    .card-details summary::-webkit-details-marker {
      display: none;
    }
    .card-details summary::before {
      content: '＋ ';
    }
    .card-details[open] summary::before {
      content: '－ ';
    }
    .card-notes-extra {
      margin-top: 10px;
    }
    .empty-state {
      padding: 28px;
      border-radius: 18px;
      background: rgba(255,255,255,0.04);
      color: var(--text-sub);
      text-align: center;
      border: 1px dashed rgba(255,255,255,0.14);
    }
    .ops-summary {
      margin-top: 10px;
      color: var(--text-sub);
      font-size: 13px;
      line-height: 1.6;
    }
    .filter-summary {
      margin-top: 14px;
      color: var(--accent);
      font-size: 13px;
    }
    @media (max-width: 1080px) {
      .hero {
        grid-template-columns: 1fr;
      }
      .hero-topline {
        grid-template-columns: 1fr;
      }
      .control-panel {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .metric-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .shell {
        padding: 18px 14px 44px;
      }
      h1 { font-size: 28px; }
      .control-panel {
        grid-template-columns: 1fr;
      }
      .metric-grid {
        grid-template-columns: 1fr;
      }
      .section-header {
        flex-direction: column;
        align-items: flex-start;
      }
      .section-summary {
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body data-portal-page="review_board.html">
  <div class="shell">
    <div class="hero">
      <section class="hero-panel">
        <div class="hero-topline">
          <div>
            <div class="eyebrow">DAOGE Review Layer</div>
            <h1>DAOGE 结果审阅看板</h1>
            <p class="hero-copy">
              这一页不是执行报告，而是本轮结果的决策面板。先在这里决定哪些图保留、哪些图复核、哪些图值得重跑，再回到结果目录或 storyboard 装板继续推进。
            </p>
            ${reviewContextBar}
          </div>
          <div class="hero-callout">
            <h2>先看哪里</h2>
            <p>先扫顶部动作概览和状态图例，再看三大结果分区。默认优先看“建议保留”，其次是“待复核”，最后处理失败或重跑项。</p>
          </div>
        </div>
        <div class="hero-links">
          ${renderPortalTopLinks(outputDir, {
            currentPage: 'review_board.html',
            extraLinks: [
              { label: '结果总入口', file: resultHubFile },
              { label: '结果总入口 Markdown', file: resultHubMarkdownFile },
              { label: '完成报告 Markdown', file: completionReportFile },
            ],
          })}
        </div>
        <div class="control-panel">
          <div class="control-item">
            <label for="review-search">搜索标题 / 槽位 / 风险标签</label>
            <input id="review-search" type="search" placeholder="例如 shot_2 / 遮罩 / hero reveal" />
          </div>
          <div class="control-item">
            <label for="review-status">按结论筛选</label>
            <select id="review-status">
              <option value="all">全部</option>
              <option value="keep">建议保留</option>
              <option value="review">建议复核</option>
              <option value="rerun">建议重跑</option>
            </select>
          </div>
          <div class="control-item">
            <label for="review-mode">按模式筛选</label>
            <select id="review-mode">
              <option value="all">全部模式</option>
              <option value="prompt-only">prompt-only</option>
              <option value="reference-assisted">reference-assisted</option>
              <option value="masked-edit">masked-edit</option>
            </select>
          </div>
          <div class="control-item">
            <label for="review-sort">排序</label>
            <select id="review-sort">
              <option value="score-desc">审阅分：高到低</option>
              <option value="score-asc">审阅分：低到高</option>
              <option value="title-asc">标题：A-Z</option>
              <option value="slot-asc">槽位：A-Z</option>
            </select>
          </div>
          <div class="control-item">
            <label for="review-density">浏览模式</label>
            <select id="review-density">
              <option value="review">审阅模式</option>
              <option value="gallery">画廊模式</option>
            </select>
          </div>
        </div>
        <div class="ops-summary">
          成功 ${escapeHtml(success.length)} 张，失败 ${escapeHtml(failed.length)} 张，建议复核 ${escapeHtml(needsReview.length)} 张。
          当前平均审阅分 ${escapeHtml(averageScore)}。
          ${operations ? `当前主 request mode：${escapeHtml((operations.distributions?.requestMode || []).slice(0, 3).map((item) => `${item.name}(${item.count})`).join('，') || '未记录')}` : ''}
          ${reviewAnalysis?.enabled ? `视觉审阅：已启用，分析 ${escapeHtml(reviewAnalysis.itemCount || 0)} 张。` : ''}
        </div>
        <div class="filter-summary" id="filter-summary">当前展示全部结果。</div>
      </section>
      <aside class="side-panel">
        <div>
          <h2 class="side-title">结果摘要</h2>
          <div class="metric-grid">
            ${renderMetricCards(metrics)}
          </div>
        </div>
        <div>
          <h2 class="side-title">状态图例</h2>
          ${renderLegend()}
        </div>
        <div>
          <h2 class="side-title">分组导航</h2>
          ${renderRecommendations(keepCandidates, rerunCandidates, needsReview)}
        </div>
      </aside>
    </div>

    <div class="section-stack">
      ${renderSection('建议保留 / 继续扩图候选', '优先看这些成功且相对稳定的结果，适合作为保留候选或下一轮参考底图。审阅分越高，越适合先看。', enrichedSuccess.sort((a, b) => b.reviewScore - a.reviewScore).slice(0, 12), outputDir, storyboardBoardRelative, assetsBoardRelative)}
      ${renderSection('局部编辑 / 待复核结果', '这一组优先检查遮罩边界、融合感、主体一致性与局部改动是否越界。风险标签会标出局部编辑和留白敏感项。', enrichedNeedsReview, outputDir, storyboardBoardRelative, assetsBoardRelative)}
      ${renderSection('失败或建议重跑项', '先看失败原因，再决定是失败续跑、回到 prompt 调整，还是改素材绑定后再跑。', enrichedFailed.length ? enrichedFailed : rerunCandidates.map(enrichItem), outputDir, storyboardBoardRelative, assetsBoardRelative)}
    </div>
  </div>
  <script>
    (() => {
      const searchInput = document.getElementById('review-search');
      const statusSelect = document.getElementById('review-status');
      const modeSelect = document.getElementById('review-mode');
      const sortSelect = document.getElementById('review-sort');
      const densitySelect = document.getElementById('review-density');
      const summary = document.getElementById('filter-summary');
      const grids = Array.from(document.querySelectorAll('.card-grid'));
      const cards = Array.from(document.querySelectorAll('.review-card'));

      function sortCards(grid) {
        const currentCards = Array.from(grid.querySelectorAll('.review-card')).filter((card) => card.style.display !== 'none');
        const mode = sortSelect.value;
        currentCards.sort((a, b) => {
          if (mode === 'score-asc') return Number(a.dataset.score || 0) - Number(b.dataset.score || 0);
          if (mode === 'title-asc') return String(a.dataset.title || '').localeCompare(String(b.dataset.title || ''));
          if (mode === 'slot-asc') return String(a.dataset.slot || '').localeCompare(String(b.dataset.slot || ''));
          return Number(b.dataset.score || 0) - Number(a.dataset.score || 0);
        });
        currentCards.forEach((card) => grid.appendChild(card));
      }

      function updateEmptyState(grid) {
        const visibleCount = Array.from(grid.querySelectorAll('.review-card')).filter((card) => card.style.display !== 'none').length;
        grid.classList.toggle('filtered-empty', visibleCount === 0);
      }

      function applyFilters() {
        const search = String(searchInput.value || '').trim().toLowerCase();
        const status = statusSelect.value;
        const mode = modeSelect.value;
        const density = densitySelect.value;
        let visible = 0;

        document.body.classList.toggle('gallery-density', density === 'gallery');

        cards.forEach((card) => {
          const matchesSearch = !search || String(card.dataset.search || '').includes(search);
          const matchesStatus = status === 'all' || card.dataset.status === status || card.dataset.verdict === status;
          const matchesMode = mode === 'all' || card.dataset.mode === mode;
          const shouldShow = matchesSearch && matchesStatus && matchesMode;
          card.style.display = shouldShow ? '' : 'none';
          if (shouldShow) visible += 1;
        });

        grids.forEach((grid) => {
          sortCards(grid);
          updateEmptyState(grid);
        });

        const total = cards.length;
        summary.textContent = visible === total
          ? \`当前展示全部结果，共 \${total} 张。\`
          : \`当前筛选后展示 \${visible} / \${total} 张结果。\`;
      }

      [searchInput, statusSelect, modeSelect, sortSelect, densitySelect].forEach((node) => {
        node.addEventListener('input', applyFilters);
        node.addEventListener('change', applyFilters);
      });

      applyFilters();
    })();
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    successCount: success.length,
    failedCount: failed.length,
    reviewCount: needsReview.length,
    keepCount: keepCandidates.length,
    averageScore,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
