const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const { renderPortalTopLinks } = require('./portal_shared');
const { renderPortalHeadAssets } = require('./portal_ui_shared');
const { resolveProfile, buildDisplayDistributions } = require('./template_display_profile');

function escapeHtml(text) {
  return String(text ?? '')
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

function sumValues(record) {
  return Object.values(record || {}).reduce((acc, value) => acc + Number(value || 0), 0);
}

function blockingMissingCount(missing = {}) {
  return Number(missing.prompt_text || 0);
}

function buildReadiness(taskSpec, validation, gates) {
  const blocking = [];
  const cautions = [];
  const errors = Array.isArray(validation.errors) ? validation.errors : [];
  const warnings = Array.isArray(validation.warnings) ? validation.warnings : [];
  const missingTotal = blockingMissingCount(validation.missing);
  const templateMissingTotal = sumValues(gates.templateMissing);
  const sizeIssueCount = (gates.sizeIssues || []).length;
  const shortPromptCount = (gates.shortPrompts || []).length;
  const nearDuplicateCount = (gates.nearDuplicatePairs || []).length;
  const duplicatePromptCount = Number(validation.duplicatePromptCount || 0);
  const slugCollisionCount = (validation.slugCollisions || []).length;

  if (!validation.ok) blocking.push('提示词校验未通过');
  if (errors.length) blocking.push(`存在 ${errors.length} 条错误`);
  if (missingTotal > 0) blocking.push(`仍有 ${missingTotal} 个核心缺失字段`);
  if (templateMissingTotal > 0) blocking.push(`仍有 ${templateMissingTotal} 个模板必填项缺失`);
  if (sizeIssueCount > 0) blocking.push(`存在 ${sizeIssueCount} 个尺寸问题`);
  if (slugCollisionCount > 0) blocking.push(`存在 ${slugCollisionCount} 个标识名冲突`);
  if (duplicatePromptCount > 0) blocking.push(`存在 ${duplicatePromptCount} 条重复提示词`);
  if (Number(taskSpec.concurrency || 0) > 12) blocking.push(`当前并发 ${taskSpec.concurrency} 超过建议上限 12`);

  if (warnings.length) cautions.push(`存在 ${warnings.length} 条警告`);
  if (shortPromptCount > 0) cautions.push(`有 ${shortPromptCount} 条过短提示词`);
  if (nearDuplicateCount > 0) cautions.push(`发现 ${nearDuplicateCount} 组近重复提示词`);
  if (Number(taskSpec.total_count || 0) >= 300 && !taskSpec.sample_size) cautions.push('大批量任务未设置样本阶段');
  if (Number(taskSpec.total_count || 0) >= 300 && !taskSpec.stage_size) cautions.push('大批量任务未设置分阶段大小');
  if (Number(taskSpec.total_count || 0) >= 300 && !taskSpec.auto_pause) cautions.push('大批量任务未开启自动暂停保护');
  if (Number(taskSpec.total_count || 0) >= 100 && taskSpec.require_confirmation === false) cautions.push('当前设置为不经确认直接执行');

  let status = 'green';
  let label = '绿灯';
  let verdict = '可以直接开跑';
  let suggestions = [
    '确认这版总览无误后，直接进入正式生图',
    '如果你还想微调风格、尺寸或并发，可以先回到 prepare 参数阶段',
  ];

  if (blocking.length) {
    status = 'red';
    label = '红灯';
    verdict = '先修正问题，不要直接执行';
    suggestions = [
      '先修正缺失字段、尺寸问题或模板必填项，再重新生成预检页',
      '如果不想逐项改运行参数，可以先换成更保守的 DAOGE 预设',
    ];
  } else if (cautions.length) {
    status = 'yellow';
    label = '黄灯';
    verdict = '可以执行，但建议先调整风险项';
    suggestions = [
      '优先降低并发或先跑样本批，再进入正式执行',
      '如果这是大批量任务，建议开启样本阶段、分阶段与自动暂停',
    ];
  }

  return { status, label, verdict, blocking, cautions, suggestions };
}

function renderList(items, emptyText = '无') {
  if (!items.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `<ul class="info-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderDistribution(items) {
  const list = Array.isArray(items) ? items.slice(0, 8) : [];
  if (!list.length) return `<div class="empty-state">未提供</div>`;
  return `<ul class="info-list">${list.map((item) => `<li>${escapeHtml(item.name)}: ${escapeHtml(item.count)}</li>`).join('')}</ul>`;
}

function renderKeyValueRows(items) {
  return items.map((item) => `
    <div class="kv-row">
      <div class="kv-label">${escapeHtml(item.label)}</div>
      <div class="kv-value">${escapeHtml(item.value ?? '未提供')}</div>
    </div>
  `).join('');
}

function formatModeLabel(mode) {
  const text = String(mode || '').trim();
  if (!text) return '未检测';
  if (text === 'prepare-only') return '预检准备阶段';
  if (text === 'storyboard-board') return '分镜整板预检阶段';
  return text;
}

function renderLink(label, href) {
  if (!href) return '';
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function resolveUserFacingTemplateName(taskSpec, modeDetection, strategy) {
  const outputMode = String(taskSpec.output_mode || '').trim();
  if (outputMode) return outputMode;
  const variantName = String(
    strategy?.template_variant?.display_name ||
    strategy?.template_variant?.name ||
    ''
  ).trim();
  if (variantName) return variantName;
  return String(modeDetection?.detected_template?.name || '').trim() || '未检测';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['task-spec', 'strategy-file', 'prompts-file', 'validation-report', 'preview-file', 'plan-file', 'summary-file', 'mode-file'];
  for (const key of required) {
    if (!args[key]) throw new Error(`Missing required flag: --${key}`);
  }

  const taskSpecPath = path.resolve(args['task-spec']);
  const strategyPath = path.resolve(args['strategy-file']);
  const promptsPath = path.resolve(args['prompts-file']);
  const validationPath = path.resolve(args['validation-report']);
  const previewPath = path.resolve(args['preview-file']);
  const planPath = path.resolve(args['plan-file']);
  const summaryPath = path.resolve(args['summary-file']);
  const modePath = path.resolve(args['mode-file']);
  const outputDir = path.dirname(promptsPath);
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'preflight_board.html'));

  const taskSpec = readJson(taskSpecPath);
  const strategy = readJson(strategyPath);
  const prompts = readJson(promptsPath);
  const validation = readJson(validationPath);
  const batchPlan = readJson(planPath);
  const modeDetection = readJson(modePath);
  const gates = validation.qualityGates || {};
  const storyboard = args['storyboard-file'] && fileExists(path.resolve(args['storyboard-file'])) ? readJson(args['storyboard-file']) : null;
  const template = modeDetection.detected_template || {};
  const readiness = buildReadiness(taskSpec, validation, gates);
  const displayProfile = resolveProfile(prompts);
  const userFacingTemplateName = resolveUserFacingTemplateName(taskSpec, modeDetection, strategy);
  const displayDistributions = buildDisplayDistributions(prompts, displayProfile)
    .map((item) => ({ ...item, counts: item.counts.slice(0, 8) }));

  const readinessClass = `status-${readiness.status}`;
  const statusPillClass = `pill-${readiness.status}`;
  const promptPreviewHtml = path.join(outputDir, 'prompt_preview.html');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Preflight Board</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --bg: #0e1318;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --green: #7cc5a3;
      --yellow: #e2c070;
      --red: #ff8c7a;
      --info: #88b9ff;
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
      max-width: 1480px;
      margin: 0 auto;
      padding: 28px 24px 56px;
    }
    .hero, .section {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero {
      padding: 28px 28px 24px;
      margin-bottom: 20px;
    }
    .status-green {
      background:
        linear-gradient(160deg, rgba(124,197,163,0.16), transparent 38%),
        rgba(255,255,255,0.04);
    }
    .status-yellow {
      background:
        linear-gradient(160deg, rgba(226,192,112,0.16), transparent 38%),
        rgba(255,255,255,0.04);
    }
    .status-red {
      background:
        linear-gradient(160deg, rgba(255,140,122,0.16), transparent 38%),
        rgba(255,255,255,0.04);
    }
    .top-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 0 0 16px;
    }
    .top-links a {
      color: var(--text-main);
      text-decoration: none;
      padding: 10px 14px;
      border-radius: 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      font-size: 13px;
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
      margin: 0 0 12px;
      font-size: 34px;
      line-height: 1.1;
      letter-spacing: 0.02em;
    }
    .hero-copy {
      margin: 0;
      color: var(--text-sub);
      line-height: 1.7;
      max-width: 76ch;
    }
    .hero-grid, .section-grid, .metric-grid {
      display: grid;
      gap: 16px;
    }
    .hero-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 20px;
    }
    .section-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .metric-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-top: 18px;
    }
    .metric-value {
    }
    .metric-green .metric-value { color: var(--green); }
    .metric-yellow .metric-value { color: var(--yellow); }
    .metric-red .metric-value { color: var(--red); }
    .metric-info .metric-value { color: var(--info); }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      margin-bottom: 10px;
    }
    .pill-green { color: var(--green); background: rgba(124,197,163,0.12); }
    .pill-yellow { color: var(--yellow); background: rgba(226,192,112,0.12); }
    .pill-red { color: var(--red); background: rgba(255,140,122,0.12); }
    .kv-list { display: grid; gap: 12px; }
    .kv-row {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .kv-row:last-child { border-bottom: none; }
    .kv-label {
      color: var(--text-sub);
      font-size: 13px;
    }
    .kv-value {
      color: var(--text-main);
      font-size: 14px;
      line-height: 1.6;
    }
    @media (max-width: 1080px) {
      .hero-grid, .section-grid, .metric-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 720px) {
      .shell {
        padding: 18px 14px 44px;
      }
      h1 { font-size: 28px; }
      .hero-grid, .section-grid, .metric-grid {
        grid-template-columns: 1fr;
      }
      .kv-row {
        grid-template-columns: 1fr;
        gap: 6px;
      }
    }
  </style>
</head>
<body data-portal-page="preflight_board.html">
  <div class="shell">
    <section class="hero ${escapeHtml(readinessClass)}">
      <div class="top-links">
        ${renderPortalTopLinks(outputDir, {
          currentPage: 'preflight_board.html',
          extraLinks: [
            { label: 'Markdown 预检页', href: relativeFile(outputDir, outputDir ? path.join(outputDir, 'daoge_preflight_dashboard.md') : null) },
            { label: 'Prompt 预览 Markdown', href: relativeFile(outputDir, previewPath) },
            { label: '运行摘要 Markdown', href: relativeFile(outputDir, summaryPath) },
          ],
        })}
      </div>
      <div class="eyebrow">DAOGE Preflight Board</div>
      <div class="pill ${escapeHtml(statusPillClass)}">当前信号灯：${escapeHtml(readiness.label)}</div>
      <h1>DAOGE 预检总览</h1>
      <p class="hero-copy">这是 prepare 阶段的 HTML 总览页。它负责把这轮任务的预检结论、任务定义、执行参数、质量门禁和关键入口收在一页里，让你在正式开跑前先确认方向、规模和风险。</p>
      <div class="hero-grid">
        <div class="metric-card metric-${escapeHtml(readiness.status)}">
          <div class="metric-label">DAOGE 结论</div>
          <div class="metric-value">${escapeHtml(readiness.label)}</div>
        </div>
        <div class="metric-card metric-info">
          <div class="metric-label">提示词总数</div>
          <div class="metric-value">${escapeHtml(validation.promptCount)}</div>
        </div>
        <div class="metric-card metric-info">
          <div class="metric-label">批次数量</div>
          <div class="metric-value">${escapeHtml(batchPlan.length)}</div>
        </div>
        <div class="metric-card metric-info">
          <div class="metric-label">DAOGE 模板</div>
          <div class="metric-value">${escapeHtml(userFacingTemplateName)}</div>
        </div>
      </div>
      <div class="metric-grid">
        <div class="metric-card metric-red">
          <div class="metric-label">阻塞项数量</div>
          <div class="metric-value">${escapeHtml(readiness.blocking.length)}</div>
        </div>
        <div class="metric-card metric-yellow">
          <div class="metric-label">风险提示数量</div>
          <div class="metric-value">${escapeHtml(readiness.cautions.length)}</div>
        </div>
        <div class="metric-card metric-info">
          <div class="metric-label">当前结论</div>
          <div class="metric-value">${escapeHtml(readiness.verdict)}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2>先看什么</h2>
      <p class="section-copy">先看结论和风险，再看任务定义与执行参数，最后决定是直接开跑、先改 prompt，还是回到 prepare 阶段调整规模和稳定性参数。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>阻塞项</h3>
          ${renderList(readiness.blocking, '无')}
        </article>
        <article class="info-card">
          <h3>风险提示</h3>
          ${renderList(readiness.cautions, '无')}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>任务定义</h2>
      <p class="section-copy">先确认这轮到底在做什么、用什么模板、输出多少张、是不是 storyboard，以及 Prompt 和模式判断是否符合你的预期。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>任务摘要</h3>
          <div class="kv-list">
            ${renderKeyValueRows([
              { label: '内容主题', value: taskSpec.content_brief || '未提供' },
              { label: '输出模式', value: taskSpec.output_mode || '未提供' },
              { label: 'DAOGE 模式', value: formatModeLabel(modeDetection.detected_mode) },
              { label: 'DAOGE 模板', value: userFacingTemplateName },
              { label: '总张数', value: taskSpec.total_count || 0 },
              { label: '运行标签', value: taskSpec.run_label || '未设置' },
            ])}
          </div>
        </article>
        <article class="info-card">
          <h3>模板与风格</h3>
          <div class="kv-list">
            ${renderKeyValueRows([
              { label: '模板文档', value: template.template_doc || '未设置' },
              { label: '模板变体', value: strategy.template_variant?.name || strategy.template_variant?.id || '未设置' },
              { label: 'Style 要求', value: (taskSpec.style_requirements || []).join(' / ') || '未提供' },
              { label: 'Variation 要求', value: (taskSpec.variation_requirements || []).join(' / ') || '未提供' },
              { label: 'StoryBoard', value: storyboard ? '已启用' : '未启用' },
              { label: '参考图数量', value: (taskSpec.source_images || []).length },
            ])}
          </div>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>执行参数</h2>
      <p class="section-copy">这里决定执行阶段的稳定性和速度。大批量任务时，优先关注并发、批次、超时、自动暂停和是否先确认。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>执行规模</h3>
          <div class="kv-list">
            ${renderKeyValueRows([
              { label: '每批张数', value: taskSpec.batch_size },
              { label: '批次数量', value: batchPlan.length },
              { label: '分辨率', value: `${taskSpec.width || '?'} x ${taskSpec.height || '?'}` },
              { label: '比例', value: taskSpec.aspect_ratio_label || '未设置' },
              { label: '输出格式', value: taskSpec.output_format || '未设置' },
              { label: 'Provider', value: taskSpec.provider || 'openai' },
            ])}
          </div>
        </article>
        <article class="info-card">
          <h3>稳定性参数</h3>
          <div class="kv-list">
            ${renderKeyValueRows([
              { label: '并发数', value: taskSpec.concurrency },
              { label: '超时秒数', value: taskSpec.timeout_seconds },
              { label: '重试次数', value: taskSpec.retry_count },
              { label: '样本阶段', value: taskSpec.sample_size || 0 },
              { label: '自动暂停', value: taskSpec.auto_pause ? '已开启' : '未开启' },
              { label: '先确认再执行', value: taskSpec.require_confirmation ? '是' : '否' },
            ])}
          </div>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>质量门禁</h2>
      <p class="section-copy">这里反映提示词本身有没有明显问题，包括缺字段、尺寸问题、重复、过短提示词和模板缺项。这里不过，后面执行阶段就不应该直接开跑。</p>
      <div class="section-grid">
        <article class="info-card">
          <h3>门禁计数</h3>
          <div class="kv-list">
            ${renderKeyValueRows([
              { label: '校验状态', value: validation.ok ? '通过' : '未通过' },
              { label: '错误数', value: (validation.errors || []).length },
              { label: '警告数', value: (validation.warnings || []).length },
              { label: '过短提示词', value: (gates.shortPrompts || []).length },
              { label: '近重复组合', value: (gates.nearDuplicatePairs || []).length },
              { label: '尺寸问题', value: (gates.sizeIssues || []).length },
            ])}
          </div>
        </article>
        <article class="info-card">
          <h3>分布概览</h3>
          <div class="kv-list">
            ${renderKeyValueRows([
              ...displayDistributions.map((item) => ({
                label: item.shortLabel || `${item.label}分布`,
                value: item.counts.slice(0, 4).map((entry) => `${entry.name} ${entry.count}`).join(' / ') || '未提供',
              })),
            ])}
          </div>
        </article>
      </div>
      <div class="section-grid" style="margin-top:16px;">
        ${displayDistributions.slice(0, 2).map((item) => `
          <article class="info-card">
            <h3>${escapeHtml(item.label)} Top</h3>
            ${renderDistribution(item.counts)}
          </article>
        `).join('')}
      </div>
    </section>

    <section class="section">
      <h2>关键入口</h2>
      <p class="section-copy">这一页不取代原始 Markdown 和 JSON，而是把最常看的入口放在一起。你可以从这里继续打开 Prompt 预览、运行摘要、原始 Markdown 预检页和批次计划。</p>
      <article class="info-card">
        <h3>文件入口</h3>
        <div class="link-row">
          ${renderLink('Markdown 预检页', relativeFile(outputDir, path.join(outputDir, 'daoge_preflight_dashboard.md')))}
          ${renderLink('Prompt 预览', fileExists(promptPreviewHtml) ? relativeFile(outputDir, promptPreviewHtml) : relativeFile(outputDir, previewPath))}
          ${renderLink('运行摘要', relativeFile(outputDir, summaryPath))}
          ${renderLink('批次计划 JSON', relativeFile(outputDir, planPath))}
          ${renderLink('Prompt 校验 JSON', relativeFile(outputDir, validationPath))}
        </div>
      </article>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    readinessStatus: readiness.status,
    promptCount: validation.promptCount,
    batchCount: batchPlan.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
