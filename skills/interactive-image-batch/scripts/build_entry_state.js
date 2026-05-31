const path = require('path');
const { parseArgs, readJson, writeJson } = require('./script_utils');
const {
  buildEntryDefaultGenerationProtocol,
  buildTaskCenterEntryProtocol,
} = require('./entry_state_shared');

function loadCatalog(catalogFile) {
  const parsed = readJson(catalogFile);
  return Array.isArray(parsed.examples) ? parsed.examples : [];
}

function normalizeText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function inferTaskCategory(example = {}) {
  const category = normalizeText(example.category);
  if (category === 'portraits-and-characters' || category === 'grids-and-collages') return '人物与时尚视觉';
  if (['product-visuals', 'social-campaigns', 'performance-creatives', 'poster-and-campaigns', 'branding-and-packaging'].includes(category)) return '电商与商业视觉';
  if (['infographics', 'technical-diagrams', 'academic-figures', 'slides-and-visual-docs', 'typography-and-text-layout', 'maps'].includes(category)) return '信息与说明型视觉';
  if (['avatars-and-profile', 'editing-workflows', 'assets-and-props'].includes(category)) return '资产与编辑';
  if (['cinematic-sequences', 'scenes-and-illustrations'].includes(category)) return '分镜与叙事';
  if (category === 'ui-mockups') return '界面与产品样机';
  return '未分类任务';
}

function buildRecommendedNextStep(example, outputDir) {
  return {
    label: '进入准备工作台',
    target: path.join(outputDir, 'prepare_workspace.html'),
    reason: normalizeText(example?.starter_reason || example?.description, '先生成准备工作台，再判断是否进入正式执行。'),
  };
}

function buildEntryMainlineProtocol(options = {}) {
  const sequence = ['中文模板展示板', '任务总控', '工作台首页', '准备工作台', '结果工作台', '异常工作台'];
  return {
    version: 1,
    currentLayer: '入口层',
    sequence,
    sequenceLabel: sequence.join(' -> '),
    entryRole: '模板展示板只负责选择任务类型和起步入口。',
    taskCenterRole: '任务总控只负责开新任务、继续当前任务和切换任务。',
    workspaceRole: '工作台首页接住单轮任务判断，再顺着准备、结果、异常继续。',
    handoffRule: '入口层一旦选定任务，就把方向交给准备工作台；任务总控只做任务级切换，不展开单轮内部判断。',
    taskCenterEntryProtocol: buildTaskCenterEntryProtocol({
      source: options.taskCenterUnifiedState,
    }),
    defaultGenerationProtocol: buildEntryDefaultGenerationProtocol({
      mode: options.optionalPageMode,
    }),
    summary: '先在中文模板展示板选任务，再到任务总控决定开新任务或继续任务，进入工作台首页后就沿四站主链推进。',
  };
}

function buildEntryContext(example, entryMode, outputDir) {
  const taskCategory = inferTaskCategory(example);
  const starterIntent = normalizeText(example?.starter_intent, '尚未选择');
  const selectedName = normalizeText(example?.name, '当前还没有选中的入口');
  const description = normalizeText(example?.description, '先按任务意图开始，或者从推荐起步里挑一个最像你需求的入口。');
  const mainlineProtocol = buildEntryMainlineProtocol({
    taskCenterUnifiedState: outputDir ? path.join(path.dirname(outputDir), 'task_center_live_state.json') : null,
  });
  return {
    runLabel: selectedName,
    phaseLabel: '入口层',
    flowLabel: mainlineProtocol.sequenceLabel,
    counts: [
      { label: '进入方式', value: entryMode === 'intent' ? '按任务意图进入' : '按示例入口进入' },
      { label: '当前任务组', value: taskCategory },
      { label: '当前意图', value: starterIntent },
    ],
    hints: [
      description,
      mainlineProtocol.handoffRule,
      normalizeText(example?.starter_reason, '先进入准备工作台确认方向、放行和素材绑定。'),
    ],
  };
}

