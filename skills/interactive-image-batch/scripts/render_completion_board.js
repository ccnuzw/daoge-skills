const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const {
  renderWorkspaceChromeTopLinks,
  renderWorkspaceChromeContextBar,
  renderWorkspaceChromeModeSwitch,
  renderWorkspaceChromeProgressRail,
  renderWorkspaceChromeRouteCompass,
  renderWorkspaceChromeWorkbench,
} = require('./workspace_chrome');
const { renderWorkspaceChromeHeadAssets } = require('./workspace_chrome_ui');
const {
  relativeFile,
  renderMetricCard,
  renderEntryCard,
  renderList,
  renderWorkspaceStyles,
} = require('./workspace_page_shared');

function topFailed(results, limit = 8) {
  return results.filter((item) => !item.ok).slice(0, limit);
}

function topSuccessful(results, limit = 8) {
  return results.filter((item) => item.ok && !item.skipped).slice(0, limit);
}

function uniqueSlotIds(items) {
  return Array.from(new Set((items || [])
    .map((item) => String(item.slotId || item.slot_id || '').trim())
    .filter(Boolean)));
}

function isLocalEditResult(item) {
  const requestMode = String(item.requestMode || item.request_mode || '').trim();
  const editSource = String(item.editSource || item.edit_source || '').trim();
  return requestMode === 'masked-edit' || editSource === 'previous-output';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'completion_board.html'));

  const batchManifests = Array.isArray(manifest.batches) ? manifest.batches : [];
  const allResults = batchManifests.flatMap((batch) => batch.results || []);
  const failed = topFailed(allResults);
  const successful = topSuccessful(allResults);
  const skipped = allResults.filter((item) => item.skipped);
  const executed = allResults.filter((item) => !item.skipped);
  const attemptedLocalEdits = executed.filter(isLocalEditResult);
  const successfulLocalEdits = successful.filter(isLocalEditResult);
  const generatedSlotIds = uniqueSlotIds(executed);
  const attemptedLocalEditSlotIds = uniqueSlotIds(attemptedLocalEdits);
  const successfulLocalEditSlotIds = uniqueSlotIds(successfulLocalEdits);

  const resultWorkspacePath = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspacePath = path.join(outputDir, 'exception_workspace.html');
  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const storyboardBoardPath = path.join(outputDir, 'storyboard_board.html');

  const nextActionHints = [
    Number(manifest.failed || 0) > 0 ? '这轮存在失败项，通常应先进入异常工作台。' : null,
    successfulLocalEditSlotIds.length ? `当前有 ${successfulLocalEditSlotIds.length} 个局部编辑成功槽位，建议回审阅板或整板再看一次边界与衔接感。` : null,
    Number(manifest.failed || 0) === 0 && !successfulLocalEditSlotIds.length ? '这轮整体比较稳定，可以直接从审阅板继续筛图。' : null,
  ].filter(Boolean);

  const completionContextBar = renderWorkspaceChromeContextBar({
    runLabel: path.basename(outputDir),
    phaseLabel: '结果补充细页',
    flowLabel: '结果工作台 -> 审阅 / 整板 -> 完成摘要',
    counts: [
      { label: '成功', value: Number(manifest.success || 0) },
      { label: '失败', value: Number(manifest.failed || 0) },
      { label: '跳过', value: skipped.length },
      { label: '槽位', value: generatedSlotIds.length },
    ],
    hints: [
      '完成摘要页继续保留，但已经退到结果细分页层。',
      Number(manifest.failed || 0) > 0 ? '如果这轮还有失败项，优先回异常工作台。' : '如果只是想继续推进结果判断，优先回结果工作台。',
    ],
  });

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE 完成摘要补充页</title>
${renderWorkspaceChromeHeadAssets()}
  <style>
    :root {
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --page-glow: rgba(217,179,109,0.18);
      --hero-tint: rgba(217,179,109,0.15);
    }
${renderWorkspaceStyles()}
  </style>
