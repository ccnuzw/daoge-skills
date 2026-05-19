const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, ensureDir, writeJson, fileExists } = require('./script_utils');

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key];
    const label = value === undefined || value === null || value === '' ? '未设置' : String(value).trim();
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function top(entries, limit = 5) {
  return entries.slice(0, limit);
}

function topLabel(entries, fallback = '未指定') {
  return entries[0]?.name || fallback;
}

function chunkSummary(prompts, batchSize) {
  const size = Math.max(1, Number(batchSize || prompts.length || 1));
  const batches = [];
  for (let i = 0; i < prompts.length; i += size) {
    const items = prompts.slice(i, i + size);
    batches.push({
      batch_number: batches.length + 1,
      prompt_count: items.length,
      first_index: items[0]?.index ?? i + 1,
      last_index: items[items.length - 1]?.index ?? i + items.length,
    });
  }
  return batches;
}

function summarizeTask(taskSpec = {}) {
  return {
    content_brief: taskSpec.content_brief || '未提供',
    output_mode: taskSpec.output_mode || '未提供',
    total_count: Number(taskSpec.total_count || 0),
    batch_size: Number(taskSpec.batch_size || 0),
    preview_count: Number(taskSpec.preview_count || 0),
    width: Number(taskSpec.width || 0),
    height: Number(taskSpec.height || 0),
    text_policy: taskSpec.text_policy || '未提供',
    variation_requirements: Array.isArray(taskSpec.variation_requirements) ? taskSpec.variation_requirements : [],
    style_requirements: Array.isArray(taskSpec.style_requirements) ? taskSpec.style_requirements : [],
  };
}

