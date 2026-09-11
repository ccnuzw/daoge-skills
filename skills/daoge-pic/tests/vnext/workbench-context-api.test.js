const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { fetchStudio, requestJson, requestJsonAsWorkbench } = require('./local-studio-test-helper');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');





test('Workbench Session context is readable, validates hierarchy, and never selects an implicit run', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-workbench-context-'));
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const opened = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'context-session-open', body: { conversationId: 'workbench-test-context' } });
    assert.equal(opened.status, 200);
    const session = opened.body.data;
    const initial = await requestJson(started, '/api/sessions/' + session.id);
    assert.deepEqual(initial.body.data.session.activeProjectId, null);
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'context-project', body: { name: 'P0 项目' } });
    const task = await requestJson(started, '/api/tasks', { method: 'POST', idempotencyKey: 'context-task', body: { projectId: project.body.data.value.id, name: 'P0 任务' } });
    const round = await requestJson(started, '/api/rounds', { method: 'POST', idempotencyKey: 'context-round', body: { taskId: task.body.data.value.id, purpose: 'exploration' } });
    const updated = await requestJson(started, '/api/sessions/' + session.id + '/context', { method: 'POST', idempotencyKey: 'context-select-round', body: { projectId: project.body.data.value.id, taskId: task.body.data.value.id, roundId: round.body.data.value.id } });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.data, { ...session, activeProjectId: project.body.data.value.id, activeTaskId: task.body.data.value.id, activeRoundId: round.body.data.value.id, version: session.version + 1 });
    const restored = await requestJson(started, '/api/sessions/' + session.id);
    assert.equal(restored.body.data.session.activeRoundId, round.body.data.value.id);
    const roundRuns = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/runs');
    assert.deepEqual(roundRuns.body.data.runs, []);
    const overview = await requestJson(started, '/api/tasks/' + task.body.data.value.id + '/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.overview.task.name, 'P0 任务');
    assert.equal(overview.body.data.overview.summary.roundCount, 1);
    const creativeRecord = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/creative-record');
    assert.equal(creativeRecord.status, 200);
    assert.equal(creativeRecord.body.data.record.selectedRunId, null);
    assert.deepEqual(creativeRecord.body.data.record.items, []);
    const scopedAssets = await requestJson(started, '/api/assets?scope=round&projectId=' + project.body.data.value.id + '&taskId=' + task.body.data.value.id + '&roundId=' + round.body.data.value.id);
    assert.equal(scopedAssets.status, 200);
    assert.deepEqual(scopedAssets.body.data.assets, []);
    const invalid = await requestJson(started, '/api/assets?scope=round&projectId=wrong-project&taskId=' + task.body.data.value.id + '&roundId=' + round.body.data.value.id);
    assert.equal(invalid.status, 400);
    const missing = await requestJson(started, '/api/sessions/missing-session');
    assert.equal(missing.status, 404);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Workbench direct creation writes project, task, round, and tab session context through the shared API', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-workbench-direct-create-'));
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const opened = await requestJsonAsWorkbench(started, '/api/sessions/open', { key: 'direct-create-session', body: { conversationId: 'workbench-direct-create' } });
    assert.equal(opened.status, 200);
    const session = opened.body.data;
    const project = await requestJsonAsWorkbench(started, '/api/projects', { key: 'direct-create-project', body: { name: 'Studio 直建项目', description: '创作者在 Studio 里直接建立。', sessionId: session.id } });
    assert.equal(project.status, 200);
    const afterProject = await requestJsonAsWorkbench(started, '/api/sessions/' + session.id);
    assert.equal(afterProject.body.data.session.activeProjectId, project.body.data.value.id);
    assert.equal(afterProject.body.data.session.activeTaskId, null);

    const task = await requestJsonAsWorkbench(started, '/api/tasks', { key: 'direct-create-task', body: { projectId: project.body.data.value.id, name: 'Studio 直建任务', intent: { createdFrom: 'workbench', goalType: 'exploration', targetCount: 6 }, sessionId: session.id } });
    assert.equal(task.status, 200);
    const afterTask = await requestJsonAsWorkbench(started, '/api/sessions/' + session.id);
    assert.equal(afterTask.body.data.session.activeProjectId, project.body.data.value.id);
    assert.equal(afterTask.body.data.session.activeTaskId, task.body.data.value.id);
    assert.equal(afterTask.body.data.session.activeRoundId, null);

    const round = await requestJsonAsWorkbench(started, '/api/rounds', { key: 'direct-create-round', body: { taskId: task.body.data.value.id, purpose: 'exploration', plan: { createdFrom: 'workbench', draftKind: 'studio-round-context' }, sessionId: session.id } });
    assert.equal(round.status, 200);
    const planStatus = await requestJsonAsWorkbench(started, '/api/sessions/' + session.id + '/plan-status');
    assert.equal(planStatus.status, 200);
    assert.equal(planStatus.body.data.context.project.id, project.body.data.value.id);
    assert.equal(planStatus.body.data.context.task.id, task.body.data.value.id);
    assert.equal(planStatus.body.data.context.round.id, round.body.data.value.id);
    assert.equal(planStatus.body.data.context.round.status, 'draft');
    assert.deepEqual(planStatus.body.data.latestRun, null);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Workbench structured creation persists templates and validates selected kits', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-workbench-structured-create-'));
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const templates = await requestJsonAsWorkbench(started, '/api/project-templates', { key: 'structured-create-templates' });
    assert.equal(templates.status, 200);
    const ecommerceTemplate = templates.body.data.templates.find((template) => template.id === 'ecommerce-product');
    assert.equal(ecommerceTemplate.version, 1);
    assert.equal(ecommerceTemplate.defaultName, '电商商品图项目');
    assert.match(ecommerceTemplate.descriptionPrompt, /平台规格/);
    assert.deepEqual(ecommerceTemplate.aspectRatios, ['1:1', '4:5', '3:4']);
    assert.equal(ecommerceTemplate.exampleDescriptions.some((item) => item.includes('夏季茶饮新品')), true);
    assert.equal(ecommerceTemplate.taskDefaults[0].goalId, 'exploration');
    assert.equal(ecommerceTemplate.taskDefaults[0].label, '商品主图探索');
    assert.equal(ecommerceTemplate.taskDefaults[0].defaultCount, '8');
    assert.equal(ecommerceTemplate.taskDefaults[0].defaultAspectRatio, '1:1');
    assert.deepEqual(ecommerceTemplate.taskDefaults[0].materialNeeds, ['商品主体图', '品牌包 / Logo', '平台规格', '核心卖点']);
    assert.deepEqual(ecommerceTemplate.taskDefaults[1].defaultVariationAxes, ['背景', '光影', '商业感']);
    assert.deepEqual(ecommerceTemplate.taskDefaults[1].defaultKeepConstraints, ['产品', 'Logo', '主体']);
    const style = await requestJsonAsWorkbench(started, '/api/style-kits', { key: 'structured-create-style', body: { name: '清透商业摄影', definition: { summary: '明亮、克制、突出商品质感' } } });
    const brand = await requestJsonAsWorkbench(started, '/api/brand-kits', { key: 'structured-create-brand', body: { name: '夏季茶饮品牌', definition: { summary: '品牌色与 Logo 约束' } } });
    assert.equal(style.status, 200);
    assert.equal(brand.status, 200);
    const project = await requestJsonAsWorkbench(started, '/api/projects', { key: 'structured-create-project', body: { name: '夏季商品视觉', description: '电商主图和场景图', templateId: 'ecommerce-product', templateVersion: 1 } });
    assert.equal(project.status, 200);
    assert.equal(project.body.data.value.templateId, 'ecommerce-product');
    assert.equal(project.body.data.value.templateVersion, 1);
    const listed = await requestJsonAsWorkbench(started, '/api/projects', { key: 'structured-create-project-list' });
    assert.equal(listed.body.data.projects[0].templateId, 'ecommerce-product');
    const task = await requestJsonAsWorkbench(started, '/api/tasks', { key: 'structured-create-task', body: { projectId: project.body.data.value.id, name: '商品主图探索', taskTypeId: 'ecommerce-product', styleKitId: style.body.data.id, brandKitId: brand.body.data.id, intent: { createdFrom: 'workbench', goalType: 'exploration', targetCount: 6, aspectRatio: '1:1', styleKitId: style.body.data.id, brandKitId: brand.body.data.id, variationAxes: ['背景'], keepConstraints: ['产品', 'Logo'] } } });
    assert.equal(task.status, 200);
    assert.equal(task.body.data.value.intent.goalType, 'exploration');
    assert.equal(task.body.data.value.intent.styleKitId, style.body.data.id);
    assert.deepEqual(task.body.data.value.intent.keepConstraints, ['产品', 'Logo']);
    const invalidKit = await requestJsonAsWorkbench(started, '/api/tasks', { key: 'structured-create-invalid-kit', body: { projectId: project.body.data.value.id, name: '无效品牌任务', brandKitId: 'brand-kit-from-another-studio' } });
    assert.equal(invalidKit.status, 404);
    const invalidTemplate = await requestJsonAsWorkbench(started, '/api/projects', { key: 'structured-create-invalid-template', body: { name: '无效模板项目', templateId: 'unknown-template' } });
    assert.equal(invalidTemplate.status, 404);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Workbench draft context can persist reference materials without bypassing project boundaries', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-workbench-reference-context-'));
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const opened = await requestJsonAsWorkbench(started, '/api/sessions/open', { key: 'reference-context-session', body: { conversationId: 'workbench-reference-context' } });
    const session = opened.body.data;
    const project = await requestJsonAsWorkbench(started, '/api/projects', { key: 'reference-context-project', body: { name: '参考素材项目', sessionId: session.id } });
    const otherProject = await requestJsonAsWorkbench(started, '/api/projects', { key: 'reference-context-other-project', body: { name: '外部素材项目' } });
    const task = await requestJsonAsWorkbench(started, '/api/tasks', { key: 'reference-context-task', body: { projectId: project.body.data.value.id, name: '参考素材任务', sessionId: session.id } });
    const round = await requestJsonAsWorkbench(started, '/api/rounds', { key: 'reference-context-round', body: { taskId: task.body.data.value.id, purpose: 'edit', plan: { createdFrom: 'workbench' }, sessionId: session.id } });
    const currentUpload = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'reference-context-current-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': project.body.data.value.id, 'x-daoge-material-need': encodeURIComponent('商品主体图'), 'x-daoge-material-usage': 'subject' }, body: png });
    const foreignUpload = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'reference-context-foreign-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': otherProject.body.data.value.id }, body: Buffer.concat([png, Buffer.from('foreign')]) });
    assert.equal(currentUpload.status, 200);
    assert.equal(foreignUpload.status, 200);
    const currentAsset = (await currentUpload.json()).data;
    const foreignAsset = (await foreignUpload.json()).data;
    assert.equal(currentAsset.source.materialNeed, '商品主体图');
    assert.equal(currentAsset.source.materialUsage, 'subject');
    const rejected = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/draft-context', { method: 'PUT', key: 'reference-context-rejected', body: { expectedVersion: round.body.data.value.version, plan: { referenceMaterials: [{ assetId: foreignAsset.id, usage: 'style' }] } } });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error.message, /当前项目或已明确共享/);
    const shared = await requestJsonAsWorkbench(started, '/api/assets/' + foreignAsset.id + '/shared', { key: 'reference-context-share', body: { shared: true } });
    assert.equal(shared.status, 200);
    const updated = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/draft-context', { method: 'PUT', key: 'reference-context-accepted', body: { expectedVersion: round.body.data.value.version, plan: { referenceMaterials: [{ assetId: currentAsset.id, usage: 'subject', note: '主体保持' }, { assetId: foreignAsset.id, usage: 'style' }], referenceAssetIds: [currentAsset.id, foreignAsset.id], maskAssetId: currentAsset.id } } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.value.version, round.body.data.value.version + 1);
    assert.deepEqual(updated.body.data.value.plan.referenceMaterials.map((item) => item.usage), ['subject', 'style']);
    const lookup = await requestJsonAsWorkbench(started, '/api/assets/by-id?projectId=' + project.body.data.value.id + '&assetId=' + currentAsset.id + '&assetId=' + foreignAsset.id);
    assert.equal(lookup.status, 200);
    assert.deepEqual(lookup.body.data.assets.map((asset) => asset.id), [currentAsset.id, foreignAsset.id]);
    const planStatus = await requestJsonAsWorkbench(started, '/api/sessions/' + session.id + '/plan-status');
    assert.deepEqual(planStatus.body.data.context.round.plan.referenceMaterials.map((item) => item.assetId), [currentAsset.id, foreignAsset.id]);
    const stale = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/draft-context', { method: 'PUT', key: 'reference-context-stale', body: { expectedVersion: round.body.data.value.version, plan: { referenceMaterials: [] } } });
    assert.equal(stale.status, 409);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Workbench can create image-derived draft rounds without creating a generation run', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-workbench-derived-round-'));
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const opened = await requestJsonAsWorkbench(started, '/api/sessions/open', { key: 'derived-round-session', body: { conversationId: 'workbench-derived-round' } });
    const session = opened.body.data;
    const project = await requestJsonAsWorkbench(started, '/api/projects', { key: 'derived-round-project', body: { name: '图片迭代项目', sessionId: session.id } });
    const otherProject = await requestJsonAsWorkbench(started, '/api/projects', { key: 'derived-round-other-project', body: { name: '外部项目' } });
    const task = await requestJsonAsWorkbench(started, '/api/tasks', { key: 'derived-round-task', body: { projectId: project.body.data.value.id, name: '图片迭代任务', sessionId: session.id } });
    const parentRound = await requestJsonAsWorkbench(started, '/api/rounds', { key: 'derived-round-parent', body: { taskId: task.body.data.value.id, purpose: 'exploration', sessionId: session.id } });
    const upload = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'derived-round-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': project.body.data.value.id }, body: png });
    const styleUpload = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'derived-round-style-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': project.body.data.value.id }, body: Buffer.concat([png, Buffer.from('style-derived')]) });
    const compositionUpload = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'derived-round-composition-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': project.body.data.value.id }, body: Buffer.concat([png, Buffer.from('composition-derived')]) });
    const foreignUpload = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'derived-round-foreign-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': otherProject.body.data.value.id }, body: Buffer.concat([png, Buffer.from('foreign-derived')]) });
    assert.equal(upload.status, 200);
    assert.equal(styleUpload.status, 200);
    assert.equal(compositionUpload.status, 200);
    assert.equal(foreignUpload.status, 200);
    const asset = (await upload.json()).data;
    const styleAsset = (await styleUpload.json()).data;
    const compositionAsset = (await compositionUpload.json()).data;
    const foreignAsset = (await foreignUpload.json()).data;

    const rejected = await requestJsonAsWorkbench(started, '/api/rounds/derived', { key: 'derived-round-foreign-rejected', body: { taskId: task.body.data.value.id, purpose: 'variation', sourceAssetIds: [foreignAsset.id], sessionId: session.id } });
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error.message, /当前项目或已明确共享/);

    const badPrimary = await requestJsonAsWorkbench(started, '/api/rounds/derived', { key: 'derived-round-bad-primary', body: { taskId: task.body.data.value.id, purpose: 'variation', sourceAssetIds: [asset.id], primaryAssetId: foreignAsset.id, sessionId: session.id } });
    assert.equal(badPrimary.status, 400);
    assert.match(badPrimary.body.error.message, /primaryAssetId/);

    const badFeedbackAsset = await requestJsonAsWorkbench(started, '/api/rounds/derived', { key: 'derived-round-bad-feedback-asset', body: { taskId: task.body.data.value.id, purpose: 'refinement', sourceAssetIds: [asset.id], feedbackToNextRound: { assetIds: [foreignAsset.id], reasons: ['外部素材'] }, sessionId: session.id } });
    assert.equal(badFeedbackAsset.status, 400);
    assert.match(badFeedbackAsset.body.error.message, /feedbackToNextRound\.assetIds/);

    const created = await requestJsonAsWorkbench(started, '/api/rounds/derived', { key: 'derived-round-create', body: { taskId: task.body.data.value.id, purpose: 'variation', action: 'more-similar', actionLabel: '生成更多类似图', parentRoundId: parentRound.body.data.value.id, sourceAssetIds: [asset.id, styleAsset.id, compositionAsset.id], primaryAssetId: asset.id, referenceArrangementMode: 'lead-style-composition', referenceArrangementLabel: '主图 + 风格 + 构图', referenceMaterials: [{ assetId: asset.id, usage: 'subject', note: '主参考图' }, { assetId: styleAsset.id, usage: 'style', note: '风格参考' }, { assetId: compositionAsset.id, usage: 'composition', note: '构图参考' }], targetCount: 4, aspectRatio: '4:5', variationAxes: ['构图', '背景'], keepConstraints: ['主体'], sessionId: session.id } });
    assert.equal(created.status, 200);
    const derived = created.body.data.value;
    assert.equal(derived.parentRoundId, parentRound.body.data.value.id);
    assert.equal(derived.purpose, 'variation');
    assert.equal(derived.status, 'draft');
    assert.equal(derived.plan.draftKind, 'studio-derived-round-context');
    assert.deepEqual(derived.plan.parentAssetIds, [asset.id, styleAsset.id, compositionAsset.id]);
    assert.deepEqual(derived.plan.referenceMaterials.map((item) => item.usage), ['subject', 'style', 'composition']);
    assert.equal(derived.plan.derivation.primaryAssetId, asset.id);
    assert.equal(derived.plan.derivation.referenceArrangement.mode, 'lead-style-composition');
    assert.deepEqual(derived.plan.derivation.referenceArrangement.usageCounts, { subject: 1, style: 1, composition: 1 });
    assert.deepEqual(derived.plan.derivation.variationAxes, ['构图', '背景']);
    assert.equal(derived.plan.derivation.action, 'more-similar');
    assert.equal(derived.plan.derivation.actionLabel, '生成更多类似图');
    assert.equal(derived.plan.itemCount, 4);
    assert.deepEqual(derived.plan.output, { aspectRatio: '4:5' });

    const feedbackRound = await requestJsonAsWorkbench(started, '/api/rounds/derived', { key: 'derived-round-feedback', body: { taskId: task.body.data.value.id, purpose: 'refinement', action: 'feedback-to-next-round', actionLabel: '从不采用原因创建下一轮', sourceAssetIds: [asset.id], primaryAssetId: asset.id, referenceArrangementMode: 'feedback-negative', referenceArrangementLabel: '不采用原因 → 下一轮修改', referenceMaterials: [{ assetId: asset.id, usage: 'negative', note: '不采用反例：风格不对。' }], refinementGoals: ['风格不对', '提升可用度'], keepConstraints: ['主体'], feedbackToNextRound: { source: 'workbench-reject-dialog', assetIds: [asset.id], reasonIds: ['style-wrong'], reasons: ['风格不对'], note: '下轮不要延续廉价质感。' }, sessionId: session.id } });
    assert.equal(feedbackRound.status, 200);
    assert.equal(feedbackRound.body.data.value.plan.derivation.action, 'feedback-to-next-round');
    assert.equal(feedbackRound.body.data.value.plan.derivation.actionLabel, '从不采用原因创建下一轮');
    assert.deepEqual(feedbackRound.body.data.value.plan.derivation.feedbackToNextRound.reasonIds, ['style-wrong']);
    assert.deepEqual(feedbackRound.body.data.value.plan.derivation.feedbackToNextRound.assetIds, [asset.id]);

    const maskedEdit = await requestJsonAsWorkbench(started, '/api/rounds/derived', { key: 'derived-round-mask-edit', body: { taskId: task.body.data.value.id, purpose: 'edit', parentRoundId: parentRound.body.data.value.id, sourceAssetIds: [asset.id, compositionAsset.id], parentAssetIds: [asset.id], primaryAssetId: asset.id, referenceArrangementMode: 'edit-mask-style', referenceArrangementLabel: '局部编辑三件套', referenceMaterials: [{ assetId: asset.id, usage: 'subject', note: '保留主体' }, { assetId: compositionAsset.id, usage: 'mask', note: '白色区域修改，黑色区域保持' }], instruction: '只修改遮罩区域的背景', sessionId: session.id } });
    assert.equal(maskedEdit.status, 200);
    assert.deepEqual(maskedEdit.body.data.value.plan.parentAssetIds, [asset.id]);
    assert.equal(maskedEdit.body.data.value.plan.maskAssetId, compositionAsset.id);
    assert.deepEqual(maskedEdit.body.data.value.plan.referenceAssetIds, [asset.id]);
    assert.deepEqual(maskedEdit.body.data.value.plan.derivation.parentAssetIds, [asset.id]);
    assert.equal(maskedEdit.body.data.value.plan.derivation.editIntent, '只修改遮罩区域的背景');
    const planStatus = await requestJsonAsWorkbench(started, '/api/sessions/' + session.id + '/plan-status');
    assert.equal(planStatus.body.data.context.round.id, maskedEdit.body.data.value.id);
    assert.deepEqual(planStatus.body.data.latestRun, null);
    const runs = await requestJsonAsWorkbench(started, '/api/rounds/' + maskedEdit.body.data.value.id + '/runs');
    assert.deepEqual(runs.body.data.runs, []);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
