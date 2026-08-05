const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  skillRoot,
  makeTempDir,
  runScript,
  writeJson,
  assertWorkspacePagesExist,
} = require('../helpers/workspace_v2_test_utils');

test('prepare flow generates v2 workspace, assets and internal contracts', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.minimal.json'),
    '--strategy-file', path.join(skillRoot, 'tests', 'fixtures', 'prompt_strategy.minimal.json'),
    '--prompts-file', path.join(skillRoot, 'tests', 'fixtures', 'prompts.minimal.json'),
    '--output-dir', outputDir,
    '--batch-size', '1',
  ]);
  assertWorkspacePagesExist(assert, outputDir);
  ['run_plan.json', 'execution_manifest.json', 'issue_queue.json', 'asset_library.json', 'workspace_state.json'].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, 'internal', name)), true, `missing ${name}`);
  });
  assert.equal(fs.existsSync(path.join(outputDir, 'workspace_home.html')), false);
  assert.match(fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8'), /workspace\/index\.html/);
});

test('prepare flow can generate prompts from task spec without prompts file', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  assertWorkspacePagesExist(assert, outputDir);
  const prompts = JSON.parse(fs.readFileSync(path.join(outputDir, 'debug', 'prompts.generated.json'), 'utf8'));
  assert.equal(prompts.length, 2);
  assert.equal(typeof prompts[0].generation_prompt, 'string');
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'internal', 'prepare_manifest.json'), 'utf8'));
  assert.equal(manifest.promptSourceMode, 'generated-from-task-spec');
});

test('prepare flow recognizes 20 natural Chinese briefs without portrait fallback drift', () => {
  const cases = [
    ['product-hero', '为一款无糖气泡水做电商商品主图，突出青柠口味、透明瓶身、水珠和白底平台安全区', 'ecommerce', 1024, 1024],
    ['ecommerce-detail', '生成智能行李箱详情页五张图：卖点拆解、材质细节、轮子静音、容量对比、旅行场景', 'ecommerce', 1024, 1536],
    ['packaging-gift', '端午茶叶礼盒包装概念图，东方现代品牌风格，展示外盒、内盒、茶罐套组关系', 'packaging', 1536, 1024],
    ['brand-visual', '新中式香氛品牌视觉板，包含瓶身、纸袋、标签和品牌氛围，不要人物', 'packaging', 1536, 1024],
    ['campaign-poster', '咖啡新品上市 campaign 海报，主视觉是冷萃瓶和冰块，预留标题区和 CTA 区', 'campaign-poster', 1024, 1536],
    ['social-grid', '小红书九宫格社媒视觉，主题是夏日露营咖啡，统一品牌色但每格内容不同', 'social-grid', 1024, 1024],
    ['avatar-profile', '做一组科技播客主持人头像 profile，圆形裁切友好，深色背景，有轻微未来感', 'avatar-profile-pack', 1024, 1024],
    ['portrait-studio', '女性创业者棚拍人像，半身，自信克制，灰色背景，适合官网创始人介绍', 'studio', 1024, 1536],
    ['storyboard', '为 30 秒户外手表广告生成四格 storyboard：清晨出发、越野跑、雨中耐用、日落特写', 'cinematic', 1536, 1024],
    ['oral-storyboard', '财经口播分镜板，主持人在演播厅解释新能源车补贴政策，横版整板，含三段画面节奏', 'oralboard', 1536, 1024],
    ['technical-flow', '画一个支付系统技术流程图，包含用户、网关、风控、支付通道、清结算节点和箭头方向', 'technical-diagram', 1536, 1024],
    ['infographic', '做一张信息图，对比三种咖啡萃取方式的时间、研磨度、口感和适用人群', 'infographic-board', 1024, 1536],
    ['map-route', '杭州三日旅行路线地图，标出西湖、灵隐寺、运河、咖啡店和每日路线颜色', 'map-route-board', 1536, 1024],
    ['ui-mockup', '生成健身 App dashboard UI mockup，包含训练进度、热量、课程卡片和底部导航', 'ui-mockup-board', 1024, 1536],
    ['academic-figure', '论文 graphical abstract，主题是可降解水凝胶促进伤口愈合机制，包含材料、细胞、愈合阶段', 'academic-figure-board', 1536, 1024],
    ['type-poster', '双语字体排版海报，主题是城市夜跑，强调大标题区、英文副标题和节奏感', 'type-layout-poster', 1024, 1536],
    ['image-edit-local', '对参考图做局部修改：保留人物和姿势，只把背景改成清晨海边，光线匹配原图', 'image-edit', 1024, 1024],
    ['style-transfer', '把参考图风格迁移成 90 年代胶片杂志质感，保留商品轮廓和构图', 'image-edit', 1024, 1024],
    ['banner-horizontal', '横图 banner，户外运动鞋新品首发，左侧产品特写，右侧留大标题和购买按钮区域', 'campaign-poster', 1536, 1024],
    ['short-video-cover', '竖版短视频封面，主题是 10 分钟早餐食谱，顶部标题安全区，中间食物主视觉', 'campaign-poster', 1024, 1536],
  ];
  const tempDir = makeTempDir('daoge-brief-matrix-');

  cases.forEach(([id, brief, expectedTaskId, width, height]) => {
    const outputDir = path.join(tempDir, id);
    const taskSpecFile = path.join(tempDir, `${id}.json`);
    writeJson(taskSpecFile, {
      content_brief: brief,
      total_count: 2,
      batch_size: 2,
      width,
      height,
    });
    runScript('daoge.js', ['prepare',
      '--task-spec', taskSpecFile,
      '--output-dir', outputDir,
    ]);
    assertWorkspacePagesExist(assert, outputDir);
    const runPlan = JSON.parse(fs.readFileSync(path.join(outputDir, 'internal', 'run_plan.json'), 'utf8'));
    const prompts = JSON.parse(fs.readFileSync(path.join(outputDir, 'debug', 'prompts.generated.json'), 'utf8'));
    assert.equal(runPlan.task.id, expectedTaskId, id);
    assert.equal(runPlan.task.title, brief, id);
    assert.equal(prompts.length, 2, id);
    assert.match(prompts[0].generation_prompt, new RegExp(brief.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), id);
  });
});