function pickTemplate(runtimeMode, strategy) {
  const variant = strategy?.template_variant || strategy?.template || null;
  const modeTemplate = runtimeMode?.detected_template || runtimeMode?.template || null;
  const chosen = modeTemplate || variant || null;
  if (!chosen) return null;
  return {
    id: chosen.id || null,
    name: chosen.name || chosen.label || null,
    template_doc: chosen.template_doc || null,
  };
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeLink(outputDir, targetPath) {
  if (!targetPath) return null;
  return path.relative(outputDir, targetPath);
}

function writeMarkdown(filePath, lines) {
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['prompts-file', 'task-spec', 'strategy-file', 'runtime-mode-file', 'output-dir'];
  for (const key of required) {
    if (!args[key]) throw new Error(`Missing required flag: --${key}`);
  }

  const promptsFile = path.resolve(args['prompts-file']);
  const taskSpecFile = path.resolve(args['task-spec']);
  const strategyFile = path.resolve(args['strategy-file']);
  const runtimeModeFile = path.resolve(args['runtime-mode-file']);
  const outputDir = path.resolve(args['output-dir']);

  const prompts = readJson(promptsFile);
  if (!Array.isArray(prompts)) throw new Error(`Prompt file must be a JSON array: ${promptsFile}`);

  const taskSpec = readJson(taskSpecFile);
  const strategy = readJson(strategyFile);
  const runtimeMode = readJson(runtimeModeFile);

  ensureDir(outputDir);

  const promptCount = prompts.length;
  const styleSummary = {
    style_family: top(countBy(prompts, 'style_family')),
    scene: top(countBy(prompts, 'scene')),
    wardrobe: top(countBy(prompts, 'wardrobe')),
    composition: top(countBy(prompts, 'composition')),
    reference_mode: top(countBy(prompts, 'reference_mode')),
  };
  const batchSummary = chunkSummary(prompts, taskSpec.batch_size || promptCount || 1);
  const template = pickTemplate(runtimeMode, strategy);
  const taskSummary = summarizeTask(taskSpec);

  const pack = {
    runtime_mode: runtimeMode.mode || runtimeMode.detected_mode || 'unknown',
    recommendation: runtimeMode.recommendation || 'review-before-host-run',
    summary: runtimeMode.summary || '',
    prompts_file: promptsFile,
    prompt_count: promptCount,
    template,
    task_summary: taskSummary,
    style_summary: styleSummary,
    batch_summary: batchSummary,
    next_actions: [
      '先确认模板、数量、构图和风格方向是否符合当前任务。',
      '将 prompts.generated.json 或摘要内容交给宿主原生图像工具执行。',
      '如果宿主侧首轮结果偏离目标，优先调整 prompts.generated.json 后再重新导出摘要。',
    ],
    artifacts: {
      prompts_generated_json: promptsFile,
      task_spec: taskSpecFile,
      prompt_strategy: strategyFile,
      runtime_mode: runtimeModeFile,
    },
  };

  const jsonPath = path.join(outputDir, 'host_native_prompt_pack.json');
  const markdownPath = path.join(outputDir, 'host_native_summary.md');
  const htmlPath = path.join(outputDir, 'host_native_summary.html');

  writeJson(jsonPath, pack);

  const markdownLines = [
    '# DAOGE Host-Native Prompt Pack',
    '',
    '## 当前模式',
    '',
    `- 运行模式: ${pack.runtime_mode}`,
    `- 推荐动作: ${pack.recommendation}`,
    `- 判断摘要: ${pack.summary || '未提供'}`,
    '',
    '## 任务摘要',
    '',
    `- 内容主题: ${taskSummary.content_brief}`,
    `- 输出模式: ${taskSummary.output_mode}`,
    `- 提示词数量: ${promptCount}`,
    `- 每批张数: ${taskSummary.batch_size || promptCount}`,
    `- 预览数量: ${taskSummary.preview_count || '未指定'}`,
    `- 尺寸: ${taskSummary.width || '?'} x ${taskSummary.height || '?'}`,
    `- 文字策略: ${taskSummary.text_policy}`,
    '',
    '## 模板与风格',
    '',
    `- 主模板: ${template?.id || '未指定'}${template?.name ? ` / ${template.name}` : ''}`,
    `- 模板文档: ${template?.template_doc || '未提供'}`,
    `- 主风格族: ${topLabel(styleSummary.style_family)}`,
    `- 主场景: ${topLabel(styleSummary.scene)}`,
    `- 主服装: ${topLabel(styleSummary.wardrobe)}`,
    `- 主构图: ${topLabel(styleSummary.composition)}`,
    '',
    '## 批次摘要',
    '',
    ...batchSummary.map((item) => `- 第 ${item.batch_number} 批: ${item.prompt_count} 条 (${item.first_index} -> ${item.last_index})`),
    '',
    '## 关键文件',
    '',
    `- prompts.generated.json: ${promptsFile}`,
    `- task_spec: ${taskSpecFile}`,
    `- prompt_strategy: ${strategyFile}`,
    `- runtime_mode: ${runtimeModeFile}`,
    `- prompt pack JSON: ${jsonPath}`,
    '',
    '## 下一步',
    '',
    ...pack.next_actions.map((item) => `- ${item}`),
  ];
  writeMarkdown(markdownPath, markdownLines);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Host-Native Summary</title>
  <style>
    :root {
      --bg: #0d141b;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.12);
      --text-main: #f4efe7;
      --text-sub: rgba(244,239,231,0.72);
      --accent: #d8b46f;
      --good: #78c59b;
      --info: #8fb8ff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(216,180,111,0.18), transparent 24%),
        linear-gradient(135deg, #0a1016 0%, #0f1720 46%, #0d141b 100%);
      color: var(--text-main);
      font-family: "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }
    .shell {
      max-width: 1280px;
      margin: 0 auto;
      padding: 28px 24px 48px;
    }
    .hero, .panel {
      border: 1px solid var(--panel-border);
      border-radius: 24px;
      background: var(--panel);
      backdrop-filter: blur(12px);
      box-shadow: 0 18px 48px rgba(0,0,0,0.26);
    }
    .hero { padding: 28px; margin-bottom: 18px; }
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
    h1 { margin: 0 0 10px; font-size: 34px; line-height: 1.1; }
    .copy { color: var(--text-sub); line-height: 1.7; max-width: 72ch; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 18px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-top: 18px;
    }
    .metric, .panel { padding: 18px; }
    .metric-label { color: var(--text-sub); font-size: 13px; }
    .metric-value { margin-top: 8px; font-size: 24px; font-weight: 700; }
    .metric-good .metric-value { color: var(--good); }
    .metric-info .metric-value { color: var(--info); }
    .panel-title { margin: 0 0 12px; font-size: 18px; }
    ul { margin: 0; padding-left: 18px; line-height: 1.7; }
    .files a { color: var(--text-main); }
    @media (max-width: 900px) {
      .grid, .metrics { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="eyebrow">DAOGE / HOST NATIVE</div>
      <h1>DAOGE Host-Native Summary</h1>
      <p class="copy">${escapeHtml(pack.summary || '当前路径适合把 DAOGE 的结构化 prompt 结果交给宿主原生图像工具。')}</p>
      <div class="metrics">
        <div class="metric metric-good">
          <div class="metric-label">运行模式</div>
          <div class="metric-value">${escapeHtml(pack.runtime_mode)}</div>
        </div>
        <div class="metric metric-info">
          <div class="metric-label">提示词数量</div>
          <div class="metric-value">${escapeHtml(String(promptCount))}</div>
        </div>
        <div class="metric">
          <div class="metric-label">主模板</div>
          <div class="metric-value">${escapeHtml(template?.id || '未指定')}</div>
        </div>
        <div class="metric">
          <div class="metric-label">推荐动作</div>
          <div class="metric-value">${escapeHtml(pack.recommendation)}</div>
        </div>
      </div>
    </section>
    <div class="grid">
      <section class="panel">
        <h2 class="panel-title">任务摘要</h2>
        <ul>
          <li>内容主题: ${escapeHtml(taskSummary.content_brief)}</li>
          <li>输出模式: ${escapeHtml(taskSummary.output_mode)}</li>
          <li>每批张数: ${escapeHtml(String(taskSummary.batch_size || promptCount))}</li>
          <li>预览数量: ${escapeHtml(String(taskSummary.preview_count || '未指定'))}</li>
          <li>尺寸: ${escapeHtml(`${taskSummary.width || '?'} x ${taskSummary.height || '?'}`)}</li>
          <li>文字策略: ${escapeHtml(taskSummary.text_policy)}</li>
        </ul>
      </section>
      <section class="panel">
        <h2 class="panel-title">模板与风格</h2>
        <ul>
          <li>主模板: ${escapeHtml(template?.id || '未指定')}${template?.name ? ` / ${escapeHtml(template.name)}` : ''}</li>
          <li>模板文档: ${escapeHtml(template?.template_doc || '未提供')}</li>
          <li>主风格族: ${escapeHtml(topLabel(styleSummary.style_family))}</li>
          <li>主场景: ${escapeHtml(topLabel(styleSummary.scene))}</li>
          <li>主服装: ${escapeHtml(topLabel(styleSummary.wardrobe))}</li>
          <li>主构图: ${escapeHtml(topLabel(styleSummary.composition))}</li>
        </ul>
      </section>
      <section class="panel">
        <h2 class="panel-title">批次摘要</h2>
        <ul>
          ${batchSummary.map((item) => `<li>第 ${escapeHtml(String(item.batch_number))} 批: ${escapeHtml(String(item.prompt_count))} 条 (${escapeHtml(String(item.first_index))} -> ${escapeHtml(String(item.last_index))})</li>`).join('')}
        </ul>
      </section>
      <section class="panel files">
        <h2 class="panel-title">关键文件与下一步</h2>
        <ul>
          <li><a href="${escapeHtml(relativeLink(outputDir, promptsFile) || '')}">prompts.generated.json</a></li>
          <li><a href="${escapeHtml(relativeLink(outputDir, taskSpecFile) || '')}">task_spec</a></li>
          <li><a href="${escapeHtml(relativeLink(outputDir, strategyFile) || '')}">prompt_strategy</a></li>
          <li><a href="${escapeHtml(relativeLink(outputDir, runtimeModeFile) || '')}">runtime_mode</a></li>
          <li><a href="${escapeHtml(relativeLink(outputDir, jsonPath) || '')}">host_native_prompt_pack.json</a></li>
        </ul>
        <ul style="margin-top: 14px;">
          ${pack.next_actions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </section>
    </div>
  </div>
</body>
</html>
`;
  fs.writeFileSync(htmlPath, html);

  const result = {
    ok: true,
    runtime_mode: pack.runtime_mode,
    prompt_count: promptCount,
    output_dir: outputDir,
    outputs: {
      json: jsonPath,
      markdown: markdownPath,
      html: htmlPath,
    },
  };
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