</head>
<body data-workspace-chrome-page="completion_board.html">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderWorkspaceChromeTopLinks(outputDir, {
          currentPage: 'completion_board.html',
          extraLinks: [
            { label: '回结果工作台', file: resultWorkspacePath },
            { label: '回异常工作台', file: exceptionWorkspacePath },
          ],
        })}
      </div>
      <div class="eyebrow">完成摘要补充页</div>
      <h1>DAOGE 完成摘要补充页</h1>
      <p class="hero-copy">这页现在是结果补充页，用来补充看本轮摘要、成功失败与覆盖范围。它还保留，但不再作为结果层主控入口。普通流程请先回结果工作台。</p>
      ${completionContextBar}
      ${renderWorkspaceChromeModeSwitch({
        title: '完成页定位',
        copy: '摘要信息继续保留，但默认入口已经迁移到结果工作台。',
        newcomerLabel: '回结果工作台',
        proLabel: '查看摘要详情',
      })}
      <div class="hero-grid">
        ${renderMetricCard('当前定位', '结果补充页', 'warn', '不再承担默认结果主控')}
        ${renderMetricCard('推荐入口', fileExists(resultWorkspacePath) ? '结果工作台' : '审阅看板', 'good', '普通流程先回主链')}
        ${renderMetricCard('成功张数', Number(manifest.success || 0), 'good', `${generatedSlotIds.length} 个槽位参与生成`)}
        ${renderMetricCard('失败张数', Number(manifest.failed || 0), Number(manifest.failed || 0) > 0 ? 'bad' : 'neutral', Number(manifest.failed || 0) > 0 ? '建议先看异常工作台' : '当前无明显失败压力')}
      </div>
    </section>

    ${renderWorkspaceChromeProgressRail(outputDir, {
      currentPage: 'completion_board.html',
      title: '结果主链',
      copy: '完成摘要页已经降到结果补充页层，真正的主链判断请回结果工作台和异常工作台。',
    })}

    ${renderWorkspaceChromeRouteCompass(outputDir, {
      title: '看完摘要后，建议这样走',
      copy: '先回结果工作台做主链判断，异常再交给异常工作台；其它结果补充页不再从这里堆入口。',
      previous: {
        label: '回结果工作台',
        summary: '这是新的结果阶段主入口。',
        file: resultWorkspacePath,
        cta: '回结果工作台',
      },
      nextSteps: [
        Number(manifest.failed || 0) > 0 ? {
          kicker: '如果存在异常',
          label: '异常工作台',
          summary: '统一处理失败项和待复核项。',
          file: exceptionWorkspacePath,
          cta: '进入异常工作台',
        } : null,
      ],
    })}

    ${renderWorkspaceChromeWorkbench(outputDir, {
      title: '完成摘要入口',
      copy: '只保留和主链收口直接相关的入口，Markdown 归档和其它高级页继续后退。',
      cards: [
        { label: '回结果工作台', value: fileExists(resultWorkspacePath) ? '推荐入口' : '待生成', summary: '新的结果阶段主页面。', file: resultWorkspacePath, cta: '回结果工作台', tone: 'good' },
        { label: '异常工作台', value: fileExists(exceptionWorkspacePath) ? '按需进入' : '待生成', summary: '只有失败或待复核时需要。', file: exceptionWorkspacePath, cta: '进入异常工作台', tone: Number(manifest.failed || 0) > 0 ? 'warn' : 'neutral' },
      ],
      maxCards: 4,
    })}

    <section class="section">
      <h2>完成概览</h2>
      <p class="section-copy">这里保留本轮摘要，但不再反客为主地承担流程导航。</p>
      <div class="entry-grid">
        ${renderEntryCard({ kicker: '下一步建议', title: nextActionHints[0] || '优先回结果工作台', copy: nextActionHints.slice(1).join(' ') || '如果没有特殊问题，就回结果工作台继续推进。', tone: Number(manifest.failed || 0) > 0 ? 'warn' : 'good' })}
        ${renderEntryCard({ kicker: '局部编辑覆盖', title: `${attemptedLocalEditSlotIds.length} 个尝试 / ${successfulLocalEditSlotIds.length} 个成功`, copy: attemptedLocalEditSlotIds.length ? '局部编辑结果建议再回审阅或整板看一次边界。' : '当前没有明显局部编辑压力。', tone: attemptedLocalEditSlotIds.length ? 'info' : 'neutral' })}
        ${renderEntryCard({ kicker: '样例覆盖', title: `${successful.length} 张成功样例`, copy: failed.length ? `${failed.length} 张失败样例仍需处理。` : '当前失败压力较低。', tone: failed.length ? 'warn' : 'good' })}
      </div>
    </section>

    <section class="section">
      <h2>结果样例</h2>
      <p class="section-copy">这里只保留少量高信号样例，帮助你确认本轮出了什么，不再把它做成新的主控页。</p>
      <div class="entry-grid">
        <article class="entry-card">
          <div class="entry-kicker">成功样例</div>
          ${renderList(successful.map((item) => `${item.index || '未记录'} / ${item.title || item.slug || '未命名结果'}`), '当前没有成功样例')}
        </article>
        <article class="entry-card">
          <div class="entry-kicker">失败样例</div>
          ${renderList(failed.map((item) => `${item.index || '未记录'} / ${item.title || item.slug || '未命名失败项'} / ${item.error || '未知错误'}`), '当前没有失败样例')}
        </article>
      </div>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
}

main();