function buildEntryWorkbench(example, outputDir) {
  const selectedName = normalizeText(example?.name, '当前还没有选中的入口');
  const description = normalizeText(example?.description, '先按任务意图开始，或者从推荐起步里挑一个最像你需求的入口。');
  const starterIntent = normalizeText(example?.starter_intent, null);

  return {
    stageLabel: '入口层',
    stageTitle: '入口层主控',
    stageSummary: '入口层只保留选任务、看入口和进入准备层这几件高频动作。',
    currentIntentLabel: starterIntent || '尚未选择',
    selectedEntry: {
      title: selectedName,
      summary: description,
    },
    route: {
      title: '从入口层继续',
      copy: '入口层只负责选任务和选起步入口，确认后就直接进入准备工作台。',
      current: {
        kicker: '当前入口',
        label: selectedName,
        summary: description,
      },
      next: buildRecommendedNextStep(example, outputDir),
    },
    workbench: {
      title: '入口层主控',
      copy: '入口层只保留选任务、看入口和进入准备层这几件高频动作。',
      cards: [
        {
          label: '当前入口',
          value: selectedName,
          summary: description,
          tone: 'good',
          hideLinkIfMissing: true,
        },
        {
          label: '当前任务组',
          value: inferTaskCategory(example),
          summary: '这一组会决定你优先看哪类入口。',
          tone: 'info',
          hideLinkIfMissing: true,
        },
        {
          label: '推荐下一步',
          value: '进入准备工作台',
          summary: normalizeText(example?.starter_reason || example?.description, '先确认方向、放行和素材绑定，再决定是否继续。'),
          file: path.join(outputDir, 'prepare_workspace.html'),
          cta: '进入下一步',
          pendingLabel: '下一步页面尚未生成',
          tone: 'good',
        },
      ],
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['catalog-file']) throw new Error('Missing required flag: --catalog-file');
  if (!args['selected-id']) throw new Error('Missing required flag: --selected-id');

  const catalogFile = path.resolve(args['catalog-file']);
  const selectedId = normalizeText(args['selected-id']);
  const outputDir = path.resolve(args['output-dir'] || process.cwd());
  const outputFile = path.resolve(args['output-file'] || path.join(outputDir, 'entry_state.json'));
  const entryMode = normalizeText(args['entry-mode'], 'example');
  const runtimeMode = normalizeText(args['runtime-mode'], 'local-batch-runner');
  const optionalPageMode = normalizeText(args['optional-page-mode'], 'mainline-only');
  const taskCenterUnifiedState = path.join(path.dirname(outputDir), 'task_center_live_state.json');

  const examples = loadCatalog(catalogFile);
  const selectedExample = examples.find((item) => normalizeText(item.id) === selectedId);
  if (!selectedExample) {
    throw new Error(`Selected example not found in catalog: ${selectedId}`);
  }

  const payload = {
    version: 1,
    entryMode,
    taskCategory: inferTaskCategory(selectedExample),
    starterIntent: normalizeText(selectedExample.starter_intent, null),
    templateId: normalizeText(selectedExample.template_id, null),
    templateVariant: normalizeText(selectedExample.template_variant, null),
    runtimeMode,
    selectedExample: {
      id: normalizeText(selectedExample.id),
      name: normalizeText(selectedExample.name),
      category: normalizeText(selectedExample.category),
      description: normalizeText(selectedExample.description),
      exampleFile: normalizeText(selectedExample.example_file),
    },
    entryContext: buildEntryContext(selectedExample, entryMode, outputDir),
    entryMainlineProtocol: buildEntryMainlineProtocol({ taskCenterUnifiedState, optionalPageMode }),
    recommendedNextStep: buildRecommendedNextStep(selectedExample, outputDir),
    entryWorkbench: buildEntryWorkbench(selectedExample, outputDir),
    updatedAt: new Date().toISOString(),
  };

  writeJson(outputFile, payload);
  console.log(JSON.stringify({ outputFile, selectedId, entryMode }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
