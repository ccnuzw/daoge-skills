const path = require('path');
const {
  ISSUE_TYPES,
  parseArgs,
  readJsonIfExists,
  writeJson,
  toArray,
  normalizeText,
  ensureV2Layout,
} = require('./workspace_v2_shared');

function issueFromResult(result, type, index) {
  const base = {
    id: `issue_${String(index).padStart(3, '0')}`,
    type,
    status: 'open',
    relatedAssetIds: [result.id].filter(Boolean),
  };
  if (type === 'hard_failure') {
    return {
      ...base,
      severity: 'blocking',
      title: '这一张没有生成成功',
      impact: '会影响本轮完整性',
      recommendedAction: result.worthRerun ? '先确认失败原因，再决定是否补跑' : '先确认是否必须保留这一张',
      blocking: true,
      worthRerun: Boolean(result.worthRerun),
      userNextStep: result.worthRerun ? '进入问题页确认补跑范围' : '进入问题页确认是否接受缺口',
    };
  }
  if (type === 'needs_review') {
    return {
      ...base,
      severity: 'attention',
      title: '这一张需要人工看一眼',
      impact: '可能能用，但需要确认主体和画面是否稳定',
      recommendedAction: '回结果页复核',
      blocking: false,
      worthRerun: false,
      userNextStep: '回结果页筛选',
    };
  }
  return {
    ...base,
    type: 'rerun_candidate',
    severity: 'attention',
    title: '这一张值得补跑',
    impact: result.rerunReason || '补跑后本轮结果会更完整',
    recommendedAction: '只补这一张',
    blocking: false,
    worthRerun: true,
    userNextStep: '确认后只补这一张',
  };
}

function inferWorthRerun(result, executionManifest) {
  if (result.worthRerun) return result.rerunReason || '关键结果失败';
  const total = Number(executionManifest.counts?.total || 0);
  const success = Number(executionManifest.counts?.success || 0);
  if (result.rerunReason) return result.rerunReason;
  if (result.userLabel || result.shotLabel) return '关键镜头失败';
  if (total > 0 && success === 0) return '可交付不足';
  if (total > 0 && success < Math.max(1, Math.ceil(total * 0.5))) return '用户要求数量不足';
  return '';
}

function buildIssueQueue(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const executionManifest = readJsonIfExists(options.executionManifestFile || path.join(outputDir, 'internal', 'execution_manifest.json')) || {};
  const results = toArray(executionManifest.results);
  const items = [];
  let counter = 1;

  results.filter((item) => item.status === 'failed').forEach((item) => {
    const rerunReason = inferWorthRerun(item, executionManifest);
    const enriched = {
      ...item,
      worthRerun: Boolean(rerunReason),
      rerunReason,
    };
    items.push(issueFromResult(enriched, 'hard_failure', counter));
    counter += 1;
    if (rerunReason) {
      items.push(issueFromResult(enriched, 'rerun_candidate', counter));
      counter += 1;
    }
  });

  results.filter((item) => item.status === 'needs_review').forEach((item) => {
    items.push(issueFromResult(item, 'needs_review', counter));
    counter += 1;
  });

  toArray(options.extraItems).forEach((item) => {
    const type = ISSUE_TYPES.includes(item.type) ? item.type : 'needs_review';
    items.push({
      id: normalizeText(item.id, `issue_${String(counter).padStart(3, '0')}`),
      type,
      severity: normalizeText(item.severity, type === 'hard_failure' ? 'blocking' : 'attention'),
      title: normalizeText(item.title, '需要确认的问题'),
      impact: normalizeText(item.impact, '可能影响本轮判断'),
      recommendedAction: normalizeText(item.recommendedAction, '建议确认'),
      status: normalizeText(item.status, 'open'),
      relatedAssetIds: toArray(item.relatedAssetIds),
      blocking: Boolean(item.blocking ?? type === 'hard_failure'),
      worthRerun: Boolean(item.worthRerun ?? type === 'rerun_candidate'),
      userNextStep: normalizeText(item.userNextStep, type === 'hard_failure' ? '进入问题页处理' : '回结果页确认'),
    });
    counter += 1;
  });

  const issueQueue = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    supportedTypes: ISSUE_TYPES,
    summary: {
      blocking: items.filter((item) => item.blocking && item.status === 'open').length,
      attention: items.filter((item) => !item.blocking && item.status === 'open' && item.type !== 'rerun_candidate').length,
      rerunCandidates: items.filter((item) => item.type === 'rerun_candidate' && item.status === 'open').length,
      ignored: items.filter((item) => item.status === 'ignored' || item.type === 'ignored').length,
      resolved: items.filter((item) => item.status === 'resolved' || item.type === 'resolved').length,
    },
    groups: [
      { id: 'must_handle', title: '必须处理', itemIds: items.filter((item) => item.blocking && item.status === 'open').map((item) => item.id) },
      { id: 'needs_confirmation', title: '建议确认', itemIds: items.filter((item) => item.severity === 'attention' && item.type !== 'rerun_candidate' && item.status === 'open').map((item) => item.id) },
      { id: 'worth_rerun', title: '值得补跑', itemIds: items.filter((item) => item.type === 'rerun_candidate' && item.status === 'open').map((item) => item.id) },
      { id: 'can_ignore', title: '可以忽略', itemIds: items.filter((item) => item.status === 'ignored' || item.type === 'ignored').map((item) => item.id) },
      { id: 'resolved', title: '已处理', itemIds: items.filter((item) => item.status === 'resolved' || item.type === 'resolved').map((item) => item.id) },
    ],
    items,
  };

  const outputFile = options.outputFile || path.join(outputDir, 'internal', 'issue_queue.json');
  writeJson(outputFile, issueQueue);
  return issueQueue;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args['output-dir'] || process.cwd();
  const issueQueue = buildIssueQueue({
    outputDir,
    outputFile: args['output-file'],
    executionManifestFile: args['execution-manifest'],
  });
  console.log(JSON.stringify({ ok: true, outputDir: path.resolve(outputDir), issues: issueQueue.items.length }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { buildIssueQueue, issueFromResult };
