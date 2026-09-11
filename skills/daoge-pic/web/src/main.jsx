import { Component, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Bookmark, Check, ChevronLeft, ChevronRight, CircleAlert, CloudOff, Columns3, Copy, Download, Ellipsis, Eye, FolderKanban, GitFork, Image as ImageIcon, ImagePlus, Inbox, Library, LoaderCircle, LockKeyhole, MessageSquareText, Pause, Play, RefreshCw, RotateCcw, Search, Share2, SlidersHorizontal, Sparkles, Tag, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { dryRunEvidence, normalizeAdvancedDetails } from './advanced-details.mjs';
import { runExecutionPresentation, runHistoryOption, runItemRecovery, statusPresentation, taskPresentation } from './status-presentation.mjs';
import { planPresentation, planStateLabel } from './plan-presentation.mjs';
import { ASSET_SCOPES, isStudioView, parseWorkbenchRoute, rendererForWorkbenchView, selectProject, selectRound, selectTask, serializeWorkbenchRoute, updateWorkbenchRoute } from './workbench-route.mjs';
import { PromptWorkspace } from './prompt-workspace.jsx';
import { LearningCenter } from './learning-center.jsx';
import { CreativeLibrary } from './creative-library.jsx';
import { SharedAssets } from './shared-assets.jsx';
import { CreativeLineageCanvas } from './creative-lineage-canvas.jsx';
import { CreatorDelivery } from './creator-delivery.jsx';
import { CreativeActionLauncher } from './creative-action-launcher.jsx';
import { WorkbenchNavigation } from './workbench-navigation.jsx';
import { deliverySelectionMessage, projectDeliverySelection } from './delivery-workflow.mjs';
import { bootstrapLocalStudioSession } from './local-auth.mjs';
import { AccessibleDialog } from './accessible-dialog.jsx';
import { ConfirmationDialog } from './confirmation-dialog.jsx';
import { StudioSearch } from './studio-search.jsx';
import { createLatestRequestGate, useRouteRefresh } from './use-route-refresh.mjs';
import { studioEventRefreshPlan, useStudioEvents } from './use-studio-events.mjs';
import { assetOriginalUrl, assetThumbnailUrl } from './asset-media-url.mjs';
import { ASSET_IMPORT_CONCURRENCY, mapWithConcurrency } from './bounded-concurrency.mjs';
import { createEventRefreshQueue } from './refresh-coordinator.mjs';
import { createStudioSearchCoordinator } from './studio-search-model.mjs';
import { batchOperationSignature, createBatchOperationSnapshot, createDeliveryInteractionGuard, isDeliveryOperationCurrent } from './creator-delivery-model.mjs';
import { ASSET_PAGE_SIZES, DEFAULT_ASSET_PAGE_SIZE, assetPageCount, clampAssetPage, normalizeAssetPageSize } from './asset-pagination.mjs';
import { DEFAULT_RUN_ITEM_FILTER, DEFAULT_RUN_ITEM_PAGE_SIZE, EMPTY_RUN_ITEM_PAGE, RUN_ITEM_FILTER_OPTIONS, RUN_ITEM_PAGE_SIZES, normalizeRunItemFilter, normalizeRunItemPage, normalizeRunItemPageNumber, normalizeRunItemPageSize, normalizeRunItemSequence, retryableRunItems, runItemFilterCount, runItemPageBounds, runItemProgress, selectableRunItemIds, serializeRunItemRequestQuery } from './run-item-pagination.mjs';
import { assetRefreshPath } from './asset-refresh-plan.mjs';
import { EMPTY_LINEAGE_RUN_ITEM_COVERAGE, LINEAGE_ASSET_PAGE_SIZE, loadCompleteLineageAssets, loadCompleteLineageRunItems } from './lineage-data-loader.mjs';
import { PROJECT_PAGE_SIZE, TASK_OVERVIEW_PAGE_SIZE, TASK_PAGE_SIZE, createProjectSearchIndex, createTaskSearchIndex, filterProjectIndex, filterTaskIndex, paginateWorkspaceItems } from './workspace-list-model.mjs';
import { ProviderSettings } from './provider-settings.jsx';
import { workbenchConversationId } from './workbench-session.mjs';
import { CREATIVE_DERIVED_ACTIONS, CREATIVE_DERIVED_ACTION_BY_ID, creativeDerivedActionForPurpose } from './creative-actions.mjs';
import { installBrowserErrorGuard } from './browser-error-guard.mjs';
import { redactedRuntimeDiagnostic, runtimeHealthPresentation } from './runtime-health.mjs';
import './styles.css';

const EMPTY = [];

installBrowserErrorGuard();

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers: {
        accept: 'application/json',
        'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    const connectionFailure = new Error('无法连接到本地 Studio。请刷新到当前 Studio 地址后重试。');
    connectionFailure.category = 'connection';
    throw connectionFailure;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(response.ok ? '本地 Studio 返回了无效响应。' : '本地 Studio 暂时不可用。');
  }
  if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || '本地 Studio 请求失败。');
  return payload.data;
}

function projectArchiveUrl(projectId, assetIds) { const params = new URLSearchParams(); for (const assetId of assetIds) params.append('assetId', assetId); return '/api/projects/' + encodeURIComponent(projectId) + '/assets/archive?' + params.toString(); }

function deliveryArchiveUrl(deliveryId, sequences) { const params = new URLSearchParams(); for (const sequence of sequences) params.append('sequence', String(sequence)); return '/api/deliveries/' + encodeURIComponent(deliveryId) + '/archive?' + params.toString(); }

function clipboardItemSupports(type) {
  return typeof ClipboardItem !== 'undefined' && (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports(type));
}

async function convertImageBlobToPng(image) {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法准备剪贴板图片。');
    context.drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('当前浏览器无法转换图片格式。')), 'image/png');
    });
  } finally {
    bitmap.close?.();
  }
}

async function writeImageBlobToClipboard(image) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
  const writeBlob = async (type, blob) => {
    if (!clipboardItemSupports(type)) return false;
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    return true;
  };
  if (image.type) {
    try {
      if (await writeBlob(image.type, image)) return true;
    } catch {
      // Browsers commonly reject image/jpeg for ClipboardItem; retry as PNG, then fall back to copying the URL.
    }
  }
  if (image.type !== 'image/png' && clipboardItemSupports('image/png')) {
    try {
      const pngImage = await convertImageBlobToPng(image);
      if (await writeBlob('image/png', pngImage)) return true;
    } catch {
      return false;
    }
  }
  return false;
}


function uniqueKey(prefix) {
  return prefix + '-' + crypto.randomUUID();
}
const DELIVERY_COMPLETION_PREFIX = 'daoge-pic:delivery-completion:';
const ASSET_PAGE_SIZE_KEY = 'daoge-pic:asset-page-size';
const RAIL_COLLAPSE_KEY = 'daoge-pic:rail-collapsed';

const ASSET_SCOPE_LABELS = { round: '当前轮次', task: '当前任务', project: '当前项目', studio: '全部 Studio' };
const ROUND_PURPOSE_LABELS = { exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' };
const PROJECT_CREATION_TEMPLATES = [
  {
    id: 'brand-visual', version: 1, name: '品牌视觉探索', label: '品牌视觉探索', description: '适合为品牌、活动或长期主题建立视觉方向。', defaultName: '品牌视觉探索项目', descriptionPrompt: '写清品牌/活动、受众、使用场景、必须保留的品牌元素。', recommendedTasks: ['品牌视觉方向探索', '品牌主视觉精修', '品牌素材交付整理'], aspectRatios: ['1:1', '4:5', '16:9'], referenceHint: '可以准备 Logo、品牌色、竞品风格或历史视觉作为参考。', exampleDescriptions: ['为新品发布建立一组高级、清爽、有品牌识别度的主视觉方向。', '沉淀品牌长期视觉关键词，先探索 3 个不同方向再收敛。'],
    taskDefaults: [
      { goalId: 'exploration', label: '品牌方向探索', defaultName: '品牌视觉方向探索', defaultCount: '6', defaultAspectRatio: '16:9', roundPurpose: 'exploration', materialNeeds: ['Logo / 品牌字标', '品牌色或色板', '竞品或历史视觉', '使用渠道'], recommendedInputs: ['品牌定位', '目标受众', '使用渠道', '禁用元素'], quickBriefs: ['围绕品牌发布会探索 6 张 16:9 主视觉方向，要求高级、清爽、有识别度。', '基于 Logo 和品牌色探索高端、年轻化、自然感三种视觉路线。'] },
      { goalId: 'refinement', label: '主视觉精修', defaultName: '品牌主视觉精修', defaultCount: '4', defaultAspectRatio: '16:9', roundPurpose: 'refinement', materialNeeds: ['已选主视觉', '品牌包', '禁改元素'], recommendedInputs: ['精修目标', '必须保持的品牌元素', '交付用途'], quickBriefs: ['保留品牌主视觉构图，增强质感、层次和商业完成度。'], defaultRefinementGoals: ['质感', '光影', '商业感'], defaultKeepConstraints: ['Logo', '构图大方向', '色彩氛围'] },
      { goalId: 'variation', label: '渠道物料变体', defaultName: '品牌渠道物料变体', defaultCount: '6', defaultAspectRatio: '4:5', roundPurpose: 'variation', materialNeeds: ['已确认主视觉', '渠道尺寸', '品牌规范'], recommendedInputs: ['变化渠道', '保留元素', '尺寸要求'], quickBriefs: ['基于已确认主视觉，扩展 4:5 社媒物料和 1:1 封面版本。'], defaultVariationAxes: ['构图', '色彩', '商业感'], defaultKeepConstraints: ['Logo', '色彩氛围', '构图大方向'] }
    ]
  },
  {
    id: 'ecommerce-product', version: 1, name: '电商商品图', label: '电商商品图', description: '适合商品主图、场景图、卖点图和详情页素材。', defaultName: '电商商品图项目', descriptionPrompt: '写清商品、平台规格、卖点、品牌约束和交付图类型。', recommendedTasks: ['商品主图探索', '商品场景图', '卖点细节图'], aspectRatios: ['1:1', '4:5', '3:4'], referenceHint: '准备商品主体图、品牌包和平台规格，有助于保持商品与 Logo 一致。', exampleDescriptions: ['为夏季茶饮新品制作电商主图、场景图和卖点图，突出清爽感和产品质感。', '围绕单个商品探索 1:1 主图和 4:5 详情页视觉，要求主体准确、背景高级。'],
    taskDefaults: [
      { goalId: 'exploration', label: '商品主图探索', defaultName: '商品主图探索', defaultCount: '8', defaultAspectRatio: '1:1', roundPurpose: 'exploration', materialNeeds: ['商品主体图', '品牌包 / Logo', '平台规格', '核心卖点'], recommendedInputs: ['商品卖点', '平台规格', '背景风格', '禁忌元素'], quickBriefs: ['围绕单个商品探索 8 张 1:1 主图，主体准确、背景高级、卖点清晰。', '为夏季茶饮新品探索清爽、明亮、有购买欲的电商主图方向。'] },
      { goalId: 'variation', label: '商品场景图变体', defaultName: '商品场景图变体', defaultCount: '4', defaultAspectRatio: '4:5', roundPurpose: 'variation', materialNeeds: ['商品主体图', '已选主图', '场景关键词'], recommendedInputs: ['场景方向', '变化维度', '保持不变项'], quickBriefs: ['保留商品主体和 Logo，生成 4 张 4:5 场景图，变化背景和光影。'], defaultVariationAxes: ['背景', '光影', '商业感'], defaultKeepConstraints: ['产品', 'Logo', '主体'] },
      { goalId: 'refinement', label: '商品质感精修', defaultName: '商品质感精修', defaultCount: '4', defaultAspectRatio: '1:1', roundPurpose: 'refinement', materialNeeds: ['已选商品图', '产品细节要求', '品牌约束'], recommendedInputs: ['精修目标', '不可改变的产品细节', '交付规格'], quickBriefs: ['保留商品轮廓和 Logo，增强材质、边缘清晰度和商业摄影质感。'], defaultRefinementGoals: ['清晰度', '质感', '商业感'], defaultKeepConstraints: ['产品', 'Logo', '主体'] }
    ]
  },
  {
    id: 'social-content', version: 1, name: '社媒内容图', label: '社媒内容图', description: '适合小红书封面、公众号配图和短内容封面。', defaultName: '社媒内容图项目', descriptionPrompt: '写清发布平台、主题系列、标题安全区、目标受众和视觉语气。', recommendedTasks: ['社媒封面探索', '系列内容变体', '发布素材整理'], aspectRatios: ['3:4', '4:5', '9:16'], referenceHint: '先确定发布平台、文字安全区和系列视觉规律。', exampleDescriptions: ['做一组适合小红书的新品封面，保留足够标题区，整体明亮、有点击欲。', '为 6 篇系列内容统一视觉风格，同时保留每篇主题差异。'],
    taskDefaults: [
      { goalId: 'exploration', label: '社媒封面探索', defaultName: '社媒封面探索', defaultCount: '6', defaultAspectRatio: '3:4', roundPurpose: 'exploration', materialNeeds: ['发布平台', '标题文案 / 安全区', '系列参考封面', '受众标签'], recommendedInputs: ['平台', '标题区', '主题系列', '视觉语气'], quickBriefs: ['做 6 张适合小红书的 3:4 封面，保留标题安全区，明亮、有点击欲。', '围绕新品内容探索统一系列视觉，要求每张主题不同但风格一致。'] },
      { goalId: 'variation', label: '系列封面变体', defaultName: '系列封面变体', defaultCount: '6', defaultAspectRatio: '4:5', roundPurpose: 'variation', materialNeeds: ['已选封面方向', '系列主题清单', '标题规则'], recommendedInputs: ['变化主题', '保持版式', '标题区域'], quickBriefs: ['保持封面版式和色调，为 6 篇系列内容生成不同主题变体。'], defaultVariationAxes: ['构图', '色彩', '风格'], defaultKeepConstraints: ['构图大方向', '色彩氛围'] },
      { goalId: 'refinement', label: '发布图精修', defaultName: '发布图精修', defaultCount: '4', defaultAspectRatio: '3:4', roundPurpose: 'refinement', materialNeeds: ['待发布封面', '标题安全区', '平台规范'], recommendedInputs: ['精修目标', '标题区域', '发布平台'], quickBriefs: ['保留标题安全区和版式，提高封面清晰度、对比和点击吸引力。'], defaultRefinementGoals: ['清晰度', '构图', '商业感'], defaultKeepConstraints: ['构图大方向', '色彩氛围'] }
    ]
  },
  {
    id: 'character-ip', version: 1, name: '角色 / IP 设计', label: '角色 / IP 设计', description: '适合头像、角色设定、表情包和衍生形象。', defaultName: '角色 IP 设计项目', descriptionPrompt: '写清角色身份、固定外观、性格、禁改特征和使用场景。', recommendedTasks: ['角色形象探索', '角色动作变体', '表情与头像套组'], aspectRatios: ['1:1', '3:4', '9:16'], referenceHint: '准备角色主体、身份特征、服饰和不可改变的形象约束。', exampleDescriptions: ['设计一个亲切、机灵的猫咪 IP，先探索头像和全身设定。', '基于现有角色做表情包和动作变体，必须保持脸型、服饰和主色。'],
    taskDefaults: [
      { goalId: 'exploration', label: '角色形象探索', defaultName: '角色形象探索', defaultCount: '8', defaultAspectRatio: '1:1', roundPurpose: 'exploration', materialNeeds: ['角色设定描述', '主体参考图', '不可改变特征', '使用场景'], recommendedInputs: ['角色身份', '性格关键词', '固定外观', '禁改特征'], quickBriefs: ['设计 8 张 1:1 角色头像方向，保持亲切、机灵、可做长期 IP。', '探索角色全身设定和头像方向，明确脸型、服饰、主色和性格。'] },
      { goalId: 'variation', label: '动作 / 表情变体', defaultName: '角色动作表情变体', defaultCount: '8', defaultAspectRatio: '1:1', roundPurpose: 'variation', materialNeeds: ['已确认角色图', '动作或表情清单', '保持特征'], recommendedInputs: ['变化表情 / 动作', '必须保持特征', '使用场景'], quickBriefs: ['保持角色脸型、服饰和主色，生成 8 张不同情绪头像。'], defaultVariationAxes: ['表情', '姿势', '构图'], defaultKeepConstraints: ['人物身份', '主体', '色彩氛围'] },
      { goalId: 'refinement', label: '角色一致性精修', defaultName: '角色一致性精修', defaultCount: '4', defaultAspectRatio: '1:1', roundPurpose: 'refinement', materialNeeds: ['已选角色图', '一致性约束', '细节要求'], recommendedInputs: ['精修目标', '身份保持项', '细节要求'], quickBriefs: ['保留角色身份、脸型和服饰，提升线条、质感和头像完成度。'], defaultRefinementGoals: ['清晰度', '细节', '质感'], defaultKeepConstraints: ['人物身份', '主体', '色彩氛围'] }
    ]
  },
  {
    id: 'custom', version: 1, name: '自定义项目', label: '自定义项目', description: '目标特殊时选择，并在说明中写清客户、产品、渠道和交付用途。', defaultName: '自定义创作项目', descriptionPrompt: '写清项目边界、已有素材、限制条件、产出规格和交付对象。', recommendedTasks: ['自定义创作任务'], aspectRatios: ['1:1', '4:5', '3:4', '16:9', '9:16'], referenceHint: '请在项目说明中写清输入、限制、使用渠道和交付目标。', exampleDescriptions: ['已有明确需求，按当前素材和交付目标建立一个独立创作项目。'],
    taskDefaults: [
      { goalId: 'custom', label: '自定义创作任务', defaultName: '自定义创作任务', defaultCount: '', defaultAspectRatio: '', roundPurpose: 'exploration', materialNeeds: ['输入素材', '限制条件', '交付用途'], recommendedInputs: ['输入素材', '限制条件', '交付用途'], quickBriefs: ['已有明确需求，请按当前素材、限制条件和交付目标建立任务。'] }
    ]
  }
];
const TASK_CREATION_GOALS = [
  { id: 'exploration', label: '从零探索方向', description: '还没确定视觉方向，一次准备多组候选。', defaultName: '首轮视觉探索', defaultCount: '6', defaultAspectRatio: '4:5', roundPurpose: 'exploration', recommendedInputs: ['目标受众 / 使用渠道', '风格方向', '参考素材'], quickBriefs: ['做一组适合小红书封面的茶饮新品海报；需要清爽、夏季、产品突出。', '先探索三种差异明显的品牌主视觉方向，再从中收敛。'] },
  { id: 'variation', label: '基于已有图做变化', description: '保留大方向，变化构图、色彩、背景或姿态。', defaultName: '结果变体探索', defaultCount: '4', defaultAspectRatio: '', roundPurpose: 'variation', defaultVariationAxes: ['构图', '背景'], defaultKeepConstraints: ['主体', 'Logo'], recommendedInputs: ['父资产 / 参考图', '希望变化的维度', '必须保持不变'], quickBriefs: ['保留主体和 Logo，尝试更明亮的背景与三种构图。', '主体不变，分别变化背景、色彩和光影，让方向更适合商业海报。'] },
  { id: 'refinement', label: '把选中图做精致', description: '提升质感、光影、清晰度和商业完成度。', defaultName: '结果精修', defaultCount: '4', defaultAspectRatio: '', roundPurpose: 'refinement', defaultRefinementGoals: ['质感', '光影', '细节'], defaultKeepConstraints: ['主体', '构图大方向'], recommendedInputs: ['父资产 / 参考图', '精修目标', '不允许改变项'], quickBriefs: ['提高材质真实感和边缘清晰度，不改变人物身份。', '保留构图和主体，增强高级感、细节和商业摄影质感。'] },
  { id: 'edit', label: '局部修改 / 替换', description: '只修改画面中特定区域，其他内容尽量保持。', defaultName: '局部编辑', defaultCount: '2', defaultAspectRatio: '', roundPurpose: 'edit', defaultKeepConstraints: ['主体', 'Logo'], recommendedInputs: ['父资产', '修改区域 / 遮罩', '保持区域'], quickBriefs: ['只替换右侧背景中的植物，主体和 Logo 保持不变。', '修改局部文字区域，其他构图、产品和光影不变。'] },
  { id: 'custom', label: '自定义任务', description: '目标特殊时选择，并在创作意图里写清输入、限制和交付用途。', defaultName: '自定义创作任务', defaultCount: '', defaultAspectRatio: '', roundPurpose: 'exploration', recommendedInputs: ['输入素材', '限制条件', '交付用途'], quickBriefs: ['已有明确需求，请按当前素材、限制条件和交付目标建立任务。'] }
];
const ROUND_CREATION_PURPOSES = [
  { id: 'exploration', label: '探索新方向', description: '适合还没确定视觉方向时，一次生成多种候选。', defaultCount: '6', defaultAspectRatio: '4:5', recommendedInputs: ['创作主题', '风格方向', '参考素材'], quickBriefs: ['探索三种适合夏季茶饮的视觉方向。', '从高端、清爽、年轻化三个方向各出候选。'] },
  { id: 'refinement', label: '精修当前结果', description: '适合选中满意图后，提高质感或细节。', defaultCount: '4', defaultAspectRatio: '', defaultRefinementGoals: ['质感', '光影', '细节'], defaultKeepConstraints: ['主体', '构图大方向'], recommendedInputs: ['父轮次 / 父资产', '精修目标', '不允许改变项'], quickBriefs: ['提升材质真实感和边缘清晰度，不改变主体身份。', '保留构图，增强商业完成度和画面细节。'] },
  { id: 'variation', label: '生成更多变体', description: '适合保留主体方向，但想多看几种变化。', defaultCount: '4', defaultAspectRatio: '', defaultVariationAxes: ['构图', '背景'], defaultKeepConstraints: ['主体', 'Logo'], recommendedInputs: ['父轮次 / 父资产', '变化维度', '保持不变项'], quickBriefs: ['保留主体和 Logo，尝试三种更明亮的背景构图。', '主体不变，分别变化构图、背景和色彩。'] },
  { id: 'edit', label: '局部修改', description: '适合只替换画面中的某个区域。', defaultCount: '2', defaultAspectRatio: '', defaultKeepConstraints: ['主体', 'Logo'], recommendedInputs: ['父资产', '遮罩或修改区域', '保持区域'], quickBriefs: ['只替换右侧背景中的植物，主体和 Logo 保持不变。', '修改局部文字或瑕疵区域，其他内容不变。'] },
  { id: 'fill', label: '补图 / 扩图', description: '适合扩展画幅或补充缺失区域。', defaultCount: '2', defaultAspectRatio: '16:9', defaultKeepConstraints: ['主体', '构图大方向'], recommendedInputs: ['原图', '扩展方向', '目标画幅'], quickBriefs: ['扩展为 16:9 横版，补齐两侧环境和留白。', '保持主体位置，向画面两侧自然延展背景。'] }
];
const CREATION_COUNT_OPTIONS = ['', '2', '4', '6', '8', '12'];
const CREATION_ASPECT_OPTIONS = ['', '1:1', '4:5', '3:4', '16:9', '9:16', '3:2'];
const REFERENCE_USAGE_OPTIONS = [
  { id: 'subject', label: '主体参考', description: '尽量保持主体身份、轮廓或核心特征。' },
  { id: 'style', label: '风格参考', description: '提取画风、质感和色调，不复制具体内容。' },
  { id: 'composition', label: '构图参考', description: '参考画面布局、视角和主体位置。' },
  { id: 'color', label: '色彩参考', description: '参考配色、明暗关系和整体氛围。' },
  { id: 'brand', label: '品牌参考', description: '参考 Logo、产品、品牌色或固定视觉规范。' },
  { id: 'mask', label: '遮罩图', description: '用于局部编辑范围；生成前仍会按 Provider 能力校验。' },
  { id: 'negative', label: '反例 / 不要这样', description: '说明不希望出现的方向，由 Agent 在计划中转成约束。' }
];
const REFERENCE_USAGE_LABELS = Object.fromEntries(REFERENCE_USAGE_OPTIONS.map((option) => [option.id, option.label]));
const DERIVED_ROUND_ACTIONS = CREATIVE_DERIVED_ACTIONS.map((action) => ({ ...action, label: action.label || action.title }));
const DERIVED_ACTION_BY_ID = CREATIVE_DERIVED_ACTION_BY_ID;
const DERIVED_ACTION_BY_PURPOSE = Object.fromEntries(DERIVED_ROUND_ACTIONS.map((option) => [option.purpose, option]));
const DERIVED_VARIATION_AXES = ['构图', '背景', '色彩', '风格', '姿势', '表情', '光影', '商业感'];
const DERIVED_KEEP_CONSTRAINTS = ['主体', '产品', 'Logo', '人物身份', '构图大方向', '色彩氛围'];
const DERIVED_REFINEMENT_GOALS = ['清晰度', '质感', '光影', '构图', '细节', '商业感'];
const DERIVED_REFERENCE_PRESETS = [
  { id: 'lead-style-composition', label: '主图 + 风格 + 构图', description: '第 1 张定主体，第 2 张定风格，第 3 张定构图，剩余补色彩氛围。', pattern: ['subject', 'style', 'composition'], rest: 'color' },
  { id: 'multi-subject', label: '多主体 / 多元素融合', description: '所有图片都作为主体或元素参考，适合人物、产品或角色组合。', all: 'subject' },
  { id: 'subject-negative', label: '主体 + 反例对照', description: '第 1 张作为保留方向，其余作为不要继续的反例。', pattern: ['subject'], rest: 'negative' },
  { id: 'edit-mask-style', label: '局部编辑三件套', description: '第 1 张主体，第 2 张遮罩，其余参考风格；只在局部修改时显示。', purposes: ['edit'], pattern: ['subject', 'mask'], rest: 'style' },
  { id: 'fill-composition', label: '补图构图板', description: '第 1 张确定构图和边界，其余补风格与氛围；适合扩图。', purposes: ['fill'], pattern: ['composition'], rest: 'style' }
];
const DERIVED_REFERENCE_USAGE_NOTES = {
  subject: '主体 / 产品 / 人物身份参考',
  style: '风格、质感和画法参考',
  composition: '构图、视角和空间关系参考',
  color: '色彩与明暗氛围参考',
  brand: '品牌元素、Logo 或固定规范参考',
  mask: '局部编辑遮罩；白色区域通常表示修改范围',
  negative: '反例：下一轮需要避免这种方向'
};
const MATERIAL_NEED_USAGE_RULES = [
  { pattern: /遮罩|蒙版|修改区域|重绘区域/, usage: 'mask', hint: '适合导入黑白或透明遮罩；生成前仍会按 Provider 能力预检。' },
  { pattern: /Logo|品牌|规范|色板|品牌包/i, usage: 'brand', hint: '适合导入 Logo、品牌色、品牌规范截图或固定视觉规范。' },
  { pattern: /风格|竞品|历史视觉|系列参考|参考封面|画法|质感/, usage: 'style', hint: '适合导入风格样张；Agent 只提取画风、质感和语气。' },
  { pattern: /构图|版式|安全区|尺寸|规格|平台|渠道|场景关键词/, usage: 'composition', hint: '适合导入版式、安全区、平台规格或构图参考截图。' },
  { pattern: /色彩|配色|光线|光影|氛围/, usage: 'color', hint: '适合导入色彩、明暗关系或氛围参考。' },
  { pattern: /反例|不要|禁改|禁忌|不允许|限制|不可改变|保持|一致性/, usage: 'negative', hint: '适合导入不希望延续的方向；文字约束请同时写进创作意图。' },
  { pattern: /主体|产品|商品|角色|人物|原图|已选|已确认|待发布|主视觉|封面|输入素材/, usage: 'subject', hint: '适合导入主体、产品、角色或已选结果，用于保持身份和轮廓。' }
];

const REJECT_REASON_OPTIONS = [
  { id: 'subject-wrong', label: '主体不准' },
  { id: 'style-wrong', label: '风格不对' },
  { id: 'composition-bad', label: '构图不行' },
  { id: 'quality-cheap', label: '质感廉价' },
  { id: 'text-logo-wrong', label: '文字 / Logo 错' },
  { id: 'brand-mismatch', label: '不符合品牌' },
  { id: 'other', label: '其他' }
];
const REJECT_REASON_LABELS = Object.fromEntries(REJECT_REASON_OPTIONS.map((option) => [option.id, option.label]));


function compactRecord(record) {
  const value = {};
  for (const [key, item] of Object.entries(record)) if (item !== undefined && item !== null && item !== '') value[key] = item;
  return value;
}

function listItems(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function projectTemplateName(template) { return template?.name || template?.label || '自定义项目'; }
function projectTemplateDefaultName(template) { return template?.defaultName || projectTemplateName(template) + '项目'; }
function creationDefaultSummary(option) { return [option?.defaultCount ? option.defaultCount + ' 张' : '数量由 Agent 决定', option?.defaultAspectRatio || '画幅由 Agent 决定'].join(' · '); }
function uniqueList(items) {
  return Array.from(new Set(listItems(items).map((item) => String(item).trim()).filter(Boolean)));
}
function projectTemplateForProject(project, templates = PROJECT_CREATION_TEMPLATES) {
  return templates.find((template) => template.id === project?.templateId) || PROJECT_CREATION_TEMPLATES.find((template) => template.id === project?.templateId) || null;
}
function mergeTaskGoalDefault(goal, taskDefault) {
  if (!taskDefault) return { ...goal, templateRecommended: false, materialNeeds: listItems(goal.materialNeeds) };
  return {
    ...goal,
    ...taskDefault,
    id: goal.id,
    goalId: taskDefault.goalId || goal.id,
    label: taskDefault.label || goal.label,
    description: taskDefault.description || goal.description,
    defaultName: taskDefault.defaultName || goal.defaultName,
    defaultCount: taskDefault.defaultCount ?? goal.defaultCount,
    defaultAspectRatio: taskDefault.defaultAspectRatio ?? goal.defaultAspectRatio,
    roundPurpose: taskDefault.roundPurpose || goal.roundPurpose,
    recommendedInputs: uniqueList(taskDefault.recommendedInputs || goal.recommendedInputs),
    quickBriefs: uniqueList(taskDefault.quickBriefs || goal.quickBriefs),
    materialNeeds: uniqueList(taskDefault.materialNeeds || goal.materialNeeds),
    defaultVariationAxes: listItems(taskDefault.defaultVariationAxes || goal.defaultVariationAxes),
    defaultKeepConstraints: listItems(taskDefault.defaultKeepConstraints || goal.defaultKeepConstraints),
    defaultRefinementGoals: listItems(taskDefault.defaultRefinementGoals || goal.defaultRefinementGoals),
    templateRecommended: true
  };
}
function taskGoalsForProjectTemplate(template) {
  const defaults = listItems(template?.taskDefaults);
  if (!defaults.length) return TASK_CREATION_GOALS.map((goal) => mergeTaskGoalDefault(goal, null));
  const defaultByGoal = new Map(defaults.map((item) => [item.goalId, item]));
  const recommended = defaults.map((item) => {
    const base = TASK_CREATION_GOALS.find((goal) => goal.id === item.goalId);
    return base ? mergeTaskGoalDefault(base, item) : null;
  }).filter(Boolean);
  const rest = TASK_CREATION_GOALS.filter((goal) => !defaultByGoal.has(goal.id)).map((goal) => mergeTaskGoalDefault(goal, null));
  return [...recommended, ...rest];
}

function CreationInfoList({ label, items }) {
  const values = listItems(items);
  if (!values.length) return null;
  return <div className="creation-info-list"><span>{label}</span><ul>{values.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function CreationSuggestionChips({ label = '填入示例', options, onChoose }) {
  const values = listItems(options);
  if (!values.length) return null;
  return <div className="creation-suggestion-chips"><span>{label}</span><div>{values.map((item) => <button type="button" key={item} className="outline-button" onClick={() => onChoose(item)}>{item}</button>)}</div></div>;
}

function MaterialNeedChecklist({ materialNeeds, completedCounts = {}, title = '素材准备清单' }) {
  const values = uniqueList(materialNeeds);
  const signature = values.join('|');
  const [checkedNeeds, setCheckedNeeds] = useState(new Set());
  useEffect(() => {
    const allowed = new Set(values);
    setCheckedNeeds((current) => {
      const next = new Set([...current].filter((item) => allowed.has(item)));
      return next.size === current.size ? current : next;
    });
  }, [signature]);
  if (!values.length) return null;
  const toggleNeed = (need) => setCheckedNeeds((current) => {
    const next = new Set(current);
    if (next.has(need)) next.delete(need);
    else next.add(need);
    return next;
  });
  return <section className="material-need-checklist" aria-label={title}>
    <header><div><p className="eyebrow">{title}</p><h3>先把素材准备清楚</h3><span>勾选只是个人准备提醒；只有导入素材或保存参考素材才会写入 Studio 事实源。</span></div></header>
    <ul>{values.map((need) => {
      const preset = materialNeedUsagePreset(need);
      const count = Number(completedCounts[need] || 0);
      const checked = checkedNeeds.has(need);
      return <li key={need} className={'material-need-item ' + (count ? 'is-complete' : checked ? 'is-prepared' : '')}>
        <label><input type="checkbox" checked={checked || count > 0} onChange={() => toggleNeed(need)} /><span>{need}</span></label>
        <small>{count ? count + ' 张已导入或已挂载' : preset.hint}</small>
        <em>默认标注为：{preset.usageLabel}</em>
      </li>;
    })}</ul>
  </section>;
}

function MaterialImportGuide({ materialNeeds, selectedNeed, completedCounts = {}, assetScope, selectedRound, onSelectNeed }) {
  const values = uniqueList(materialNeeds);
  if (!values.length) return null;
  const activeNeed = values.includes(selectedNeed) ? selectedNeed : '';
  const preset = activeNeed ? materialNeedUsagePreset(activeNeed) : null;
  const roundDraft = Boolean(selectedRound && assetScope === 'round' && selectedRound.status === 'draft');
  const roundLocked = Boolean(selectedRound && assetScope === 'round' && selectedRound.status !== 'draft');
  return <section className="material-import-guide" aria-label="素材导入引导">
    <header>
      <div><p className="eyebrow">素材导入引导</p><h3>本次导入准备什么？</h3><span>{roundDraft ? '导入成功后会按用途自动加入当前草稿轮次参考素材。' : roundLocked ? '当前轮次已进入确认或运行流程，导入只保存素材，不改参考上下文。' : '先给导入批次选择用途，后续 Agent 能按素材需求理解上下文。'}</span></div>
    </header>
    <div className="material-need-selector" role="radiogroup" aria-label="本次导入素材需求">
      {values.map((need) => {
        const needPreset = materialNeedUsagePreset(need);
        const count = Number(completedCounts[need] || 0);
        return <button type="button" key={need} className={activeNeed === need ? 'is-active' : ''} aria-pressed={activeNeed === need} onClick={() => onSelectNeed(need)}><b>{need}</b><span>{needPreset.usageLabel}</span>{count > 0 && <small>{count} 张已准备</small>}</button>;
      })}
      <button type="button" className={!activeNeed ? 'is-active' : ''} aria-pressed={!activeNeed} onClick={() => onSelectNeed('')}><b>通用素材</b><span>稍后标注</span><small>不写入素材需求标签</small></button>
    </div>
    <div className="material-import-current"><Tag size={15} /><span>{preset ? preset.need + ' → ' + preset.usageLabel + '。' + preset.hint : '如果素材用途无法归类，先作为通用素材导入，之后在参考素材选择器里自定义备注。'}</span></div>
  </section>;
}

function setIfEmptyOrDefault(setter, previousDefault, nextDefault) {
  setter((current) => !String(current || '').trim() || current === previousDefault ? nextDefault || '' : current);
}

function normalizeReferenceMaterials(plan = {}) {
  const values = [];
  const seen = new Set();
  const add = (assetId, usage = 'subject', note = '') => {
    const id = typeof assetId === 'string' ? assetId.trim() : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    const knownUsage = REFERENCE_USAGE_LABELS[usage] ? usage : 'subject';
    values.push(compactRecord({ assetId: id, usage: knownUsage, note: typeof note === 'string' ? note.trim() : '' }));
  };
  if (Array.isArray(plan.referenceMaterials)) for (const item of plan.referenceMaterials) if (item && typeof item === 'object' && !Array.isArray(item)) add(item.assetId, item.usage, item.note);
  if (Array.isArray(plan.referenceAssetIds)) for (const assetId of plan.referenceAssetIds) add(assetId);
  if (typeof plan.maskAssetId === 'string') add(plan.maskAssetId, 'mask');
  return values;
}

function planWithReferenceMaterials(plan = {}, materials = []) {
  const normalized = normalizeReferenceMaterials({ referenceMaterials: materials });
  const referenceAssetIds = normalized.filter((item) => item.usage !== 'mask').map((item) => item.assetId);
  const mask = normalized.find((item) => item.usage === 'mask');
  const next = { ...plan, referenceMaterials: normalized, referenceAssetIds, referenceLabels: normalized.filter((item) => item.usage !== 'mask').map((item) => REFERENCE_USAGE_LABELS[item.usage] || item.usage) };
  if (mask) next.maskAssetId = mask.assetId;
  else delete next.maskAssetId;
  return next;
}

function materialNeedUsagePreset(need) {
  const label = String(need || '').trim();
  const matched = MATERIAL_NEED_USAGE_RULES.find((rule) => rule.pattern.test(label));
  const usage = matched?.usage || 'subject';
  return { need: label, usage, usageLabel: REFERENCE_USAGE_LABELS[usage] || usage, hint: matched?.hint || '可导入图片或截图；如果只是文字信息，请在创作意图或备注里说明。' };
}

function materialNeedReferenceNote(need, usage) {
  const preset = materialNeedUsagePreset(need);
  return '按素材需求导入：' + preset.need + ' · ' + (REFERENCE_USAGE_LABELS[usage || preset.usage] || usage || preset.usage);
}

function materialNeedsForTemplate(template) {
  const defaults = listItems(template?.taskDefaults);
  return uniqueList(defaults[0]?.materialNeeds || template?.materialNeeds || []);
}

function materialNeedsForTask(task) {
  return uniqueList(task?.intent?.materialNeeds || task?.plan?.materialNeeds || []);
}

function materialNeedsForContext(project, task, round, templates = PROJECT_CREATION_TEMPLATES) {
  const roundNeeds = uniqueList(round?.plan?.materialNeeds || []);
  if (roundNeeds.length) return roundNeeds;
  const taskNeeds = materialNeedsForTask(task);
  if (taskNeeds.length) return taskNeeds;
  const template = projectTemplateForProject(project, templates);
  return materialNeedsForTemplate(template);
}

function materialNeedCompletionCounts(materialNeeds, assets, referenceMaterials) {
  const buckets = Object.fromEntries(uniqueList(materialNeeds).map((need) => [need, new Set()]));
  if (!Object.keys(buckets).length) return {};
  for (const asset of listItems(assets)) {
    const need = typeof asset?.source?.materialNeed === 'string' ? asset.source.materialNeed.trim() : '';
    if (need && buckets[need]) buckets[need].add(asset.id);
  }
  for (const material of listItems(referenceMaterials)) {
    const note = typeof material?.note === 'string' ? material.note : '';
    for (const need of Object.keys(buckets)) if (note.includes(need) && material.assetId) buckets[need].add(material.assetId);
  }
  return Object.fromEntries(Object.entries(buckets).map(([need, assetIds]) => [need, assetIds.size]));
}

function assetMatchesQuery(asset, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [asset.id, asset.kind, asset.mediaType, asset.display?.label, asset.display?.taskName].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized));
}


function rejectFeedbackToDerivedForm(feedback, assets) {
  const sourceAssetIds = listItems(assets).map((asset) => asset.id).filter(Boolean);
  const reasons = uniqueList(feedback?.reasons || []);
  const reasonIds = uniqueList(feedback?.reasonIds || []);
  const note = String(feedback?.note || '').trim();
  const reasonText = reasons.length ? reasons.join('、') : '不采用原因';
  const nextRound = feedback?.nextRound && typeof feedback.nextRound === 'object' ? feedback.nextRound : {};
  return {
    purpose: nextRound.purpose || 'refinement',
    action: 'feedback-to-next-round',
    actionLabel: '从不采用原因创建下一轮',
    sourceAssetIds,
    parentAssetIds: [],
    primaryAssetId: sourceAssetIds[0] || '',
    referenceArrangementMode: 'feedback-negative',
    referenceArrangementLabel: '不采用原因 → 下一轮修改',
    referenceMaterials: listItems(assets).map((asset) => ({ assetId: asset.id, usage: 'negative', note: '不采用反例：' + reasonText + (note ? '。' + note : '') })),
    refinementGoals: uniqueList(nextRound.refinementGoals || reasons.concat(['提升可用度'])),
    keepConstraints: uniqueList(nextRound.keepConstraints || ['主体', '品牌约束', '构图大方向']),
    feedbackToNextRound: { source: 'workbench-reject-dialog', assetIds: sourceAssetIds, reasonIds, reasons, note },
    note: '基于不采用原因修正：' + reasonText + (note ? '。' + note : '')
  };
}




function runExecutionPresentationFromCounts(run, statusCounts) {
  if (!run) return runExecutionPresentation(null, EMPTY);
  if (['completed', 'partial', 'failed', 'cancelled', 'paused', 'resume_pending', 'pausing'].includes(run.status)) return statusPresentation('run', run.status);
  const counts = statusCounts && typeof statusCounts === 'object' ? statusCounts : {};
  if (['requesting', 'receiving', 'persisting'].some((status) => Number(counts[status] || 0) > 0)) return { label: '正在生成', tone: 'live' };
  if (Number(counts.leased || 0) > 0) return { label: '正在准备', tone: 'live' };
  if (Number(counts.retry_wait || 0) > 0) return { label: '等待重试', tone: 'quiet' };
  if (run.status === 'queued' || Number(counts.pending || 0) > 0) return { label: '排队中', tone: 'live' };
  return statusPresentation('run', run.status);
}

function statusLabel(value) { return statusPresentation('generic', value).label; }

function StatusPill({ value, scope = 'generic', presentation = null }) {
  const semantics = presentation || statusPresentation(scope, value);
  return <span className={'status-pill ' + semantics.tone}>{semantics.label}</span>;
}

function IconButton({ label, children, onClick, disabled = false, tone = 'default' }) {
  return <button className={'icon-button ' + tone} type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}>{children}</button>;
}

function surfaceTitle(view, project = null) {
  if (view === 'project-overview') return project?.name || '项目总览';
  return ({
    projects: '工作台',
    tasks: '任务',
    lineage: '创作流',
    'studio-overview': '创作流',
    prompts: '创作流',
    assets: '素材库',
    trash: '素材库',
    'shared-assets': '素材库',
    runs: '生成记录',
    deliveries: '交付',
    library: '资料',
    guide: '创作手册'
  })[view] || '工作台';
}

function surfaceEyebrow(view, hasProject) {
  if (['library', 'shared-assets', 'guide'].includes(view)) return '辅助';
  return hasProject ? '项目工作区' : 'Studio';
}

function surfaceSubtitle(view, project) {
  if (view === 'project-overview') return '项目总览 · 任务、素材与交付';
  if (view === 'library') return '任务类型、风格与品牌规则。';
  if (view === 'shared-assets') return '跨项目复用图片。';
  if (view === 'guide') return '工作流帮助。';
  if (project) return project.name;
  return '从工作台选择项目，再进入创作流、素材库、生成记录或交付。';
}


function RuntimeHealthAlertStrip({ studio, recoveryPhase, repairing, onCopy, onRefresh, onRepair }) {
  const presentation = runtimeHealthPresentation(studio?.runtime, recoveryPhase);
  if (!['warning', 'danger'].includes(presentation.tone)) return null;
  const repairable = recoveryPhase === 'ready' && [studio?.runtime?.workerPool?.state, studio?.runtime?.mediaWorkerPool?.state].some((state) => state === 'degraded' || state === 'failed');
  return <aside className={'runtime-alert-strip is-' + presentation.tone} role={presentation.tone === 'danger' ? 'alert' : 'status'} aria-live={presentation.live ? 'polite' : 'off'}>
    <div><Activity size={16} aria-hidden="true" /><strong>{presentation.title}</strong><span>{presentation.detail}</span></div>
    <div className="runtime-health-actions">
      {repairable && <button type="button" className="outline-button" disabled={repairing} onClick={onRepair}><RefreshCw size={15} className={repairing ? 'spin' : ''} />{repairing ? '正在重启' : '安全重启'}</button>}
      <button type="button" className="outline-button" onClick={onRefresh}><RefreshCw size={15} />刷新状态</button>
      <button type="button" className="outline-button" onClick={onCopy}><Copy size={15} />复制脱敏诊断</button>
    </div>
  </aside>;
}

function SessionPlanSummary({ sessionPlanStatus, onRestoreContext }) {
  const detailsRef = useRef(null);
  useEffect(() => {
    const closeOnOutsidePointer = (event) => {
      const details = detailsRef.current;
      if (!details?.open || details.contains(event.target)) return;
      details.open = false;
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, []);
  if (!sessionPlanStatus) return null;
  const context = sessionPlanStatus.context;
  const purpose = context ? (({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[context.round.purpose] || context.round.purpose) : '';
  const compactLabel = context ? purpose + ' · 计划 v' + context.round.planVersion : '未绑定轮次';
  return <details ref={detailsRef} className={'session-plan-summary ' + (!context ? 'is-empty' : '')}>
    <summary><LockKeyhole size={14} aria-hidden="true" /><span>当前会话</span><b>{compactLabel}</b></summary>
    <div className="session-plan-popover" aria-label="当前会话只读计划摘要">
      {context ? <><p className="eyebrow">当前上下文</p><h3>{context.project.name} / {context.task.name}</h3><span>{purpose} · 计划 v{context.round.planVersion}</span><div className="session-plan-state"><StatusPill value={context.round.status} scope="round" /><span>{sessionPlanStatus.confirmation?.confirmed ? '当前计划已由用户确认' : '当前计划尚未人工确认'}</span>{sessionPlanStatus.latestRun && <span>最近运行：{statusLabel(sessionPlanStatus.latestRun.status)}</span>}</div><button type="button" className="outline-button" onClick={onRestoreContext}>回到当前上下文</button></> : <><p className="eyebrow">当前会话</p><h3>未绑定活动轮次</h3><span>确认计划前，请先选择项目、任务和草稿轮次。</span></>}
    </div>
  </details>;
}

function AssetSelectionStrip({ assets, selectedTask, selectedRound, onRemove, onClear, onPreview, onDownloadArchive, onDeliver, onOpenDerive, onAddReference, onReject, onOpenReference }) {
  return <section className="selection-strip">
    <header><div><p className="eyebrow">已选图片</p><h2>{String(assets.length).padStart(2, '0')} 张</h2></div>{assets.length > 0 && <div className="selection-strip-actions"><button type="button" className="outline-button" onClick={() => onPreview(assets)}><Eye size={15} />预览</button><CreativeActionLauncher assets={assets} selectedTask={selectedTask} selectedRound={selectedRound} label="基于已选继续" onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} /><button type="button" className="outline-button" onClick={onDeliver}><Check size={15} />去交付</button><button type="button" className="outline-button" onClick={onDownloadArchive}><Download size={15} />打包下载 {assets.length} 张</button><IconButton label="清空当前选片" onClick={onClear}><X size={15} /></IconButton></div>}</header>
    {assets.length ? <div className="selection-strip-items">{assets.map((asset) => <article className="selection-item" key={asset.id}><button type="button" className="selection-preview" onClick={() => onPreview([asset])} aria-label="放大查看已选图片"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button><div className="selection-item-copy"><strong title={asset.display?.label || '已选素材'}>{asset.display?.label || '已选素材'}</strong><span>{asset.review?.decision === 'keep' ? '已保留' : asset.review?.decision === 'review' ? '待复核' : asset.review?.decision === 'derive' ? '衍生方向' : asset.review?.decision === 'reject' ? '不采用' : '尚未评审'}</span></div><button type="button" className="selection-remove" title="移出当前选片" aria-label="移出当前选片" onClick={() => onRemove(asset.id)}><X size={13} /></button></article>)}</div> : <div className="selection-strip-empty"><Bookmark size={18} /><span>当前没有已选图片</span></div>}
  </section>;
}

function ListPager({ page, totalPages, total, onPageChange }) {
  if (totalPages <= 1) return <span className="workspace-list-total">共 {total} 项</span>;
  return <nav className="workspace-list-pager" aria-label="列表分页"><button type="button" className="outline-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={14} />上一页</button><span>第 {page} / {totalPages} 页 · 共 {total} 项</span><button type="button" className="outline-button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页<ChevronRight size={14} /></button></nav>;
}

function ProjectIndex({ projects, projectTemplates = EMPTY, onOpenProject, onCreateProject }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const projectIndex = useMemo(() => createProjectSearchIndex(projects), [projects]);
  const filtered = useMemo(() => filterProjectIndex(projectIndex, deferredQuery, status), [projectIndex, deferredQuery, status]);
  const pagination = useMemo(() => paginateWorkspaceItems(filtered, page, PROJECT_PAGE_SIZE), [filtered, page]);
  useEffect(() => { if (pagination.page !== page) setPage(pagination.page); }, [page, pagination.page]);
  return <section className="project-index-stage"><header className="workspace-section-head"><div><p className="eyebrow">Studio 项目</p><h2>继续创作</h2><span>双入口、单工作流：可以在 Studio 直接创建项目，也可以继续由 Agent 从自然语言创建。</span></div><button type="button" className="command-button" onClick={onCreateProject}><FolderKanban size={16} />新建项目</button></header><div className="workspace-list-toolbar"><label className="workspace-list-search"><Search size={15} /><input type="search" value={query} placeholder="搜索项目名称或说明" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{query && <IconButton label="清空项目搜索" onClick={() => { setQuery(''); setPage(1); }}><X size={14} /></IconButton>}</label><div className="workspace-list-filters" aria-label="项目状态">{[['active', '进行中'], ['archived', '已归档'], ['all', '全部']].map(([value, label]) => <button type="button" key={value} className={status === value ? 'is-active' : ''} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</div></div>{pagination.items.length ? <><div className="project-index-list">{pagination.items.map((project) => { const template = projectTemplates.find((option) => option.id === project.templateId); return <button type="button" key={project.id} onClick={() => onOpenProject(project.id)}><FolderKanban size={18} /><span><b>{project.name}</b><small>{statusLabel(project.status)}{template ? ' · ' + template.name : ''}{project.description ? ' · ' + project.description : ''}</small></span><span className="project-index-open">打开</span></button>; })}</div><ListPager page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} /></> : <div className="empty-stage"><FolderKanban size={30} strokeWidth={1.15} /><p>{projects.length ? '没有符合当前搜索与状态筛选的项目。' : '还没有项目。创作者可以直接在 Studio 新建项目，也可以回到 Agent 用自然语言创建。'}</p><button type="button" className="command-button" onClick={onCreateProject}><FolderKanban size={16} />创建第一个项目</button></div>}</section>;
}

function ManagedTaskList({ tasks, pageSize, actionLabel, emptyMessage, onOpenTask }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const taskIndex = useMemo(() => createTaskSearchIndex(tasks), [tasks]);
  const filtered = useMemo(() => filterTaskIndex(taskIndex, deferredQuery, status), [taskIndex, deferredQuery, status]);
  const pagination = useMemo(() => paginateWorkspaceItems(filtered, page, pageSize), [filtered, page, pageSize]);
  useEffect(() => { if (pagination.page !== page) setPage(pagination.page); }, [page, pagination.page]);
  return <><div className="workspace-list-toolbar is-task"><label className="workspace-list-search"><Search size={15} /><input type="search" value={query} placeholder="搜索任务名称" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{query && <IconButton label="清空任务搜索" onClick={() => { setQuery(''); setPage(1); }}><X size={14} /></IconButton>}</label><div className="workspace-list-filters" aria-label="任务状态">{[['open', '进行中'], ['completed', '已完成'], ['archived', '已归档'], ['all', '全部']].map(([value, label]) => <button type="button" key={value} className={status === value ? 'is-active' : ''} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</div></div>{pagination.items.length ? <><div className="project-task-list is-full">{pagination.items.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask(task.id)}><span><b>{task.name}</b><small>{taskPresentation(task).label}</small></span><span>{actionLabel}</span></button>)}</div><ListPager page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} /></> : <div className="empty-stage"><FolderKanban size={26} strokeWidth={1.15} /><p>{tasks.length ? '没有符合当前搜索与状态筛选的任务。' : emptyMessage}</p></div>}</>;
}

function ProjectOverview({ project, projectTemplates = EMPTY, tasks, selectedCount, onOpenTasks, onOpenAssets, onOpenDeliveries, onOpenTask, onCreateTask, onArchive }) {
  const archived = project.status === 'archived';
  const activeTasks = tasks.filter((task) => !['archived', 'completed'].includes(task.status));
  const recentTasks = (activeTasks.length ? activeTasks : tasks).slice(0, TASK_OVERVIEW_PAGE_SIZE);
  const template = projectTemplates.find((option) => option.id === project.templateId);
  return <section className="project-overview-stage">
    <header className="project-overview-head">
      <div><p className="eyebrow">项目概览</p><h2>继续当前工作</h2>{template && <small className="project-template-label">{template.name} · 模板 v{project.templateVersion || template.version || 1}</small>}</div>
      <div className="project-overview-actions"><StatusPill value={project.status} scope="project" />{!archived && <><button type="button" className="command-button" onClick={onCreateTask}><FolderKanban size={16} />新建任务</button><button type="button" className="outline-button" onClick={onArchive}>归档项目</button></>}</div>
    </header>
    <div className="project-status-strip"><button type="button" onClick={onOpenTasks}><span>任务</span><b>{tasks.length}</b><small>{activeTasks.length ? activeTasks.length + ' 个可继续' : '没有待处理任务'}</small></button><button type="button" onClick={onOpenAssets}><span>已选图片</span><b>{selectedCount}</b><small>用于交付的成果</small></button><button type="button" onClick={onOpenDeliveries}><span>交付</span><b>打开</b><small>下载与交付包</small></button></div>
    <section className="project-task-panel is-recent"><header><div><p className="eyebrow">最近任务</p><h3>选择一个目标</h3></div><div className="project-task-panel-actions"><button type="button" className="outline-button" onClick={onOpenTasks}>全部任务</button>{!archived && <button type="button" className="command-button" onClick={onCreateTask}>新建任务</button>}</div></header>{recentTasks.length ? <div className="project-task-list is-compact">{recentTasks.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask(task.id)}><span><b>{task.name}</b><small>{taskPresentation(task).label}</small></span><span>继续</span></button>)}</div> : <div className="empty-stage"><FolderKanban size={26} strokeWidth={1.15} /><p>{archived ? '项目已归档，没有可继续的任务。' : '这个项目还没有任务。可以直接在 Studio 新建任务，生成前仍由 Agent 整理计划。'}</p></div>}</section>
  </section>;
}

function ProjectTaskList({ project, tasks, onOpenTask, onCreateTask }) {
  return <section className="project-tasks-stage"><header className="workspace-section-head"><div><p className="eyebrow">{project.name}</p><h2>任务</h2><span>搜索、按状态筛选并分页管理每个独立创作目标。常用目标直接选择，特殊目标再自定义。</span></div>{project.status !== 'archived' && <button type="button" className="command-button" onClick={onCreateTask}><FolderKanban size={16} />新建任务</button>}</header><ManagedTaskList tasks={tasks} pageSize={TASK_PAGE_SIZE} actionLabel="查看轮次" emptyMessage="这个项目还没有任务。创作者可以在 Studio 直接新建任务，并把它设为当前工作上下文。" onOpenTask={onOpenTask} /></section>;
}



function WorkspaceContextBar({ project, tasks = EMPTY, task, rounds, selectedRound, view, assetScope, sessionPlanStatus, onProject, onTasks, onSelectTask, onSelectRound, onCreateRound, onNavigate, onRestoreContext }) {
  if (!project || ['project-overview', 'tasks'].includes(view)) return null;
  const scopedAssetTarget = selectedRound ? 'round' : task ? 'task' : 'project';
  const roundOptions = selectedRound && !rounds.some((round) => round.id === selectedRound.id) ? [selectedRound, ...rounds] : rounds;
  const roundTaskLabel = (round) => !task && round?.taskId ? tasks.find((item) => item.id === round.taskId)?.name : '';
  return <div className="workspace-context">
    <button type="button" className="workspace-context-project" onClick={onProject}><span>项目</span><b title={project.name}>{project.name}</b></button>
    <label className="workspace-context-select workspace-context-task"><span>任务</span><select value={task?.id || ''} onChange={(event) => onSelectTask(event.target.value || null)}><option value="">选择任务</option>{tasks.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <button type="button" className="outline-button context-task-list" onClick={onTasks}><GitFork size={14} />任务列表</button>
    <label className="workspace-context-select workspace-context-round"><span>轮次</span><select value={selectedRound?.id || ''} disabled={!roundOptions.length} onChange={(event) => onSelectRound(event.target.value || null)}><option value="">选择轮次</option>{roundOptions.map((round) => { const taskLabel = roundTaskLabel(round); return <option value={round.id} key={round.id}>{taskLabel ? taskLabel + ' / ' : ''}{ROUND_PURPOSE_LABELS[round.purpose] || round.purpose} · 计划 v{round.planVersion}</option>; })}</select></label>
    <button type="button" className="outline-button context-create-round" disabled={!task} title={task ? '在当前任务中新建轮次' : '先选择任务再新建轮次'} onClick={onCreateRound}><Sparkles size={14} />新建轮次</button>
    <div className="task-local-tabs" aria-label="任务工作入口">
      <button type="button" className={view === 'prompts' ? 'is-active' : ''} disabled={!selectedRound} onClick={() => onNavigate('prompts', { assetScope: 'round' })}>计划</button>
      <button type="button" className={view === 'runs' ? 'is-active' : ''} disabled={!selectedRound} onClick={() => onNavigate('runs', { assetScope: 'round' })}>生成历史</button>
      <button type="button" className={view === 'assets' ? 'is-active' : ''} onClick={() => onNavigate('assets', { assetScope: scopedAssetTarget })}>结果</button>
      <button type="button" className={view === 'lineage' ? 'is-active' : ''} onClick={() => onNavigate('lineage', { assetScope: scopedAssetTarget })}>谱系</button>
      <button type="button" className={view === 'studio-overview' ? 'is-active' : ''} disabled={!task} onClick={() => onNavigate('studio-overview', { assetScope: 'task' })}>轮次对比</button>
    </div>
    <SessionPlanSummary sessionPlanStatus={sessionPlanStatus} onRestoreContext={onRestoreContext} />
  </div>;
}

function CreationError({ error }) {
  return error ? <div className="creation-form-error" role="alert" aria-live="assertive"><CircleAlert size={15} /><span>{error}</span></div> : null;
}

function ProjectCreationDialog({ projectTemplates = PROJECT_CREATION_TEMPLATES, busy, error, onDismiss, onCreate }) {
  const initialTemplate = projectTemplates[0] || PROJECT_CREATION_TEMPLATES[0];
  const [templateId, setTemplateId] = useState(initialTemplate?.id || 'custom');
  const [name, setName] = useState(projectTemplateDefaultName(initialTemplate));
  const [description, setDescription] = useState('');
  const selectedTemplate = projectTemplates.find((option) => option.id === templateId) || initialTemplate || PROJECT_CREATION_TEMPLATES[0];
  const selectedName = projectTemplateName(selectedTemplate);
  const descriptionExamples = listItems(selectedTemplate.exampleDescriptions);
  const materialNeeds = materialNeedsForTemplate(selectedTemplate);
  const chooseTemplate = (option) => {
    const previous = selectedTemplate;
    setTemplateId(option.id);
    setIfEmptyOrDefault(setName, projectTemplateDefaultName(previous), projectTemplateDefaultName(option));
    setDescription((current) => !current.trim() || current.trim() === previous.description ? '' : current);
  };
  const submit = (event) => {
    event.preventDefault();
    onCreate({ templateId, templateVersion: selectedTemplate.version || 1, templateName: selectedName, name: name.trim(), description: description.trim() || selectedTemplate.description, materialNeeds });
  };
  return <AccessibleDialog className="creation-dialog" label="新建项目" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">Studio 直接创建</p><h2>新建项目</h2><span>先选项目类型，Studio 会带出模板信息和必要上下文。这里只建立结构化上下文，不会调用 Provider。</span></div><IconButton label="关闭新建项目" onClick={onDismiss}><X size={16} /></IconButton></header>
      <section className="creation-section"><h3>选择项目类型</h3><div className="creation-choice-grid" role="radiogroup" aria-label="项目类型">{projectTemplates.map((option) => <button type="button" key={option.id} className={templateId === option.id ? 'is-active' : ''} aria-pressed={templateId === option.id} onClick={() => chooseTemplate(option)}><b>{projectTemplateName(option)}</b><span>{option.description}</span></button>)}</div></section>
      <section className="creation-section creation-selection-detail"><div><b>{selectedName}</b><span>{selectedTemplate.description}</span></div><div className="creation-detail-grid"><span><strong>推荐任务</strong>{listItems(selectedTemplate.recommendedTasks).join('、') || '根据项目说明由 Agent 判断'}</span><span><strong>推荐画幅</strong>{listItems(selectedTemplate.aspectRatios).join('、') || '由 Agent 判断'}</span><span><strong>参考提示</strong>{selectedTemplate.referenceHint || '可在创建后从当前项目素材中选择参考。'}</span></div><CreationInfoList label="优先准备的素材" items={materialNeeds} /></section>
      <section className="creation-section"><h3>基础信息</h3><label><span>项目名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：茶饮新品夏季视觉" autoFocus /><small>已按所选模板填入默认名称，可直接改成客户、品牌或产品名。</small></label><label><span>项目说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={selectedTemplate.descriptionPrompt || '说明客户、产品、使用渠道或交付目标。'} /></label><CreationSuggestionChips label="项目说明示例" options={descriptionExamples} onChoose={setDescription} /></section>
      <section className="creation-summary"><p className="eyebrow">创建摘要</p><strong>{name.trim() || '未填写项目名称'}</strong><span>{selectedName} · 模板 v{selectedTemplate.version || 1}</span><span>{description.trim() || selectedTemplate.description}</span></section>
      <p className="creation-hint">创建后会打开该项目，并设为当前 Studio 标签页上下文；后续可在项目工作区继续新建任务、导入素材或整理计划。</p><CreationError error={error} /><footer><button type="button" className="outline-button" onClick={onDismiss} disabled={busy}>取消</button><button type="submit" className="command-button" disabled={busy || !name.trim()}>{busy ? '正在创建' : '创建项目'}</button></footer>
    </form>
  </AccessibleDialog>;
}

function toggleChoice(values, value) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function libraryDefinitionSummary(item, fallback) {
  return item?.definition?.summary || item?.definition?.description || fallback;
}

function CreationChoiceList({ label, values, options, onChange }) {
  return <div className="creation-choice-list"><span>{label}</span><div>{options.map((option) => <label key={option}><input type="checkbox" checked={values.includes(option)} onChange={() => onChange(toggleChoice(values, option))} /><span>{option}</span></label>)}</div></div>;
}

function TaskCreationDialog({ project, projectTemplates = PROJECT_CREATION_TEMPLATES, taskTypes, styleKits, brandKits, busy, error, onDismiss, onCreate }) {
  const selectedProjectTemplate = projectTemplateForProject(project, projectTemplates);
  const taskGoalOptions = useMemo(() => taskGoalsForProjectTemplate(selectedProjectTemplate), [selectedProjectTemplate]);
  const initialGoal = taskGoalOptions[0] || TASK_CREATION_GOALS[0];
  const [goalId, setGoalId] = useState(initialGoal.id);
  const selectedGoal = taskGoalOptions.find((option) => option.id === goalId) || initialGoal;
  const [name, setName] = useState(initialGoal.defaultName);
  const [taskTypeId, setTaskTypeId] = useState('');
  const [targetCount, setTargetCount] = useState(initialGoal.defaultCount || '');
  const [aspectRatio, setAspectRatio] = useState(initialGoal.defaultAspectRatio || '');
  const [styleKitId, setStyleKitId] = useState('');
  const [brandKitId, setBrandKitId] = useState('');
  const [brief, setBrief] = useState('');
  const [variationAxes, setVariationAxes] = useState(listItems(initialGoal.defaultVariationAxes));
  const [keepConstraints, setKeepConstraints] = useState(listItems(initialGoal.defaultKeepConstraints));
  const [refinementGoals, setRefinementGoals] = useState(listItems(initialGoal.defaultRefinementGoals));
  const [editInstruction, setEditInstruction] = useState('');
  const [preserveInstruction, setPreserveInstruction] = useState('');
  const [createRound, setCreateRound] = useState(true);
  const [roundPurpose, setRoundPurpose] = useState(initialGoal.roundPurpose);
  const selectedTaskType = taskTypes.find((item) => item.id === taskTypeId) || null;
  const selectedStyleKit = styleKits.find((item) => item.id === styleKitId) || null;
  const selectedBrandKit = brandKits.find((item) => item.id === brandKitId) || null;
  const selectedRoundPurpose = ROUND_CREATION_PURPOSES.find((option) => option.id === roundPurpose) || ROUND_CREATION_PURPOSES[0];
  const materialNeeds = listItems(selectedGoal.materialNeeds);
  const projectTemplateLabel = selectedProjectTemplate ? projectTemplateName(selectedProjectTemplate) : '未绑定项目模板';
  const chooseGoal = (option) => {
    const previous = selectedGoal;
    setGoalId(option.id);
    setIfEmptyOrDefault(setName, previous.defaultName, option.defaultName);
    setIfEmptyOrDefault(setTargetCount, previous.defaultCount, option.defaultCount);
    setIfEmptyOrDefault(setAspectRatio, previous.defaultAspectRatio, option.defaultAspectRatio);
    setRoundPurpose(option.roundPurpose);
    setVariationAxes(listItems(option.defaultVariationAxes));
    setKeepConstraints(listItems(option.defaultKeepConstraints));
    setRefinementGoals(listItems(option.defaultRefinementGoals));
  };
  const applyRecommendedDefaults = () => {
    setTargetCount(selectedGoal.defaultCount || '');
    setAspectRatio(selectedGoal.defaultAspectRatio || '');
    setRoundPurpose(selectedGoal.roundPurpose);
    setVariationAxes(listItems(selectedGoal.defaultVariationAxes));
    setKeepConstraints(listItems(selectedGoal.defaultKeepConstraints));
    setRefinementGoals(listItems(selectedGoal.defaultRefinementGoals));
  };
  const submit = (event) => {
    event.preventDefault();
    const count = targetCount ? Number(targetCount) : undefined;
    const context = compactRecord({ projectTemplateId: selectedProjectTemplate?.id, projectTemplateName: selectedProjectTemplate ? projectTemplateName(selectedProjectTemplate) : undefined, goalType: goalId, goalLabel: selectedGoal.label, templateRecommended: selectedGoal.templateRecommended, recommendedInputs: listItems(selectedGoal.recommendedInputs), materialNeeds, brief: brief.trim(), targetCount: count, aspectRatio, taskTypeId, taskTypeName: selectedTaskType?.name, styleKitId, styleKitName: selectedStyleKit?.name, brandKitId, brandKitName: selectedBrandKit?.name, variationAxes, keepConstraints, refinementGoals, editInstruction: editInstruction.trim(), preserveInstruction: preserveInstruction.trim() });
    const intent = compactRecord({ createdFrom: 'workbench', ...context });
    const plan = compactRecord({ createdFrom: 'workbench', draftKind: 'studio-task-context', roundPurposeLabel: selectedRoundPurpose.label, ...context, note: 'Studio 创建的结构化上下文草稿；生成前仍需 Agent 形成可确认计划。' });
    onCreate({ name: name.trim(), goalLabel: selectedGoal.label, projectTemplateId: selectedProjectTemplate?.id, projectTemplateName: selectedProjectTemplate ? projectTemplateName(selectedProjectTemplate) : undefined, materialNeeds, taskTypeId, styleKitId, brandKitId, intent, createRound, roundPurpose, roundPurposeLabel: selectedRoundPurpose.label, plan });
  };
  const quickBriefs = listItems(selectedGoal.quickBriefs);
  const briefPlaceholder = quickBriefs[0] || '例如：说明目标、输入素材、限制条件和交付用途。';
  return <AccessibleDialog className="creation-dialog is-wide" label="新建任务" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">{project.name}</p><h2>新建任务</h2><span>{selectedProjectTemplate ? '已根据“' + projectTemplateLabel + '”项目模板重排任务目标，并套用不同数量、画幅和素材需求。' : '未绑定项目模板，使用通用任务目标。'} Studio 只创建草稿上下文，不会启动生成。</span></div><IconButton label="关闭新建任务" onClick={onDismiss}><X size={16} /></IconButton></header>
      <section className="creation-template-bridge"><div><p className="eyebrow">项目模板联动</p><strong>{projectTemplateLabel}</strong><span>{selectedProjectTemplate ? selectedProjectTemplate.referenceHint : '可以先从项目详情补充模板或直接用自定义任务。'}</span></div><CreationInfoList label="该项目类型常用任务" items={selectedProjectTemplate?.recommendedTasks} /></section>
      <section className="creation-section"><h3>你现在想做什么？</h3><div className="creation-choice-grid is-goal" role="radiogroup" aria-label="任务目标">{taskGoalOptions.map((option) => <button type="button" key={option.id} className={goalId === option.id ? 'is-active' : ''} aria-pressed={goalId === option.id} onClick={() => chooseGoal(option)}><b>{option.label}</b><span>{option.description}</span>{option.templateRecommended && <small>模板推荐 · {creationDefaultSummary(option)}</small>}</button>)}</div></section>
      <section className="creation-section creation-selection-detail"><div><b>{selectedGoal.label}</b><span>{selectedGoal.description}</span></div><div className="creation-detail-grid"><span><strong>模板推荐默认值</strong>{creationDefaultSummary(selectedGoal)}</span><span><strong>首个轮次</strong>{selectedRoundPurpose.label}</span><span><strong>需要补充</strong>{listItems(selectedGoal.recommendedInputs).join('、') || '无固定字段'}</span><span><strong>素材需求</strong>{materialNeeds.join('、') || '可创建后再导入素材'}</span></div><CreationInfoList label="建议先准备的素材" items={materialNeeds} /><button type="button" className="outline-button creation-apply-defaults" onClick={applyRecommendedDefaults}>套用推荐默认值</button></section>
      <section className="creation-section is-two-columns"><label><span>任务名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={selectedGoal.defaultName} autoFocus /><small>默认名称来自当前项目模板，建议改成“对象 + 目标”。</small></label><label><span>任务类型</span><select value={taskTypeId} onChange={(event) => setTaskTypeId(event.target.value)}><option value="">不绑定任务类型</option>{taskTypes.map((type) => <option value={type.id} key={type.id}>{type.name}{type.source === 'official' ? ' · 官方' : ' · 自定义'}</option>)}</select><small>{taskTypes.length ? '选择后会把该类型的字段建议带入上下文。' : '暂无任务类型；可先创建任务，稍后在资料库补充。'}</small></label><label><span>目标数量</span><select value={targetCount} onChange={(event) => setTargetCount(event.target.value)}>{CREATION_COUNT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value ? value + ' 张' : '让 Agent 决定'}</option>)}</select></label><label><span>画幅</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{CREATION_ASPECT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value || '让 Agent 决定'}</option>)}</select></label><label><span>风格包</span><select value={styleKitId} onChange={(event) => setStyleKitId(event.target.value)}><option value="">不绑定风格包</option>{styleKits.map((kit) => <option value={kit.id} key={kit.id}>{kit.name}</option>)}</select><small>可选；用于固定画风、质感和关键词。</small></label><label><span>品牌包</span><select value={brandKitId} onChange={(event) => setBrandKitId(event.target.value)}><option value="">不绑定品牌包</option>{brandKits.map((kit) => <option value={kit.id} key={kit.id}>{kit.name}</option>)}</select><small>可选；用于品牌色、Logo 和禁忌约束。</small></label></section>
      {(selectedTaskType || selectedStyleKit || selectedBrandKit) && <section className="creation-section creation-selection-detail"><div className="creation-detail-grid">{selectedTaskType && <span><strong>任务类型</strong>{libraryDefinitionSummary(selectedTaskType, selectedTaskType.name)}{Array.isArray(selectedTaskType.definition?.fields) && selectedTaskType.definition.fields.length > 0 && <small>建议信息：{selectedTaskType.definition.fields.join('、')}</small>}</span>}{selectedStyleKit && <span><strong>风格包：{selectedStyleKit.name}</strong>{libraryDefinitionSummary(selectedStyleKit, '将作为风格约束供 Agent 参考。')}</span>}{selectedBrandKit && <span><strong>品牌包：{selectedBrandKit.name}</strong>{libraryDefinitionSummary(selectedBrandKit, '将作为品牌约束供 Agent 参考。')}</span>}</div></section>}
      {goalId === 'variation' && <section className="creation-section"><CreationChoiceList label="希望变化的维度" values={variationAxes} options={DERIVED_VARIATION_AXES} onChange={setVariationAxes} /><CreationChoiceList label="希望保持不变" values={keepConstraints} options={DERIVED_KEEP_CONSTRAINTS} onChange={setKeepConstraints} /></section>}
      {goalId === 'refinement' && <section className="creation-section"><CreationChoiceList label="希望精修的目标" values={refinementGoals} options={DERIVED_REFINEMENT_GOALS} onChange={setRefinementGoals} /><CreationChoiceList label="希望保持不变" values={keepConstraints} options={DERIVED_KEEP_CONSTRAINTS} onChange={setKeepConstraints} /></section>}
      {goalId === 'edit' && <section className="creation-section is-two-columns"><label><span>要修改什么</span><textarea value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} placeholder="例如：替换背景中的植物和文字区域。" /></label><label><span>哪些内容保持不变</span><textarea value={preserveInstruction} onChange={(event) => setPreserveInstruction(event.target.value)} placeholder="例如：人物身份、产品轮廓、Logo 和主体光线。" /></label></section>}
      <section className="creation-section"><label><span>创作意图 <small>可选；自定义要求请写清输入、限制和使用渠道</small></span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={briefPlaceholder} /></label><CreationSuggestionChips options={quickBriefs} onChoose={setBrief} /><p className="creation-hint">Agent 会在后续会话中把项目模板、素材需求和任务目标整理为可审阅的生成计划；这里不会把文本直接发送给 Provider。</p></section>
      <section className="creation-inline-option"><label><input type="checkbox" checked={createRound} onChange={(event) => setCreateRound(event.target.checked)} /><span>同时创建首个轮次并设为当前上下文</span></label>{createRound && <select value={roundPurpose} onChange={(event) => setRoundPurpose(event.target.value)} aria-label="首个轮次目的">{ROUND_CREATION_PURPOSES.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select>}</section>
      <section className="creation-summary"><p className="eyebrow">创建摘要</p><strong>{name.trim() || '未填写任务名称'}</strong><span>{projectTemplateLabel} · {selectedGoal.label} · {targetCount ? targetCount + ' 张' : '数量由 Agent 决定'} · {aspectRatio || '画幅由 Agent 决定'}</span><span>{materialNeeds.length ? '素材需求：' + materialNeeds.join('、') : '暂无固定素材需求'}</span><span>{selectedTaskType?.name || '未绑定任务类型'} · {selectedStyleKit?.name || '未绑定风格包'} · {selectedBrandKit?.name || '未绑定品牌包'}</span><span>{createRound ? '会创建“' + selectedRoundPurpose.label + '”草稿轮次' : '只创建任务，不创建轮次'}</span></section>
      <CreationError error={error} /><footer><button type="button" className="outline-button" onClick={onDismiss} disabled={busy}>取消</button><button type="submit" className="command-button" disabled={busy || !name.trim()}>{busy ? '正在创建' : '创建任务'}</button></footer>
    </form>
  </AccessibleDialog>;
}


function RoundCreationDialog({ task, rounds, currentRound, busy, error, onDismiss, onCreate }) {
  const initialPurposeId = currentRound ? 'variation' : 'exploration';
  const initialPurpose = ROUND_CREATION_PURPOSES.find((option) => option.id === initialPurposeId) || ROUND_CREATION_PURPOSES[0];
  const [purpose, setPurpose] = useState(initialPurposeId);
  const [parentRoundId, setParentRoundId] = useState(currentRound?.id || '');
  const [targetCount, setTargetCount] = useState(initialPurpose.defaultCount || '');
  const [aspectRatio, setAspectRatio] = useState(initialPurpose.defaultAspectRatio || '');
  const [brief, setBrief] = useState('');
  const [variationAxes, setVariationAxes] = useState(listItems(initialPurpose.defaultVariationAxes));
  const [keepConstraints, setKeepConstraints] = useState(listItems(initialPurpose.defaultKeepConstraints));
  const [refinementGoals, setRefinementGoals] = useState(listItems(initialPurpose.defaultRefinementGoals));
  const [editInstruction, setEditInstruction] = useState('');
  const [preserveInstruction, setPreserveInstruction] = useState('');
  const [fillInstruction, setFillInstruction] = useState('');
  const [fillPreserveInstruction, setFillPreserveInstruction] = useState('');
  const selectedPurpose = ROUND_CREATION_PURPOSES.find((option) => option.id === purpose) || ROUND_CREATION_PURPOSES[0];
  const choosePurpose = (option) => {
    const previous = selectedPurpose;
    setPurpose(option.id);
    setIfEmptyOrDefault(setTargetCount, previous.defaultCount, option.defaultCount);
    setIfEmptyOrDefault(setAspectRatio, previous.defaultAspectRatio, option.defaultAspectRatio);
    setVariationAxes(listItems(option.defaultVariationAxes));
    setKeepConstraints(listItems(option.defaultKeepConstraints));
    setRefinementGoals(listItems(option.defaultRefinementGoals));
  };
  const applyRecommendedDefaults = () => {
    setTargetCount(selectedPurpose.defaultCount || '');
    setAspectRatio(selectedPurpose.defaultAspectRatio || '');
    setVariationAxes(listItems(selectedPurpose.defaultVariationAxes));
    setKeepConstraints(listItems(selectedPurpose.defaultKeepConstraints));
    setRefinementGoals(listItems(selectedPurpose.defaultRefinementGoals));
  };
  const quickBriefs = listItems(selectedPurpose.quickBriefs);
  const briefPlaceholder = quickBriefs[0] || '例如：说明本轮目标、输入素材、限制条件和交付用途。';
  const shouldSuggestParent = ['variation', 'refinement', 'edit', 'fill'].includes(purpose) && !parentRoundId;
  const submit = (event) => {
    event.preventDefault();
    const count = targetCount ? Number(targetCount) : undefined;
    const plan = compactRecord({ createdFrom: 'workbench', draftKind: 'studio-round-context', purposeLabel: selectedPurpose.label, recommendedInputs: listItems(selectedPurpose.recommendedInputs), brief: brief.trim(), targetCount: count, aspectRatio, parentRoundId, variationAxes, keepConstraints, refinementGoals, editInstruction: editInstruction.trim(), preserveInstruction: preserveInstruction.trim(), fillInstruction: fillInstruction.trim(), fillPreserveInstruction: fillPreserveInstruction.trim(), note: 'Studio 创建的轮次上下文草稿；生成前仍需 Agent 形成可确认计划。' });
    onCreate({ purpose, purposeLabel: selectedPurpose.label, parentRoundId, plan });
  };
  return <AccessibleDialog className="creation-dialog is-wide" label="新建轮次" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">{task.name}</p><h2>新建轮次</h2><span>选择这次创作要完成的事情，Studio 会给出推荐默认值、父轮次提示和示例文本。这里创建的是草稿上下文，不会启动生成。</span></div><IconButton label="关闭新建轮次" onClick={onDismiss}><X size={16} /></IconButton></header>
      <section className="creation-section"><h3>选择轮次目的</h3><div className="creation-choice-grid" role="radiogroup" aria-label="轮次目的">{ROUND_CREATION_PURPOSES.map((option) => <button type="button" key={option.id} className={purpose === option.id ? 'is-active' : ''} aria-pressed={purpose === option.id} onClick={() => choosePurpose(option)}><b>{option.label}</b><span>{option.description}</span></button>)}</div></section>
      <section className="creation-section creation-selection-detail"><div><b>{selectedPurpose.label}</b><span>{selectedPurpose.description}</span></div><div className="creation-detail-grid"><span><strong>推荐默认值</strong>{creationDefaultSummary(selectedPurpose)}</span><span><strong>父轮次提示</strong>{shouldSuggestParent ? '建议绑定父轮次或从资产节点发起。' : parentRoundId ? '已绑定父轮次。' : '可作为新的探索起点。'}</span><span><strong>需要补充</strong>{listItems(selectedPurpose.recommendedInputs).join('、') || '无固定字段'}</span></div><button type="button" className="outline-button creation-apply-defaults" onClick={applyRecommendedDefaults}>套用推荐默认值</button></section>
      <section className="creation-section is-two-columns"><label><span>父轮次</span><select value={parentRoundId} onChange={(event) => setParentRoundId(event.target.value)}><option value="">不绑定父轮次</option>{rounds.map((round) => <option value={round.id} key={round.id}>{ROUND_PURPOSE_LABELS[round.purpose] || round.purpose} · 计划 v{round.planVersion}</option>)}</select><small>{shouldSuggestParent ? '变体、精修、局部修改和补图通常需要父轮次或父资产。' : '探索轮次可以不绑定父轮次。'}</small></label><label><span>目标数量</span><select value={targetCount} onChange={(event) => setTargetCount(event.target.value)}>{CREATION_COUNT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value ? value + ' 张' : '让 Agent 决定'}</option>)}</select></label><label><span>画幅</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{CREATION_ASPECT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value || '沿用任务/由 Agent 决定'}</option>)}</select></label></section>
      {purpose === 'variation' && <section className="creation-section"><CreationChoiceList label="希望变化的维度" values={variationAxes} options={DERIVED_VARIATION_AXES} onChange={setVariationAxes} /><CreationChoiceList label="希望保持不变" values={keepConstraints} options={DERIVED_KEEP_CONSTRAINTS} onChange={setKeepConstraints} /></section>}
      {purpose === 'refinement' && <section className="creation-section"><CreationChoiceList label="希望精修的目标" values={refinementGoals} options={DERIVED_REFINEMENT_GOALS} onChange={setRefinementGoals} /><CreationChoiceList label="希望保持不变" values={keepConstraints} options={DERIVED_KEEP_CONSTRAINTS} onChange={setKeepConstraints} /></section>}
      {purpose === 'edit' && <section className="creation-section is-two-columns"><label><span>要修改什么</span><textarea value={editInstruction} onChange={(event) => setEditInstruction(event.target.value)} placeholder="例如：替换背景中的植物和文字区域。" /></label><label><span>哪些内容保持不变</span><textarea value={preserveInstruction} onChange={(event) => setPreserveInstruction(event.target.value)} placeholder="例如：人物身份、产品轮廓、Logo 和主体光线。" /></label></section>}
      {purpose === 'fill' && <section className="creation-section is-two-columns"><label><span>扩展或补充方向</span><textarea value={fillInstruction} onChange={(event) => setFillInstruction(event.target.value)} placeholder="例如：向左右扩展环境，补齐桌面和背景留白。" /></label><label><span>补图时保持不变</span><textarea value={fillPreserveInstruction} onChange={(event) => setFillPreserveInstruction(event.target.value)} placeholder="例如：主体位置、产品比例、光影方向不变。" /></label></section>}
      <section className="creation-section"><label><span>本轮目标 <small>可选；特殊要求请说明输入、限制和交付用途</small></span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={briefPlaceholder} /></label><CreationSuggestionChips options={quickBriefs} onChoose={setBrief} /><p className="creation-hint">后续由 Agent 把轮次上下文整理为可审阅计划；Studio 不会把这段文字直接发送给 Provider。</p></section>
      <section className="creation-summary"><p className="eyebrow">创建摘要</p><strong>{selectedPurpose.label}</strong><span>{targetCount ? targetCount + ' 张' : '数量由 Agent 决定'} · {aspectRatio || '画幅由 Agent 决定'}</span><span>{parentRoundId ? '已绑定父轮次' : '不绑定父轮次'} · 草稿轮次</span></section>
      <CreationError error={error} /><footer><button type="button" className="outline-button" onClick={onDismiss} disabled={busy}>取消</button><button type="submit" className="command-button" disabled={busy}>{busy ? '正在创建' : '创建轮次'}</button></footer>
    </form>
  </AccessibleDialog>;
}



function ReferenceAssetPanel({ round, referenceAssets, busy, error, onOpenSelector, onPreview, onRemove }) {
  if (!round) return null;
  const materials = normalizeReferenceMaterials(round.plan || {});
  const assetsById = new Map(referenceAssets.map((asset) => [asset.id, asset]));
  const editable = round.status === 'draft';
  return <section className="reference-panel" aria-label="本轮参考素材">
    <header>
      <div>
        <p className="eyebrow">参考素材</p>
        <h3>{materials.length ? materials.length + ' 张已挂载' : '尚未挂载参考素材'}</h3>
        <span>{editable ? '可以直接从项目素材或共享素材选择；生成前仍由 Agent 整理并确认计划。' : '当前轮次已进入确认或运行流程，参考素材请回到 Agent 修改计划。'}</span>
      </div>
      <button type="button" className="command-button" disabled={!editable || busy} onClick={onOpenSelector}><ImagePlus size={16} />{materials.length ? '管理参考素材' : '添加参考素材'}</button>
    </header>
    {materials.length ? <div className="reference-chip-list">{materials.map((item) => {
      const asset = assetsById.get(item.assetId);
      return <article className="reference-chip" key={item.assetId}>
        {asset ? <button type="button" className="reference-chip-preview" onClick={() => onPreview([asset])} aria-label="预览参考素材"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button> : <span className="reference-chip-missing"><ImageIcon size={16} /></span>}
        <div><b>{REFERENCE_USAGE_LABELS[item.usage] || item.usage}</b><span>{asset?.display?.label || item.assetId}</span>{item.note && <small>{item.note}</small>}</div>
        {editable && <IconButton label="移除参考素材" onClick={() => onRemove(item.assetId)} disabled={busy}><X size={14} /></IconButton>}
      </article>;
    })}</div> : <div className="reference-empty"><ImagePlus size={18} /><span>先挂主体、风格、构图、色彩或遮罩参考，再回到 Agent 生成可确认计划。</span></div>}
    {error && <div className="creation-form-error" role="alert" aria-live="assertive"><CircleAlert size={15} /><span>{error}</span></div>}
  </section>;
}

function ReferenceAssetDialog({ project, task, round, sharedAssets, selectedMaterials, busy, error, onDismiss, onSave, onPreview }) {
  const pageSize = 24;
  const [scope, setScope] = useState('project');
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [candidates, setCandidates] = useState(EMPTY);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState(() => new Map(selectedMaterials.map((item) => [item.assetId, { ...item }])));
  useEffect(() => {
    if (scope === 'shared') {
      setCandidates(EMPTY);
      setTotal(sharedAssets.length);
      setLoading(false);
      setLoadError('');
      return undefined;
    }
    let cancelled = false;
    const params = new URLSearchParams({ scope, limit: String(pageSize), offset: String((page - 1) * pageSize) });
    if (project?.id) params.set('projectId', project.id);
    if (task?.id) params.set('taskId', task.id);
    if (round?.id) params.set('roundId', round.id);
    if (kind !== 'all') params.set('kind', kind);
    setLoading(true);
    setLoadError('');
    api('/api/assets?' + params.toString()).then((data) => {
      if (cancelled) return;
      setCandidates(data.assets || EMPTY);
      setTotal(data.total || 0);
    }).catch((nextError) => {
      if (!cancelled) setLoadError(nextError.message || '无法读取素材列表。');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [scope, kind, page, project?.id, task?.id, round?.id, sharedAssets.length]);
  useEffect(() => { setPage(1); }, [scope, kind]);
  const sourceAssets = scope === 'shared' ? sharedAssets : candidates;
  const listedAssets = sourceAssets.filter((asset) => !asset.deletedAt && (kind === 'all' || asset.kind === kind) && assetMatchesQuery(asset, query));
  const visibleAssetById = new Map(sourceAssets.map((asset) => [asset.id, asset]));
  const totalPages = scope === 'shared' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const setMaterial = (asset, patch = {}) => setDraft((current) => {
    const next = new Map(current);
    const existing = next.get(asset.id);
    next.set(asset.id, { assetId: asset.id, usage: patch.usage || existing?.usage || 'subject', note: patch.note ?? existing?.note ?? '' });
    return next;
  });
  const toggleAsset = (asset) => setDraft((current) => {
    const next = new Map(current);
    if (next.has(asset.id)) next.delete(asset.id);
    else next.set(asset.id, { assetId: asset.id, usage: 'subject', note: '' });
    return next;
  });
  const selected = [...draft.values()];
  return <AccessibleDialog className="reference-dialog" label="选择参考素材" onDismiss={onDismiss}>
    <div className="reference-dialog-body">
      <header><div><p className="eyebrow">{project.name} / {task.name}</p><h2>选择本轮参考素材</h2><span>选择素材并标注用途。Studio 只保存结构化上下文，不会调用 Provider。</span></div><IconButton label="关闭参考素材选择" onClick={onDismiss}><X size={16} /></IconButton></header>
      <section className="reference-toolbar" aria-label="素材筛选">
        <div className="workspace-list-filters">{[['project', '当前项目'], ['task', '当前任务'], ['round', '当前轮次'], ['shared', '共享素材']].map(([value, label]) => <button type="button" key={value} className={scope === value ? 'is-active' : ''} disabled={(value === 'task' && !task) || (value === 'round' && !round)} onClick={() => setScope(value)}>{label}</button>)}</div>
        <label className="workspace-list-search"><Search size={15} /><input type="search" value={query} placeholder="搜索当前页素材名称、任务或 ID" onChange={(event) => setQuery(event.target.value)} />{query && <IconButton label="清空素材搜索" onClick={() => setQuery('')}><X size={14} /></IconButton>}</label>
        <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="素材类型"><option value="all">全部素材</option><option value="import">导入素材</option><option value="generated">生成结果</option></select>

      </section>
      <section className="reference-selected"><h3>已选 {selected.length} 张</h3>{selected.length ? <div>{selected.map((item) => {
        const asset = visibleAssetById.get(item.assetId);
        return <article key={item.assetId}><span>{asset?.display?.label || item.assetId}</span><select value={item.usage} onChange={(event) => setDraft((current) => { const next = new Map(current); next.set(item.assetId, { ...item, usage: event.target.value }); return next; })}>{REFERENCE_USAGE_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select><input value={item.note || ''} onChange={(event) => setDraft((current) => { const next = new Map(current); next.set(item.assetId, { ...item, note: event.target.value }); return next; })} placeholder="选填：说明希望 Agent 如何理解这张图" /><IconButton label="移除已选参考素材" onClick={() => setDraft((current) => { const next = new Map(current); next.delete(item.assetId); return next; })}><X size={14} /></IconButton></article>;
      })}</div> : <p>点击下方素材即可加入；如果选择“自定义”方向，请在备注里说明用途。</p>}</section>
      <section className="reference-candidates" aria-busy={loading}>
        {loading ? <div className="empty-stage"><RefreshCw className="spin" size={22} /><p>正在读取素材</p></div> : loadError ? <div className="creation-form-error" role="alert"><CircleAlert size={15} /><span>{loadError}</span></div> : listedAssets.length ? <div className="reference-candidate-grid">{listedAssets.map((asset) => {
          const active = draft.has(asset.id);
          return <article className={'reference-candidate ' + (active ? 'is-active' : '')} key={asset.id}><button type="button" onClick={() => toggleAsset(asset)} aria-pressed={active}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /><span><b>{asset.display?.label || (asset.kind === 'generated' ? '生成结果' : '导入素材')}</b><small>{active ? '已选为参考素材' : '点击加入参考素材'}</small></span></button><IconButton label="预览素材" onClick={() => onPreview([asset])}><Eye size={14} /></IconButton>{active && <select value={draft.get(asset.id)?.usage || 'subject'} onChange={(event) => setMaterial(asset, { usage: event.target.value })} aria-label="参考用途">{REFERENCE_USAGE_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select>}</article>;
        })}</div> : <div className="empty-stage"><ImagePlus size={24} /><p>{query ? '没有符合搜索条件的素材。' : '当前范围没有可用素材。可以先在项目素材页导入，再回来选择。'}</p></div>}
      </section>
      {scope !== 'shared' && <ListPager page={page} totalPages={totalPages} total={total} onPageChange={setPage} />}
      <CreationError error={error} />
      <footer><button type="button" className="outline-button" disabled={busy} onClick={onDismiss}>取消</button><button type="button" className="command-button" disabled={busy} onClick={() => onSave(selected)}>{busy ? '正在保存' : '保存参考素材'}</button></footer>
    </div>
  </AccessibleDialog>;
}
function ReferenceRoundResolverDialog({ project, task = null, tasks = EMPTY, draftRounds, assets, usage, busy, error, onDismiss, onUseRound, onSelectTask, onCreateRound, onPreview }) {
  const usageLabel = REFERENCE_USAGE_LABELS[usage] || '参考素材';
  const taskList = Array.isArray(tasks) ? tasks : EMPTY;
  const taskById = new Map(taskList.map((item) => [item.id, item]));
  const selectedTask = task || (taskList.length === 1 ? taskList[0] : null);
  const createTargetTask = selectedTask;
  const context = [project.name, selectedTask?.name].filter(Boolean).join(' / ');
  const helper = draftRounds.length ? '选择一个草稿轮次后，Studio 会直接写入参考素材，不会调用 Provider。' : createTargetTask ? '当前任务还没有可直接写入的草稿轮次，可以新建草稿轮次后自动加入。' : '先选择任务，再选择已有草稿轮次或新建轮次。';
  return <AccessibleDialog className="reference-dialog reference-round-resolver" label="选择草稿轮次" onDismiss={onDismiss}>
    <div className="reference-dialog-body">
      <header><div><p className="eyebrow">{context || project.name}</p><h2>把图片作为{usageLabel}</h2><span>{helper}</span></div><IconButton label="关闭草稿轮次选择" onClick={onDismiss}><X size={16} /></IconButton></header>
      <section className="derived-source-strip is-compact" aria-label="待加入参考的图片">{assets.map((asset) => <article key={asset.id}><button type="button" onClick={() => onPreview([asset])}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button><div className="derived-source-copy"><b>{asset.display?.label || (asset.kind === 'generated' ? '生成结果' : '导入素材')}</b><span>{asset.id}</span></div></article>)}</section>
      {!selectedTask && taskList.length > 1 && <section className="reference-round-options reference-task-options" aria-label="选择任务"><p className="eyebrow">先选择任务</p>{taskList.map((item) => <button type="button" key={item.id} className="outline-button" disabled={busy} onClick={() => onSelectTask(item.id)}><GitFork size={15} /><span><b>{item.name}</b><small>{item.status === 'archived' ? '已归档' : '在这个任务里选择或新建草稿轮次'}</small></span></button>)}</section>}
      {selectedTask && taskList.length > 1 && <p className="reference-task-current">当前任务：<strong>{selectedTask.name}</strong></p>}
      <section className="reference-round-options" aria-label="可写入的草稿轮次">
        {draftRounds.length ? draftRounds.map((round) => {
          const roundTask = taskById.get(round.taskId) || selectedTask;
          const roundTaskLabel = roundTask && (!selectedTask || roundTask.id !== selectedTask.id) ? roundTask.name + ' / ' : '';
          return <button type="button" key={round.id} className="outline-button" disabled={busy} onClick={() => onUseRound(round.id)}><GitFork size={15} /><span><b>{roundTaskLabel}{ROUND_PURPOSE_LABELS[round.purpose] || round.purpose} · 计划 v{round.planVersion}</b><small>{round.description || round.plan?.brief || '加入这个草稿轮次'}</small></span></button>;
        }) : <div className="empty-stage"><GitFork size={24} /><p>{createTargetTask ? '当前任务还没有可直接写入的草稿轮次。' : '选择任务后即可新建草稿轮次。'}</p></div>}
      </section>
      <CreationError error={error} />
      <footer><button type="button" className="outline-button" disabled={busy} onClick={onDismiss}>取消</button><button type="button" className="command-button" disabled={busy || !createTargetTask} onClick={onCreateRound}><GitFork size={16} />{createTargetTask ? '新建草稿轮次并加入' : '先选择任务'}</button></footer>
    </div>
  </AccessibleDialog>;
}

function ToggleButtonList({ options, value, onChange, label }) {
  const selected = new Set(value || []);
  const toggle = (item) => {
    const next = new Set(selected);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    onChange([...next]);
  };
  return <div className="derived-toggle-list" aria-label={label}>{options.map((item) => <button type="button" key={item} className={selected.has(item) ? 'is-active' : ''} aria-pressed={selected.has(item)} onClick={() => toggle(item)}>{item}</button>)}</div>;
}

function derivedPresetMaterial(asset, usage, index, preset) {
  const label = REFERENCE_USAGE_LABELS[usage] || usage;
  const usageNote = DERIVED_REFERENCE_USAGE_NOTES[usage] || label;
  const primaryPrefix = index === 0 ? '主参考图；' : '';
  return { assetId: asset.id, usage, note: primaryPrefix + usageNote + '。' + (preset?.label ? '编排：' + preset.label + '。' : '') };
}

function buildDerivedPresetMaterials(sourceAssets, preset, fallbackUsage) {
  return new Map(sourceAssets.map((asset, index) => {
    const usage = preset?.all || preset?.pattern?.[index] || preset?.rest || fallbackUsage || 'subject';
    return [asset.id, derivedPresetMaterial(asset, usage, index, preset)];
  }));
}

function usageCountsFromMaterials(materials) {
  const counts = {};
  for (const item of materials) counts[item.usage] = (counts[item.usage] || 0) + 1;
  return counts;
}

function derivedPresetAllowed(preset, purpose) {
  return !preset.purposes || preset.purposes.includes(purpose);
}

function defaultDerivedPresetForPurpose(purpose) {
  return DERIVED_REFERENCE_PRESETS.find((preset) => Array.isArray(preset.purposes) && preset.purposes.includes(purpose)) || DERIVED_REFERENCE_PRESETS.find((preset) => derivedPresetAllowed(preset, purpose)) || null;
}

function DerivedRoundDialog({ project, task, rounds, currentRound, assets, initialPurpose, initialActionId, busy, error, onDismiss, onCreate, onPreview, onImportMask }) {
  const initialAction = DERIVED_ACTION_BY_ID[initialActionId] || creativeDerivedActionForPurpose(initialPurpose) || DERIVED_ROUND_ACTIONS[0];
  const initialSourceAssets = (assets || EMPTY).filter((asset) => asset && !asset.deletedAt);
  const defaultParentRoundId = initialSourceAssets.length === 1 && initialSourceAssets[0].display?.taskId === task.id && initialSourceAssets[0].display?.roundId ? initialSourceAssets[0].display.roundId : currentRound?.id || '';
  const initialPreset = defaultDerivedPresetForPurpose(initialAction.purpose);
  const maskInputRef = useRef(null);
  const [sourceAssets, setSourceAssets] = useState(initialSourceAssets);
  const [selectedActionId, setSelectedActionId] = useState(initialAction.id);
  const [purpose, setPurpose] = useState(initialAction.purpose);
  const [parentRoundId, setParentRoundId] = useState(defaultParentRoundId);
  const [targetCount, setTargetCount] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [variationAxes, setVariationAxes] = useState(initialAction.defaultVariationAxes || (initialAction.purpose === 'variation' ? ['构图', '背景'] : []));
  const [keepConstraints, setKeepConstraints] = useState(initialAction.defaultKeepConstraints || ['主体']);
  const [refinementGoals, setRefinementGoals] = useState(initialAction.defaultRefinementGoals || (initialAction.purpose === 'refinement' ? ['质感', '细节'] : []));
  const [note, setNote] = useState('');
  const [arrangementMode, setArrangementMode] = useState(initialPreset?.id || 'custom');
  const [primaryAssetId, setPrimaryAssetId] = useState(initialSourceAssets[0]?.id || '');
  const [materials, setMaterials] = useState(() => initialPreset ? buildDerivedPresetMaterials(initialSourceAssets, initialPreset, initialAction.usage) : buildDerivedPresetMaterials(initialSourceAssets, { label: '自定义编排', all: initialAction.usage }, initialAction.usage));
  const [maskImporting, setMaskImporting] = useState(false);
  const [maskImportError, setMaskImportError] = useState('');
  const action = DERIVED_ACTION_BY_ID[selectedActionId] || creativeDerivedActionForPurpose(purpose) || initialAction;
  const applicablePresets = DERIVED_REFERENCE_PRESETS.filter((preset) => derivedPresetAllowed(preset, purpose));
  const selectedPreset = applicablePresets.find((preset) => preset.id === arrangementMode) || null;
  const selectedMaterials = sourceAssets.map((asset) => materials.get(asset.id) || { assetId: asset.id, usage: action.usage, note: '' });
  const usageCounts = usageCountsFromMaterials(selectedMaterials);
  const maskMaterials = selectedMaterials.filter((item) => item.usage === 'mask');
  const applyPreset = (preset) => {
    setArrangementMode(preset.id);
    setPrimaryAssetId(sourceAssets[0]?.id || '');
    setMaterials(buildDerivedPresetMaterials(sourceAssets, preset, action.usage));
  };
  const choosePurpose = (option) => {
    const preset = defaultDerivedPresetForPurpose(option.purpose);
    setSelectedActionId(option.id);
    setPurpose(option.purpose);
    setArrangementMode(preset?.id || 'custom');
    setMaterials(preset ? buildDerivedPresetMaterials(sourceAssets, preset, option.usage) : buildDerivedPresetMaterials(sourceAssets, { label: '自定义编排', all: option.usage }, option.usage));
    if (option.defaultVariationAxes) setVariationAxes(option.defaultVariationAxes);
    else if (option.purpose === 'variation') setVariationAxes((current) => current.length ? current : ['构图', '背景']);
    if (option.defaultKeepConstraints) setKeepConstraints(option.defaultKeepConstraints);
    if (option.defaultRefinementGoals) setRefinementGoals(option.defaultRefinementGoals);
    else if (option.purpose === 'refinement') setRefinementGoals((current) => current.length ? current : ['质感', '细节']);
  };
  const setMaterialPatch = (assetId, patch = {}) => setMaterials((current) => {
    const next = new Map(current);
    const existing = next.get(assetId) || { assetId, usage: action.usage, note: '' };
    next.set(assetId, { ...existing, ...patch, assetId });
    return next;
  });
  const setAllMaterials = (usage) => {
    setArrangementMode('custom');
    setMaterials(new Map(sourceAssets.map((asset, index) => {
      const existing = materials.get(asset.id);
      return [asset.id, { assetId: asset.id, usage, note: existing?.note || (index === 0 ? '主参考图；' : '') + (DERIVED_REFERENCE_USAGE_NOTES[usage] || REFERENCE_USAGE_LABELS[usage] || usage) + '。' }];
    })));
  };
  const importMaskFiles = async (files) => {
    const file = Array.from(files || []).find((item) => item?.type?.startsWith('image/'));
    if (!file) { setMaskImportError('请选择 PNG、JPG、WebP 或 GIF 图片作为遮罩。'); return; }
    if (!onImportMask) { setMaskImportError('当前 Workbench 不支持在此处导入遮罩图。'); return; }
    setMaskImporting(true);
    setMaskImportError('');
    try {
      const asset = await onImportMask(file);
      if (!asset?.id) throw new Error('遮罩图导入成功但未返回资产。');
      if (sourceAssets.some((item) => item.id === asset.id)) {
        setMaskImportError('导入的遮罩与当前参考图完全相同。为避免覆盖主体用途，请选择不同的遮罩图，或直接把现有图片改为遮罩。');
        return;
      }
      setSourceAssets((current) => [...current, asset]);
      setMaterials((current) => {
        const next = new Map(current);
        next.set(asset.id, { assetId: asset.id, usage: 'mask', note: '遮罩图；白色区域通常表示需要修改，黑色或透明区域保持。' });
        return next;
      });
    } catch (nextError) {
      setMaskImportError(nextError.message || '无法导入遮罩图。');
    } finally {
      setMaskImporting(false);
      if (maskInputRef.current) maskInputRef.current.value = '';
    }
  };
  const submit = (event) => {
    event.preventDefault();
    const arrangementLabel = selectedPreset?.label || '自定义编排';
    const parentAssetIds = purpose === 'edit' ? selectedMaterials.filter((item) => item.usage !== 'mask').map((item) => item.assetId) : sourceAssets.map((asset) => asset.id);
    onCreate({ purpose, action: action.id || purpose, actionLabel: action.title || action.label || '', parentRoundId, sourceAssetIds: sourceAssets.map((asset) => asset.id), parentAssetIds, referenceMaterials: selectedMaterials, primaryAssetId, referenceArrangementMode: arrangementMode, referenceArrangementLabel: arrangementLabel, referenceArrangement: { mode: arrangementMode, label: arrangementLabel, usageCounts }, targetCount: targetCount ? Number(targetCount) : undefined, aspectRatio, variationAxes, keepConstraints, refinementGoals, instruction: note.trim(), note: note.trim() });
  };
  return <AccessibleDialog className="creation-dialog is-wide derived-round-dialog" label="基于图片创建下一轮" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">{project.name} / {task.name}</p><h2>基于图片创建下一轮</h2><span>Studio 只创建草稿轮次和参考关系，不会触发确认、预检、Generation Run 或 Provider 调用。</span></div><IconButton label="关闭图片迭代" onClick={onDismiss}><X size={16} /></IconButton></header>
      <section className="creation-section"><h3>你想如何继续？</h3><div className="creation-choice-grid" role="radiogroup" aria-label="图片迭代动作">{DERIVED_ROUND_ACTIONS.map((option) => <button type="button" key={option.id} className={selectedActionId === option.id ? 'is-active' : ''} aria-pressed={selectedActionId === option.id} onClick={() => choosePurpose(option)}><b>{option.label}</b><span>{option.description}</span></button>)}</div></section>
      <section className="creation-section derived-purpose-board"><header><div><h3>多图用途编排</h3><p>先套用常见创作关系，再逐张微调用途和说明；Agent 会读取这些结构化角色。</p></div><span>{sourceAssets.length} 张来源图</span></header><div className="derived-arrangement-grid" role="radiogroup" aria-label="多图用途编排模板">{applicablePresets.map((preset) => <button type="button" key={preset.id} className={arrangementMode === preset.id ? 'is-active' : ''} aria-pressed={arrangementMode === preset.id} onClick={() => applyPreset(preset)}><b>{preset.label}</b><span>{preset.description}</span></button>)}<button type="button" className={arrangementMode === 'custom' ? 'is-active' : ''} aria-pressed={arrangementMode === 'custom'} onClick={() => setArrangementMode('custom')}><b>自定义编排</b><span>逐张指定主体、风格、构图、色彩、品牌、遮罩或反例用途。</span></button></div><div className="derived-usage-summary" aria-label="当前用途统计">{REFERENCE_USAGE_OPTIONS.filter((option) => usageCounts[option.id]).map((option) => <span key={option.id}><b>{usageCounts[option.id]}</b>{option.label}</span>)}</div></section>
      {purpose === 'edit' && <section className="creation-section mask-lite-panel" onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void importMaskFiles(event.dataTransfer.files); }} onPaste={(event) => { const files = [...event.clipboardData.files].filter((item) => item.type.startsWith('image/')); if (files.length) { event.preventDefault(); event.stopPropagation(); void importMaskFiles(files); } }} tabIndex={0} aria-label="轻量遮罩准备"><div><h3>轻量遮罩准备</h3><p>不做画笔编辑器：可以把已选图指定为遮罩，也可以导入、拖入或粘贴一张黑白 / 透明遮罩图。生成前仍由预检校验 Provider 能力和遮罩资产。</p></div><div className="mask-lite-actions"><button type="button" className="command-button" disabled={maskImporting} onClick={() => maskInputRef.current?.click()}><ImagePlus size={15} />{maskImporting ? '正在导入遮罩' : '导入遮罩图'}</button><button type="button" className="outline-button" disabled={sourceAssets.length < 2} onClick={() => { setArrangementMode('custom'); setMaterialPatch(sourceAssets[1].id, { usage: 'mask', note: '遮罩图；白色区域通常表示需要修改，黑色或透明区域保持。' }); }}>第 2 张设为遮罩</button></div><input ref={maskInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void importMaskFiles(event.target.files)} /><div className="mask-lite-status"><span>{maskMaterials.length ? '已选择 ' + maskMaterials.length + ' 张遮罩图' : '尚未选择遮罩图；也可以先创建草稿，让 Agent 后续提示补齐。'}</span><small>遮罩不会作为非遮罩参考传给 Provider。</small></div>{maskImportError && <div className="creation-form-error" role="alert"><CircleAlert size={15} /><span>{maskImportError}</span></div>}</section>}
      <section className="derived-source-strip is-board" aria-label="本次参考图片">{sourceAssets.map((asset, index) => {
        const material = materials.get(asset.id) || { assetId: asset.id, usage: action.usage, note: '' };
        const assetLabel = asset.display?.label || (asset.kind === 'generated' ? '生成结果' : '导入素材');
        const primary = primaryAssetId === asset.id;
        return <article key={asset.id} className={primary ? 'is-primary' : ''}><button type="button" className="derived-source-preview" onClick={() => onPreview([asset])} aria-label="预览参考图片"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button><div className="derived-source-copy"><div className="derived-source-title"><b title={assetLabel}>{index + 1}. {assetLabel}</b><button type="button" className="outline-button derived-primary-button" aria-pressed={primary} onClick={() => setPrimaryAssetId(asset.id)}>{primary ? '主参考' : '设为主参考'}</button></div><div className="derived-role-chips" aria-label={'分配 ' + assetLabel + ' 的用途'}>{REFERENCE_USAGE_OPTIONS.map((option) => <button type="button" key={option.id} className={material.usage === option.id ? 'is-active' : ''} aria-pressed={material.usage === option.id} title={option.description} onClick={() => { setArrangementMode('custom'); setMaterialPatch(asset.id, { usage: option.id, note: material.note || (DERIVED_REFERENCE_USAGE_NOTES[option.id] || option.label) + '。' }); }}>{option.label}</button>)}</div><input value={material.note || ''} onChange={(event) => { setArrangementMode('custom'); setMaterialPatch(asset.id, { note: event.target.value }); }} placeholder="这张图在下一轮里的用途说明" /></div></article>;
      })}</section>
      <section className="creation-section"><h3>快速分配用途</h3><div className="derived-preset-row"><button type="button" className="outline-button" onClick={() => setAllMaterials('subject')}>全部主体参考</button><button type="button" className="outline-button" onClick={() => setAllMaterials('style')}>全部风格参考</button><button type="button" className="outline-button" onClick={() => setAllMaterials('composition')}>全部构图参考</button><button type="button" className="outline-button" onClick={() => setAllMaterials('negative')}>全部反例</button></div></section>
      <section className="creation-section is-two-columns"><label><span>父轮次</span><select value={parentRoundId} onChange={(event) => setParentRoundId(event.target.value)}><option value="">不绑定父轮次</option>{rounds.map((round) => <option value={round.id} key={round.id}>{ROUND_PURPOSE_LABELS[round.purpose] || round.purpose} · 计划 v{round.planVersion}</option>)}</select></label><label><span>目标数量</span><select value={targetCount} onChange={(event) => setTargetCount(event.target.value)}>{CREATION_COUNT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value ? value + ' 张' : '让 Agent 决定'}</option>)}</select></label><label><span>画幅</span><select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>{CREATION_ASPECT_OPTIONS.map((value) => <option value={value} key={value || 'auto'}>{value || '沿用原图 / 由 Agent 决定'}</option>)}</select></label><label className="creation-full"><span>{purpose === 'edit' ? '修改说明' : purpose === 'fill' ? '补图 / 扩图说明' : '补充说明'}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={purpose === 'variation' ? '例如：保持主体，换 4 种背景与构图。' : purpose === 'refinement' ? '例如：主体不变，提升质感、光影和细节。' : purpose === 'edit' ? '例如：只替换背景，主体和 Logo 不变。' : '例如：把这张竖图扩成 16:9 横版，左右补足场景。'} /></label></section>
      {purpose === 'variation' && <section className="creation-section"><h3>变化维度</h3><ToggleButtonList label="变化维度" options={DERIVED_VARIATION_AXES} value={variationAxes} onChange={setVariationAxes} /></section>}
      {purpose === 'refinement' && <section className="creation-section"><h3>精修目标</h3><ToggleButtonList label="精修目标" options={DERIVED_REFINEMENT_GOALS} value={refinementGoals} onChange={setRefinementGoals} /></section>}
      <section className="creation-section"><h3>保持不变</h3><ToggleButtonList label="保持不变" options={DERIVED_KEEP_CONSTRAINTS} value={keepConstraints} onChange={setKeepConstraints} /></section>
      <CreationError error={error} />
      <footer><button type="button" className="outline-button" onClick={onDismiss} disabled={busy}>取消</button><button type="submit" className="command-button" disabled={busy || !sourceAssets.length}>{busy ? '正在创建' : '创建草稿轮次'}</button></footer>
    </form>
  </AccessibleDialog>;
}

function RejectReviewDialog({ assets, canAddNegative, canCreateNextRound, initialCreateNextRound = false, busy, error, onDismiss, onSave, onPreview }) {
  const [reasonIds, setReasonIds] = useState(['style-wrong']);
  const [note, setNote] = useState('');
  const [addNegative, setAddNegative] = useState(false);
  const [createNextRound, setCreateNextRound] = useState(Boolean(initialCreateNextRound && canCreateNextRound));
  const submit = (event) => {
    event.preventDefault();
    onSave({ reasonIds, reasons: reasonIds.map((id) => REJECT_REASON_LABELS[id] || id), note: note.trim(), source: 'workbench-reject-dialog' }, { addAsNegative: addNegative && canAddNegative, createNextRound: createNextRound && canCreateNextRound });
  };
  return <AccessibleDialog className="creation-dialog reject-review-dialog" label="不采用原因" onDismiss={onDismiss}>
    <form className="creation-form" onSubmit={submit}>
      <header><div><p className="eyebrow">结构化评审</p><h2>为什么不采用？</h2><span>这些反馈会写入资产评审记录；需要时也可以转为下一轮的反例、修正目标和保持约束。</span></div><IconButton label="关闭不采用原因" onClick={onDismiss}><X size={16} /></IconButton></header>
      <section className="derived-source-strip is-compact" aria-label="不采用图片">{assets.map((asset) => <article key={asset.id}><button type="button" onClick={() => onPreview([asset])} aria-label="预览不采用图片"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button><div><b>{asset.display?.label || '素材'}</b><span>{asset.kind === 'generated' ? '生成结果' : '导入素材'}</span></div></article>)}</section>
      <section className="creation-section"><h3>选择原因</h3><div className="derived-toggle-list" aria-label="不采用原因">{REJECT_REASON_OPTIONS.map((option) => { const active = reasonIds.includes(option.id); return <button type="button" key={option.id} className={active ? 'is-active' : ''} aria-pressed={active} onClick={() => setReasonIds((current) => active ? current.filter((id) => id !== option.id) : [...current, option.id])}>{option.label}</button>; })}</div></section>
      <section className="creation-section"><label><span>补充说明</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：主体形态偏离品牌角色；下轮不要再使用这种廉价金属质感。" /></label>{canAddNegative && <label className="creation-inline-checkbox"><input type="checkbox" checked={addNegative} disabled={createNextRound} onChange={(event) => setAddNegative(event.target.checked)} /><span>同时加入当前草稿轮次作为反例参考</span></label>}{canCreateNextRound && <label className="creation-inline-checkbox"><input type="checkbox" checked={createNextRound} onChange={(event) => { const checked = event.target.checked; setCreateNextRound(checked); if (checked) setAddNegative(false); }} /><span>从不采用原因创建下一轮草稿</span></label>}<p className="creation-field-hint">创建下一轮只写入草稿上下文，不会确认计划、预检、创建 Generation Run 或访问 Provider。</p></section>
      <CreationError error={error} />
      <footer><button type="button" className="outline-button" disabled={busy} onClick={onDismiss}>取消</button><button type="submit" className="command-button" disabled={busy || !reasonIds.length}>{busy ? '正在保存' : createNextRound ? '保存并创建下一轮' : '保存不采用原因'}</button></footer>
    </form>
  </AccessibleDialog>;
}

function ImageInspectorDialog({ assets, zoom, selectedAssetIds, selectionBusyIds, selectedProject, selectedTask, fallbackTask, selectedRound, onClose, onZoom, onToggleDeliverable, onReview, onOpenDerive, onAddReference, onReject, onOpenReference }) {
  const single = assets.length === 1 ? assets[0] : null;
  const singleSelected = single ? selectedAssetIds.has(single.id) : false;
  return <AccessibleDialog className="image-inspector" label={assets.length === 2 ? '双图对比' : '素材放大查看'} onDismiss={onClose}>
    <div className="inspector-toolbar"><span>{assets.length === 2 ? '双图对比' : '素材查看'}</span><div><IconButton label="缩小" disabled={zoom <= 0.75} onClick={() => onZoom(Math.max(0.75, zoom - 0.25))}><ZoomOut size={16} /></IconButton><IconButton label="放大" disabled={zoom >= 2} onClick={() => onZoom(Math.min(2, zoom + 0.25))}><ZoomIn size={16} /></IconButton><IconButton label="关闭查看" onClick={onClose}><X size={16} /></IconButton></div></div>
    <div className={'inspector-images ' + (assets.length === 2 ? 'is-compare' : '')}>{assets.map((asset, index) => { const selected = selectedAssetIds.has(asset.id); const busy = selectionBusyIds.has(asset.id); return <figure className={selected ? 'is-selected' : ''} key={asset.id}>{selectedProject && !asset.deletedAt && <label className="inspector-select-control"><input type="checkbox" checked={selected} disabled={busy} onChange={() => void onToggleDeliverable(asset)} /><span>{selected ? <Check size={15} /> : <Bookmark size={15} />}{busy ? '正在保存' : selected ? '已选成果' : '选为成果'}</span></label>}<img src={assetOriginalUrl(asset)} alt="" style={{ transform: 'scale(' + zoom + ')' }} /><figcaption>{asset.display?.label || (assets.length === 2 ? '对比图 ' + (index + 1) : '素材')}</figcaption></figure>; })}</div>
    <div className="inspector-action-bar" aria-label="图片继续操作">
      {single ? <button type="button" className="outline-button" onClick={() => void onToggleDeliverable(single)}><Bookmark size={15} />{singleSelected ? '移出成果' : '选为成果'}</button> : <button type="button" className="outline-button" onClick={() => assets.forEach((asset) => void onToggleDeliverable(asset))}>都选为成果</button>}
      <CreativeActionLauncher assets={assets} selectedTask={selectedTask} fallbackTask={fallbackTask} selectedRound={selectedRound} label={single ? '用这张继续' : '用这组继续'} onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} />
      <button type="button" className="outline-button" onClick={() => onReject(assets, { createNextRound: false })}><X size={15} />不采用</button>
    </div>
  </AccessibleDialog>;
}




function AssetCard({ asset, selected, selectionBusy, shared, selectedTask, fallbackTask, selectedRound, onToggleSelect, onReview, onTrash, onRestore, onPreview, onInspect, onDownload, onCopy, onSetShared, onOpenDerive, onAddReference, onReject, onOpenReference }) {
  const [annotating, setAnnotating] = useState(false);
  const [note, setNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const saveNote = () => {
    if (!note.trim()) return;
    onReview(asset.id, 'review', { note: note.trim() });
    setNote('');
    setAnnotating(false);
  };
  const runMenuAction = (callback) => {
    callback();
    setMenuOpen(false);
  };
  const assetLabel = asset.display?.label || (asset.kind === 'generated' ? '生成结果' : '导入素材');
  const roundLabel = asset.display?.roundSequence ? (({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[asset.display.roundPurpose] || '创作') + ' · 第 ' + asset.display.roundSequence + ' 轮' : null;
  const contextLabel = asset.display?.taskName && roundLabel ? asset.display.taskName + ' · ' + roundLabel : asset.display?.taskName || roundLabel;
  const stateLabel = asset.deletedAt ? '回收站' : asset.review?.decision === 'keep' ? '已选成果' : asset.review?.decision === 'review' ? '未定' : asset.review?.decision === 'reject' ? '不采用' : asset.review?.decision === 'derive' ? '可继续' : selected ? '已选' : '未评审';
  const menuDerive = (nextAssets, purpose, actionId) => runMenuAction(() => onOpenDerive(nextAssets, purpose, actionId));
  const menuReference = (nextAssets, usage) => runMenuAction(() => onAddReference(nextAssets, usage));
  const menuReject = (nextAssets, options) => runMenuAction(() => onReject(nextAssets, options));
  return <article className={'asset-card ' + (asset.deletedAt ? 'is-trashed ' : '') + (selected ? 'is-selected' : '')}>
    <div className="asset-preview">
      {asset.deletedAt ? <div className="trash-preview"><Trash2 size={24} strokeWidth={1.4} /></div> : <button type="button" className="asset-preview-button" onClick={() => onPreview([asset])} aria-label="放大查看素材"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button>}
      {!asset.deletedAt && <label className="asset-select-control"><input type="checkbox" checked={selected} disabled={selectionBusy} onChange={() => onToggleSelect(asset)} /><span><Bookmark size={13} fill={selected ? 'currentColor' : 'none'} />{selected ? '已选成果' : '选为成果'}</span></label>}
      <div className="asset-card-tools"><IconButton label={menuOpen ? '关闭更多操作' : '更多操作'} onClick={() => setMenuOpen((value) => !value)}><Ellipsis size={17} /></IconButton></div>
    </div>
    {menuOpen && <div className="asset-action-menu">{asset.deletedAt ? <button type="button" onClick={() => runMenuAction(() => onRestore(asset.id))}><RotateCcw size={15} /><span>恢复资产</span></button> : <>
      <section className="asset-action-section is-primary"><p className="asset-action-label">继续</p><CreativeActionLauncher compact assets={[asset]} selectedTask={selectedTask} fallbackTask={fallbackTask} selectedRound={selectedRound} label="用这张继续" onOpenDerive={menuDerive} onAddReference={menuReference} onReject={menuReject} onOpenReference={onOpenReference} /></section>
      <section className="asset-action-section"><p className="asset-action-label">获取图片</p><div><button type="button" onClick={() => runMenuAction(() => onPreview([asset]))}><Eye size={15} /><span>放大查看</span></button><button type="button" onClick={() => runMenuAction(() => onCopy(asset))}><Copy size={15} /><span>复制图片</span></button><button type="button" aria-label="下载原图" onClick={() => runMenuAction(() => onDownload(asset))}><Download size={15} /><span>下载原图</span></button></div></section>
      <section className="asset-action-section"><p className="asset-action-label">评审和管理</p><div><button type="button" onClick={() => runMenuAction(() => onReject([asset], { createNextRound: false }))}><X size={15} /><span>不采用</span></button><button type="button" onClick={() => { setAnnotating(true); setMenuOpen(false); }}><MessageSquareText size={15} /><span>批注</span></button><button type="button" onClick={() => runMenuAction(() => onSetShared(asset, !shared))}><Share2 size={15} /><span>{shared ? '取消共享' : '共享素材'}</span></button><button type="button" onClick={() => runMenuAction(() => onInspect(asset.id))}><GitFork size={15} /><span>查看来源</span></button><button type="button" className="danger" role="menuitem" onClick={() => runMenuAction(() => onTrash(asset.id))}><Trash2 size={15} /><span>移入回收站</span></button></div></section>
    </>}</div>}
    <div className="asset-meta"><div><strong>{assetLabel}</strong><span className="asset-state">{stateLabel}</span></div>{contextLabel && <span className="asset-context-line" title={contextLabel}>{contextLabel}</span>}</div>
    {annotating && <div className="annotation-editor"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录本轮反馈" /><button type="button" className="outline-button" disabled={!note.trim()} onClick={saveNote}>保存批注</button></div>}
  </article>;
}

function RunItemOutputThumbs({ assets, onInspect }) {
  if (!assets?.length) return <span className="run-item-output is-empty">暂无图像</span>;
  return <span className="run-item-output">{assets.slice(0, 3).map((asset, index) => <button type="button" key={asset.id} aria-label={'查看第 ' + (index + 1) + ' 个结果资产来源'} title="查看结果资产来源" onClick={() => void onInspect(asset.id)}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button>)}{assets.length > 3 && <em>+{assets.length - 3}</em>}</span>;
}

function RunItemRow({ item, selected, onToggleSelected, onOpenDetail, onInspect, onRetry }) {
  const recovery = runItemRecovery(item);
  const retryable = retryableRunItems([item]).length > 0;
  const attempts = Number.isInteger(item.attempts) ? item.attempts : 0;
  return <article className={'run-item-row ' + (selected ? 'is-selected ' : '') + (retryable ? 'is-retryable' : '')}>
    <label className="run-item-select"><input type="checkbox" checked={selected} disabled={!retryable} onChange={() => onToggleSelected(item.id)} aria-label={'选择第 ' + item.sequence + ' 项用于批量重试'} /><span aria-hidden="true"><Check size={12} /></span></label>
    <div className="run-item-summary"><b>#{String(item.sequence).padStart(3, '0')}</b><RunItemOutputThumbs assets={item.outputAssets || EMPTY} onInspect={onInspect} /></div>
    <StatusPill value={item.status} scope="run_item" />
    <div className="run-item-details"><span>尝试 {attempts} 次</span>{item.retryAt && <span>重试 {item.retryAt}</span>}{item.updatedAt && <span>更新 {new Date(item.updatedAt).toLocaleString('zh-CN')}</span>}{recovery.error && <span className="run-item-error">{recovery.error}</span>}{recovery.advice && <span className="run-item-recovery">{recovery.advice}</span>}</div>
    <div className="run-item-actions"><button type="button" className="outline-button" onClick={() => onOpenDetail(item)}><Eye size={15} />详情</button>{retryable && <IconButton label={'重试第 ' + item.sequence + ' 项'} onClick={() => void onRetry(item.id)}><RefreshCw size={15} /></IconButton>}</div>
  </article>;
}

function RunItemDetailDialog({ item, onDismiss, onInspect, onRetry }) {
  if (!item) return null;
  const recovery = runItemRecovery(item);
  const retryable = retryableRunItems([item]).length > 0;
  return <AccessibleDialog label={'第 ' + item.sequence + ' 项运行详情'} onDismiss={onDismiss} className="run-item-detail-dialog">
    <header><div><p className="eyebrow">运行项详情</p><h2>第 {item.sequence} 项</h2></div><IconButton label="关闭运行项详情" onClick={onDismiss}><X size={16} /></IconButton></header>
    <div className="run-item-detail-grid"><section><h3>状态</h3><StatusPill value={item.status} scope="run_item" /><p>已尝试 {Number.isInteger(item.attempts) ? item.attempts : 0} 次{item.retryAt ? '，下次重试 ' + item.retryAt : ''}。</p>{item.updatedAt && <p>最后更新：{new Date(item.updatedAt).toLocaleString('zh-CN')}</p>}</section><section><h3>恢复建议</h3>{recovery.error ? <p className="run-item-error">{recovery.error}</p> : <p>没有安全错误摘要。</p>}{recovery.advice && <p className="run-item-recovery">{recovery.advice}</p>}</section><section className="run-item-detail-assets"><h3>输出资产</h3>{item.outputAssets?.length ? <div>{item.outputAssets.map((asset) => <button type="button" key={asset.id} onClick={() => void onInspect(asset.id)}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /><span>{asset.mediaType || 'image'} · {asset.mediaState || 'available'}</span></button>)}</div> : <p>这一项还没有输出资产。</p>}</section></div>
    {retryable && <footer><button type="button" className="command-button" onClick={() => void onRetry(item.id)}><RefreshCw size={16} />立即重试此项</button></footer>}
  </AccessibleDialog>;
}

function RunItemProgressBar({ page }) {
  const progress = runItemProgress(page.statusCounts);
  const total = Math.max(0, Number(page.allTotal || page.total || 0));
  const segments = [{ key: 'succeeded', label: '完成', value: progress.succeeded }, { key: 'active', label: '进行中', value: progress.active }, { key: 'waiting', label: '等待', value: progress.waiting }, { key: 'attention', label: '需处理', value: progress.attention }, { key: 'cancelled', label: '取消', value: progress.cancelled }].filter((segment) => segment.value > 0);
  return <div className="run-item-progress" role="progressbar" aria-label={'运行项完成进度：' + progress.succeeded + ' / ' + total} aria-valuemin="0" aria-valuemax={total || 1} aria-valuenow={Math.min(progress.succeeded, total || 1)}>
    <div>{segments.length ? segments.map((segment) => <span key={segment.key} className={'is-' + segment.key} style={{ width: Math.max(2, (segment.value / Math.max(1, total)) * 100) + '%' }} />) : <span className="is-empty" />}</div>
    <p>{progress.succeeded} 完成 · {progress.active} 进行中 · {progress.attention} 需处理 · 共 {total} 项</p>
  </div>;
}

function evidenceDate(value) {
  if (typeof value !== 'string' || !value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function evidenceLabel(value) {
  if (value === true) return '支持';
  if (value === false) return '不支持';
  if (value === null || value === undefined || value === '') return '未记录';
  if (Array.isArray(value)) return value.length ? value.join('、') : '无';
  if (typeof value === 'object') {
    const record = value;
    if ((record.width || record.width === 0) && (record.height || record.height === 0)) return String(record.width) + ' × ' + String(record.height) + (record.unit ? ' ' + record.unit : '');
    return JSON.stringify(record, null, 2);
  }
  return String(value);
}

function EvidenceFacts({ items }) {
  return <dl className="advanced-fact-grid">{items.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{evidenceLabel(value)}</dd></div>)}</dl>;
}

function AdvancedDetailsPanel({ details, onClose }) {
  return <section className="advanced-details">
    <div className="advanced-details-head"><div><p className="eyebrow">技术详情</p><h3>计划与预检证据</h3></div><IconButton label="关闭技术详情" onClick={onClose}><X size={15} /></IconButton></div>
    <div className="advanced-evidence">
      <section className="advanced-evidence-section"><h4>计划版本</h4>{details.plans.length ? <div className="advanced-plan-list">{details.plans.map((item) => <article key={item.id || item.planVersion} className="advanced-plan-row"><strong>v{item.planVersion}</strong><span>{planStateLabel?.(item.state) || item.state || '未知'}</span><small>{evidenceDate(item.createdAt)}{item.confirmedAt ? ' · 确认 ' + evidenceDate(item.confirmedAt) : ''}</small></article>)}</div> : <p>没有计划版本记录。</p>}</section>
      <section className="advanced-evidence-section is-preflight"><h4>预检</h4>{details.dryRuns.length ? <div className="advanced-dry-run-list">{details.dryRuns.map((dryRun) => <DryRunEvidenceCard key={dryRun.id} dryRun={dryRun} />)}</div> : <p>没有预检记录。</p>}</section>
    </div>
  </section>;
}

function DryRunEvidenceCard({ dryRun }) {
  const evidence = dryRunEvidence(dryRun);
  const details = evidence.details || {};
  const planSnapshot = details.planSnapshot && typeof details.planSnapshot === 'object' ? details.planSnapshot : {};
  const provider = details.provider && typeof details.provider === 'object' ? details.provider : {};
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object' ? provider.capabilities : {};
  const output = planSnapshot.output && typeof planSnapshot.output === 'object' ? planSnapshot.output : {};
  const capabilityItems = [['生成', capabilities.generate], ['编辑', capabilities.edit], ['参考图', capabilities.referenceImage], ['遮罩', capabilities.mask]].filter(([, value]) => value !== undefined);
  return <article className="advanced-dry-run-card">
    <header><div><strong>{evidence.status}</strong><span>计划 v{evidence.planVersion || '未知'}</span></div><time>{evidenceDate(details.createdAt)}</time></header>
    <EvidenceFacts items={[["运行项", details.itemCount ?? planSnapshot.itemCount], ["操作", planSnapshot.operation === 'edit' ? '编辑' : '生成'], ["Provider", provider.providerId], ["模型", provider.model], ["参考素材", planSnapshot.referenceAssetIds?.length ?? planSnapshot.referenceCount], ["逐图提示词", planSnapshot.itemPrompts?.length || 0]]} />
    <div className="advanced-preflight-breakdown">
      <section><h5>输出规格</h5>{Object.keys(output).length ? <EvidenceFacts items={Object.entries(output).map(([key, value]) => [key, value])} /> : <p>由 Provider 默认能力决定。</p>}</section>
      <section><h5>能力快照</h5>{capabilityItems.length ? <div className="advanced-capability-list">{capabilityItems.map(([label, value]) => <span key={label} className={value ? 'is-on' : 'is-off'}>{label}：{value ? '支持' : '不支持'}</span>)}</div> : <p>没有能力快照。</p>}</section>
    </div>
    <details className="advanced-raw-evidence"><summary>查看原始摘要</summary><pre>{JSON.stringify(evidence.details, null, 2)}</pre></details>
  </article>;
}


function GenerationHistory({ selectedRound, runs, activeRunId, activeRun, runExecutionStatus, runLifecycleStatus, taskOverview, creativeRecord, visibleRunItems, runItemPage, runItemFilter, runItemPageSize, runItemSequence, selectedRunItemIds, runItemDetail, canCancelActiveRun, advancedDetails, onSelectRun, onControlRun, onRetryItem, onInspectAsset, onSetRunItemFilter, onSetRunItemPage, onSetRunItemPageSize, onSetRunItemSequence, onToggleRunItemSelection, onSelectRetryablePageItems, onRetrySelectedItems, onOpenRunItemDetail, onCloseRunItemDetail, onToggleAdvanced, onCloseAdvanced, onCopyPrompt }) {
  const plan = activeRun ? planPresentation(activeRun.planSnapshot) : null;
  const hasPrompt = Boolean(activeRun?.planSnapshot?.prompt?.trim());
  const runShortId = activeRun ? String(activeRun.id || '').slice(-8) || '未记录' : '';
  const bounds = runItemPageBounds(runItemPage);
  const normalizedFilter = normalizeRunItemFilter(runItemFilter);
  const normalizedPageSize = normalizeRunItemPageSize(runItemPageSize);
  const normalizedSequence = normalizeRunItemSequence(runItemSequence);
  const retryablePageItems = retryableRunItems(visibleRunItems);
  const selectedRetryableIds = selectableRunItemIds(visibleRunItems, selectedRunItemIds);
  const allRetryableSelected = retryablePageItems.length > 0 && selectedRetryableIds.length === retryablePageItems.length;
  return <section className="run-stage">
    <div className="run-history-layout">
      <aside className="run-history-panel" aria-label="当前轮次的生成历史">
        <header><div><p className="eyebrow">当前轮次</p><h2>运行记录</h2></div><span className="run-history-count">{runs.length}</span></header>
        <p className="run-history-help">{selectedRound ? '选择一条记录查看当时的提示词、结果与恢复操作。' : '先从上方选择轮次。'}</p>
        {selectedRound ? runs.length ? <div className="run-history-list">{runs.map((run, index) => <button type="button" key={run.id} className={run.id === activeRunId ? 'is-active' : ''} aria-pressed={run.id === activeRunId} aria-label={runHistoryOption(run)} title={runHistoryOption(run)} onClick={() => onSelectRun(run.id)}>
          <span className="run-history-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="run-history-entry"><b>计划 v{run.planVersion ?? '?'}</b><small>{run.createdAt ? new Date(run.createdAt).toLocaleString('zh-CN') : '时间未知'} · {String(run.id || '').slice(-8) || '未知标识'}</small></span>
          <StatusPill value={run.status} scope="run" />
        </button>)}</div> : <p className="empty-copy">当前轮次还没有生成运行。</p> : <p className="empty-copy">从上方选择一个轮次后，再查看生成历史。</p>}
      </aside>

      <section className="run-detail-panel">
        <header className="run-detail-header">
          <div><p className="eyebrow">{selectedRound ? (ROUND_PURPOSE_LABELS[selectedRound.purpose] || selectedRound.purpose) + '轮次' : '未选择轮次'}</p><h2>{activeRun ? '生成详情' : '选择一条运行记录'}</h2>{activeRun && <span>{activeRun.createdAt ? new Date(activeRun.createdAt).toLocaleString('zh-CN') : '时间未知'} · 计划 v{activeRun.planVersion ?? '?'} · {runShortId}</span>}</div>
          {activeRun && <StatusPill presentation={runExecutionStatus} />}
        </header>

        {activeRun ? <>
          <section className="run-prompt-card">
            <header><div className="run-prompt-title"><MessageSquareText size={17} aria-hidden="true" /><div><span>本次提示词</span><small>{plan.operation} · {plan.output}</small></div></div><button type="button" className="run-copy-button" onClick={() => void onCopyPrompt(activeRun)} disabled={!hasPrompt}><Copy size={15} />复制完整提示词</button></header>
            <p>{plan.prompt}</p>
            <div className="run-plan-facts"><span>计划产出 <b>{plan.itemCount ?? '未记录'}</b></span><span>参考素材 <b>{activeRun.planSnapshot?.referenceCount ?? plan.references.length}</b></span><span>执行并发 <b>{activeRun.executionConcurrency || '未记录'}</b></span></div>
          </section>

          <section className="run-overview-strip" aria-label="运行概览">
            {taskOverview && <div className="run-task-context"><p className="eyebrow">当前任务</p><strong>{taskOverview.task?.name}</strong><span>{taskOverview.summary?.roundCount || 0} 个轮次 · {taskOverview.summary?.runCount || 0} 次运行 · {taskOverview.summary?.resultCount || 0} 个结果{creativeRecord?.lineage?.rounds?.length ? ' · 承接 ' + creativeRecord.lineage.rounds.length + ' 个上游轮次' : ''}</span></div>}
            <div className="run-metrics"><div><span>计划</span><b>v{activeRun.planVersion ?? creativeRecord?.round?.planVersion ?? '?'}</b></div><div><span>执行</span><b>{runExecutionStatus.label}</b></div><div><span>状态</span><b>{runLifecycleStatus.label}</b></div></div>
          </section>

          <div className="run-controls" aria-label="运行操作">
            <span className="run-controls-label">运行操作</span>
            {['queued', 'running'].includes(activeRun.status) && <button type="button" className="outline-button" onClick={() => void onControlRun('pause')}><Pause size={16} />暂停</button>}
            {activeRun.status === 'paused' && <button type="button" className="command-button" onClick={() => void onControlRun('resume')}><Play size={16} />继续</button>}
            {['partial', 'failed'].includes(activeRun.status) && <button type="button" className="command-button" onClick={() => void onControlRun('retry')}><RefreshCw size={16} />重试失败项</button>}
            {canCancelActiveRun && <button type="button" className="danger-button" onClick={() => void onControlRun('cancel')}><X size={16} />取消运行</button>}
            <button type="button" className="run-advanced-button" aria-expanded={Boolean(advancedDetails)} onClick={onToggleAdvanced}><Ellipsis size={16} />{advancedDetails ? '收起技术详情' : '技术详情'}</button>
          </div>

          <section className="run-items-section">
            <header className="run-items-heading"><div><p className="eyebrow">生成结果</p><h3>结果队列</h3></div><span>{bounds.start ? bounds.start + '-' + bounds.end : '0'} / {runItemPage.total} 项{runItemPage.allTotal !== runItemPage.total ? ' · 总 ' + runItemPage.allTotal : ''}</span></header>
            <RunItemProgressBar page={runItemPage} />
            <div className="run-item-toolbar">
              <div className="run-item-filters" aria-label="运行项状态筛选">{RUN_ITEM_FILTER_OPTIONS.map((option) => <button type="button" key={option.id} className={normalizedFilter === option.id ? 'is-active' : ''} onClick={() => onSetRunItemFilter(option.id)}>{option.label}<small>{runItemFilterCount(runItemPage.statusCounts, option.id)}</small></button>)}</div>
              <label className="run-item-sequence"><Search size={14} /><span>序号</span><input type="number" min="1" inputMode="numeric" value={normalizedSequence || ''} onChange={(event) => onSetRunItemSequence(event.target.value)} placeholder="任意" />{normalizedSequence !== null && <button type="button" aria-label="清除序号筛选" onClick={() => onSetRunItemSequence(null)}><X size={13} /></button>}</label>
              <label className="run-item-page-size"><span>每页</span><select aria-label="每页运行项数量" value={normalizedPageSize} onChange={(event) => onSetRunItemPageSize(event.target.value)}>{RUN_ITEM_PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
              <div className="run-item-bulk"><button type="button" className="outline-button" disabled={!retryablePageItems.length} onClick={() => onSelectRetryablePageItems(!allRetryableSelected)}><Check size={15} />{allRetryableSelected ? '取消本页' : '选择可重试'}</button><button type="button" className="command-button" disabled={!selectedRetryableIds.length} onClick={() => void onRetrySelectedItems(selectedRetryableIds)}><RefreshCw size={15} />重试已选 {selectedRetryableIds.length || ''}</button></div>
            </div>
            <div className="run-item-list">{visibleRunItems.length ? visibleRunItems.map((item) => <RunItemRow key={item.id} item={item} selected={selectedRunItemIds.has(item.id)} onToggleSelected={onToggleRunItemSelection} onOpenDetail={onOpenRunItemDetail} onInspect={onInspectAsset} onRetry={onRetryItem} />) : <p className="empty-copy">当前筛选没有运行项。</p>}</div>
            <nav className="run-item-pagination" aria-label="运行项分页"><button type="button" className="outline-button" disabled={runItemPage.page <= 1} onClick={() => onSetRunItemPage(runItemPage.page - 1)}><ChevronLeft size={15} />上一页</button><span>第 {runItemPage.page} / {runItemPage.totalPages} 页</span><button type="button" className="outline-button" disabled={runItemPage.page >= runItemPage.totalPages} onClick={() => onSetRunItemPage(runItemPage.page + 1)}>下一页<ChevronRight size={15} /></button></nav>
          </section>

          {advancedDetails && <AdvancedDetailsPanel details={advancedDetails} onClose={onCloseAdvanced} />}
        </> : <div className="run-detail-empty"><Sparkles size={28} strokeWidth={1.25} /><div><h3>选择一条运行记录</h3><p>选择后会在这里集中显示提示词、执行状态、生成结果和可用操作。</p></div></div>}
      </section>
    </div>
    <RunItemDetailDialog item={runItemDetail} onDismiss={onCloseRunItemDetail} onInspect={onInspectAsset} onRetry={onRetryItem} />
  </section>;
}

class WorkbenchErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error) { window.__daogeWorkbenchRenderError = error instanceof Error ? error.stack || error.message : String(error); }

  render() {
    if (this.state.failed) return <main className="fatal-error"><CircleAlert size={24} /><div><h1>无法显示工作台</h1><p>详情内容未能安全显示。刷新后可继续使用 Studio。</p></div><button type="button" className="command-button" onClick={() => window.location.reload()}>刷新</button></main>;
    return this.props.children;
  }
}

function LocalStudioAuthorizationGate() {
  const [attempt, setAttempt] = useState(0);
  const [authorizationError, setAuthorizationError] = useState('');
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let current = true;
    setAuthorizationError('');
    setAuthorized(false);
    void bootstrapLocalStudioSession().then(() => {
      if (current) setAuthorized(true);
    }).catch((nextError) => {
      if (current) setAuthorizationError(nextError?.message || '本地 Studio 授权失败。请重试。');
    });
    return () => { current = false; };
  }, [attempt]);

  if (authorized) return <App />;
  if (!authorizationError) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在验证本地 Studio 授权</span></div>;
  return <main className="local-auth-failure" role="alert"><CircleAlert size={26} /><div><h1>无法授权本地 Studio</h1><p>{authorizationError}</p></div><button type="button" className="command-button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} />重试授权</button></main>;
}

function App() {
  const [studio, setStudio] = useState(null);
  const [provider, setProvider] = useState(null);
  const [projects, setProjects] = useState(EMPTY);
  const [assets, setAssets] = useState(EMPTY);
  const [sharedAssets, setSharedAssets] = useState(EMPTY);
  const [taskTypes, setTaskTypes] = useState(EMPTY);
  const [styleKits, setStyleKits] = useState(EMPTY);
  const [brandKits, setBrandKits] = useState(EMPTY);
  const [deliveries, setDeliveries] = useState(EMPTY);
  const [deliveryBatches, setDeliveryBatches] = useState(EMPTY);
  const [taskOverview, setTaskOverview] = useState(null);
  const [studioOverview, setStudioOverview] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(EMPTY);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [batchName, setBatchName] = useState('');
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState(new Set());
  const [creativeRecord, setCreativeRecord] = useState(null);
  const [assetProvenance, setAssetProvenance] = useState(null);
  const [deliveryBusyId, setDeliveryBusyId] = useState(null);
  const [deliveryCompletion, setDeliveryCompletion] = useState(null);
  const [deliveryCreating, setDeliveryCreating] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState(new Set());
  const [selectedImportNeed, setSelectedImportNeed] = useState('');
  const [projectTemplates, setProjectTemplates] = useState(PROJECT_CREATION_TEMPLATES);
  const [selectionAssets, setSelectionAssets] = useState(EMPTY);
  const [selectionBusyIds, setSelectionBusyIds] = useState(new Set());
  const [deliveryName, setDeliveryName] = useState('');
  const [assetFilter, setAssetFilter] = useState('all');
  const [assetPage, setAssetPage] = useState(1);
  const [assetPageSize, setAssetPageSize] = useState(() => normalizeAssetPageSize(window.localStorage.getItem(ASSET_PAGE_SIZE_KEY) || DEFAULT_ASSET_PAGE_SIZE));
  const [assetTotal, setAssetTotal] = useState(0);
  const [previewAssets, setPreviewAssets] = useState([]);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [advancedDetails, setAdvancedDetails] = useState(null);
  const [planVersions, setPlanVersions] = useState(EMPTY);
  const [planVersionsLoading, setPlanVersionsLoading] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => window.localStorage.getItem(RAIL_COLLAPSE_KEY) === '1');
  const [providerDetails, setProviderDetails] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState('');
  const [generationConfirmation, setGenerationConfirmation] = useState(null);
  const [generationConfirmationBusy, setGenerationConfirmationBusy] = useState(false);
  const [generationConfirmationError, setGenerationConfirmationError] = useState('');
  const [creationDialog, setCreationDialog] = useState(null);
  const [creationBusy, setCreationBusy] = useState(false);
  const [creationError, setCreationError] = useState('');
  const [referenceDialog, setReferenceDialog] = useState(null);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [referenceAssets, setReferenceAssets] = useState(EMPTY);
  const [referenceResolver, setReferenceResolver] = useState(null);
  const [pendingReferenceAfterRound, setPendingReferenceAfterRound] = useState(null);
  const [derivedDialog, setDerivedDialog] = useState(null);
  const [derivedBusy, setDerivedBusy] = useState(false);
  const [derivedError, setDerivedError] = useState('');
  const [rejectDialog, setRejectDialog] = useState(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState('');

  const [tasks, setTasks] = useState(EMPTY);
  const [rounds, setRounds] = useState(EMPTY);
  const [runs, setRuns] = useState(EMPTY);
  const [sessionPlanStatus, setSessionPlanStatus] = useState(null);
  const [runItemPage, setRunItemPage] = useState(EMPTY_RUN_ITEM_PAGE);
  const [lineageRunItems, setLineageRunItems] = useState(EMPTY);
  const [lineageRunItemCoverage, setLineageRunItemCoverage] = useState(EMPTY_LINEAGE_RUN_ITEM_COVERAGE);
  const [selectedRunItemIds, setSelectedRunItemIds] = useState(new Set());
  const [runItemDetailId, setRunItemDetailId] = useState(null);
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState(() => parseWorkbenchRoute(window.location.search));
  const [contextError, setContextError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [runtimeRepairing, setRuntimeRepairing] = useState(false);
  const [recoveryPhase, setRecoveryPhase] = useState('ready');
  const [pendingDerivedAfterTask, setPendingDerivedAfterTask] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [eventRevision, setEventRevision] = useState({ taskOverview: 0, creativeRecord: 0, studioOverview: 0, planVersions: 0, runs: 0, canvasLayout: 0 });
  const inputRef = useRef(null);
  const searchCoordinatorRef = useRef(null);
  const batchBusyRef = useRef(false);
  const batchOperationRef = useRef(null);
  const deliveryInteractionRef = useRef(null);
  const deliveryOperationEpoch = useRef(0);
  const activeProjectIdRef = useRef(null);
  const contextSignature = useRef('');
  const contextWriteQueue = useRef(Promise.resolve());
  const sessionRef = useRef(null);
  const desiredContextRef = useRef(null);
  const restoredSessionContext = useRef(false);
  const selectedAssetIdsRef = useRef(new Set());
  const selectionBusyIdsRef = useRef(new Set());
  const selectionWriteQueue = useRef(Promise.resolve());
  const selectionMutationEpoch = useRef(0);
  const selectionProjectIdRef = useRef(null);
  const taskOverviewRequests = useRef(null);
  const creativeRecordRequests = useRef(null);
  const studioOverviewRequests = useRef(null);
  const planVersionRequests = useRef(null);
  const advancedDetailRequests = useRef(null);
  const assetRequests = useRef(null);
  const selectionRequests = useRef(null);
  const recoveryPhaseRef = useRef('ready');
  const recoveryTimerRef = useRef(null);
  const restartMonitorEpoch = useRef(0);
  const sharedAssetRequests = useRef(null);
  const eventRefreshQueueRef = useRef(null);
  const eventRefreshCallbacks = useRef(null);
  taskOverviewRequests.current ||= createLatestRequestGate();
  creativeRecordRequests.current ||= createLatestRequestGate();
  studioOverviewRequests.current ||= createLatestRequestGate();
  planVersionRequests.current ||= createLatestRequestGate();
  advancedDetailRequests.current ||= createLatestRequestGate();
  assetRequests.current ||= createLatestRequestGate();
  selectionRequests.current ||= createLatestRequestGate();
  sharedAssetRequests.current ||= createLatestRequestGate();
  deliveryInteractionRef.current ||= createDeliveryInteractionGuard();
  searchCoordinatorRef.current ||= createStudioSearchCoordinator({
    request: async (query, signal) => (await api('/api/search?q=' + encodeURIComponent(query) + '&limit=12', { signal })).results || [],
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancelSchedule: (timer) => window.clearTimeout(timer)
  });
  useEffect(() => () => { restartMonitorEpoch.current += 1; if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current); }, []);
  const { view, projectId: activeProjectId, taskId: activeTaskId, roundId: activeRoundId, compareRoundIds = EMPTY, runId: activeRunId, assetScope, runItemFilter: activeRunItemFilter = DEFAULT_RUN_ITEM_FILTER, runItemPage: activeRunItemPage = 1, runItemPageSize: activeRunItemPageSize = DEFAULT_RUN_ITEM_PAGE_SIZE, runItemSequence: activeRunItemSequence = null } = route;
  const routeView = rendererForWorkbenchView(view);
  const studioView = isStudioView(view);
  activeProjectIdRef.current = activeProjectId;
  sessionRef.current = session;

  const navigateRoute = useCallback((changes, replace = false) => {
    const next = updateWorkbenchRoute(route, changes);
    const search = serializeWorkbenchRoute(next);
    window.history[replace ? 'replaceState' : 'pushState']({}, '', window.location.pathname + search);
    setRoute(next);
  }, [route]);

  useEffect(() => {
    const onPopState = () => { setRoute(parseWorkbenchRoute(window.location.search)); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openWorkbenchSession = useCallback(async () => {
    if (session) return session;
    const nextSession = await api('/api/sessions/open', { method: 'POST', idempotencyKey: uniqueKey('session-open'), body: { conversationId: workbenchConversationId(window.sessionStorage) } });
    setSession(nextSession);
    return nextSession;
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    if (!session) void openWorkbenchSession().catch((nextError) => {
      if (!cancelled) setError(nextError.message || '无法建立当前 Workbench 会话。');
    });
    return () => { cancelled = true; };
  }, [openWorkbenchSession, session]);

  const refreshWorkbenchSession = useCallback(async (sessionId) => {
    const data = await api('/api/sessions/' + encodeURIComponent(sessionId));
    const nextSession = data.session;
    if (nextSession) {
      sessionRef.current = nextSession;
      setSession(nextSession);
    }
    return nextSession || null;
  }, []);


  const refreshStudio = useCallback(async (request) => {
    const signal = request.signal;
    const [studioData, providerData, projectData, projectTemplateData, taskTypeData, styleKitData, brandKitData, sharedAssetData] = await Promise.all([
      api('/api/studio', { signal }),
      api('/api/providers', { signal }),
      api('/api/projects', { signal }),
      api('/api/project-templates', { signal }),
      api('/api/task-types', { signal }),
      api('/api/style-kits', { signal }),
      api('/api/brand-kits', { signal }),
      api('/api/shared-assets', { signal })
    ]);
    if (!request.isCurrent()) throw new DOMException('Stale refresh', 'AbortError');
    const nextProjects = projectData.projects || [];
    setStudio(studioData);
    setProvider({ ...(providerData.status || {}), reconfigurationPending: providerData.runtime?.reconfigurationPending === true });
    setProjects(nextProjects);
    setTaskTypes(taskTypeData.taskTypes || []);
    setProjectTemplates(projectTemplateData.templates || PROJECT_CREATION_TEMPLATES);
    setStyleKits(styleKitData.styleKits || []);
    setBrandKits(brandKitData.brandKits || []);
    setSharedAssets(sharedAssetData.assets || []);
    return nextProjects;
  }, []);

  const refreshContext = useCallback(async (knownProjects, request) => {
    const requireCurrent = () => {
      if (!request.isCurrent()) throw new DOMException('Stale refresh', 'AbortError');
    };
    const load = async (path) => {
      const data = await api(path, { signal: request.signal });
      requireCurrent();
      return data;
    };
    const clearLineageRunData = () => {
      setLineageRunItems(EMPTY);
      setLineageRunItemCoverage(EMPTY_LINEAGE_RUN_ITEM_COVERAGE);
    };
    const selectedProject = activeProjectId ? (knownProjects || []).find((project) => project.id === activeProjectId) || null : null;
    const loadLineageRuns = async (lineageRounds) => {
      if (view !== 'lineage' || !lineageRounds.length) return EMPTY;
      const runLists = await Promise.all(lineageRounds.map((round) => load('/api/rounds/' + encodeURIComponent(round.id) + '/runs').then((data) => data.runs || EMPTY)));
      requireCurrent();
      return runLists.flat();
    };
    if (activeProjectId && !selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); setDeliveries(EMPTY); setDeliveryBatches(EMPTY); clearLineageRunData();
      setContextError('该链接所指向的项目已不存在，或不属于当前 Studio。');
      return;
    }
    if (!selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); setDeliveries(EMPTY); setDeliveryBatches(EMPTY); clearLineageRunData();
      setContextError(activeTaskId || activeRoundId || activeRunId ? '请先选择一个项目，再继续查看任务、轮次或运行。' : '');
      return;
    }
    const needsDeliveries = view === 'deliveries' || view === 'lineage';
    const [taskData, deliveryData, batchData] = await Promise.all([
      load('/api/projects/' + encodeURIComponent(selectedProject.id) + '/tasks'),
      needsDeliveries ? load('/api/projects/' + encodeURIComponent(selectedProject.id) + '/deliveries') : Promise.resolve({ deliveries: EMPTY }),
      needsDeliveries ? load('/api/projects/' + encodeURIComponent(selectedProject.id) + '/delivery-batches') : Promise.resolve({ batches: EMPTY })
    ]);
    requireCurrent();
    const nextTasks = taskData.tasks || [];
    setTasks(nextTasks);
    setDeliveries(deliveryData.deliveries || []);
    setDeliveryBatches(batchData.batches || []);
    const selectedTask = activeTaskId ? nextTasks.find((task) => task.id === activeTaskId) || null : null;
    if (activeTaskId && !selectedTask) {
      setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError('该任务不属于当前项目，或已不存在。');
      return;
    }
    if (!selectedTask) {
      if (view === 'lineage') {
        const roundLists = await Promise.all(nextTasks.map((task) => load('/api/tasks/' + encodeURIComponent(task.id) + '/rounds').then((data) => data.rounds || EMPTY)));
        const projectRounds = roundLists.flat();
        setRounds(projectRounds);
        const projectRuns = await loadLineageRuns(projectRounds);
        setRuns(projectRuns);
        setRunItemPage(EMPTY_RUN_ITEM_PAGE);
        const lineage = await loadCompleteLineageRunItems(projectRuns, load, requireCurrent);
        requireCurrent();
        setLineageRunItems(lineage.items);
        setLineageRunItemCoverage({ loaded: lineage.loaded, total: lineage.total });
        setContextError('');
        return;
      }
      setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError(activeRoundId || activeRunId ? '请先选择一个任务，再继续查看轮次或运行。' : '');
      return;
    }
    const roundData = await load('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/rounds');
    const nextRounds = roundData.rounds || [];
    setRounds(nextRounds);
    const selectedRound = activeRoundId ? nextRounds.find((round) => round.id === activeRoundId) || null : null;
    if (activeRoundId && !selectedRound) {
      setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError('该轮次不属于当前任务，或已不存在。');
      return;
    }
    if (!selectedRound) {
      if (view === 'lineage') {
        const taskRuns = await loadLineageRuns(nextRounds);
        setRuns(taskRuns);
        setRunItemPage(EMPTY_RUN_ITEM_PAGE);
        const lineage = await loadCompleteLineageRunItems(taskRuns, load, requireCurrent);
        requireCurrent();
        setLineageRunItems(lineage.items);
        setLineageRunItemCoverage({ loaded: lineage.loaded, total: lineage.total });
        setContextError('');
        return;
      }
      setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError(activeRunId ? '请先打开生成运行视图，再继续查看运行。' : '');
      return;
    }
    if (!['runs', 'lineage'].includes(view)) {
      setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError(activeRunId ? '请先打开生成运行视图，再继续查看运行。' : '');
      return;
    }
    const runData = await load('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/runs');
    const nextRuns = runData.runs || [];
    setRuns(nextRuns);
    const selectedRun = activeRunId ? nextRuns.find((run) => run.id === activeRunId) || null : null;
    if (view === 'lineage') {
      setRunItemPage(EMPTY_RUN_ITEM_PAGE);
      const lineage = await loadCompleteLineageRunItems(nextRuns, load, requireCurrent);
      requireCurrent();
      setLineageRunItems(lineage.items);
      setLineageRunItemCoverage({ loaded: lineage.loaded, total: lineage.total });
      setContextError(activeRunId && !selectedRun ? '该运行不属于当前轮次，或已不存在。' : '');
      return;
    }
    clearLineageRunData();
    if (activeRunId && !selectedRun) {
      setRunItemPage(EMPTY_RUN_ITEM_PAGE);
      setContextError('该运行不属于当前轮次，或已不存在。');
    } else if (selectedRun) {
      const itemQuery = serializeRunItemRequestQuery({ page: activeRunItemPage, pageSize: activeRunItemPageSize, filter: activeRunItemFilter, sequence: activeRunItemSequence });
      const itemData = await load('/api/runs/' + encodeURIComponent(selectedRun.id) + '/items?' + itemQuery);
      setRunItemPage(normalizeRunItemPage(itemData, activeRunItemPageSize));
      setContextError('');
    } else {
      setRunItemPage(EMPTY_RUN_ITEM_PAGE);
      setContextError('');
    }
  }, [activeProjectId, activeTaskId, activeRoundId, activeRunId, activeRunItemFilter, activeRunItemPage, activeRunItemPageSize, activeRunItemSequence, view]);

  const refreshAssets = useCallback(async () => {
    if (!['assets', 'trash', 'deliveries', 'lineage'].includes(view)) {
      assetRequests.current.cancel();
      setAssets(EMPTY);
      setAssetTotal(0);
      return true;
    }
    const pagination = ['assets', 'trash'].includes(view) ? { page: assetPage, pageSize: assetPageSize, filter: assetFilter } : view === 'lineage' ? { page: 1, pageSize: LINEAGE_ASSET_PAGE_SIZE, filter: 'all' } : null;
    const path = assetRefreshPath(route, pagination);
    if (!path) {
      setAssets(EMPTY);
      setAssetTotal(0);
      return true;
    }
    const request = assetRequests.current.begin(path);
    try {
      const data = view === 'lineage' ? await loadCompleteLineageAssets(route, (nextPath) => api(nextPath, { signal: request.signal }), () => { if (!request.isCurrent()) throw new DOMException('Stale refresh', 'AbortError'); }) : await api(path, { signal: request.signal });
      if (!request.isCurrent()) return false;
      const nextAssets = data.assets || EMPTY;
      setAssets(nextAssets);
      setAssetTotal(Number.isInteger(data.total) ? data.total : nextAssets.length);
      return true;
    } catch (nextError) {
      if (!isAbortError(nextError) && request.isCurrent()) reportRefreshError(nextError);
      return false;
    }
  }, [assetFilter, assetPage, assetPageSize, route, view]);

  const refreshSelection = useCallback(async () => {
    if (!activeProjectId) {
      selectionRequests.current.cancel();
      applyProjectSelection({ assets: EMPTY });
      return true;
    }
    const projectId = activeProjectId;
    const observedMutationEpoch = selectionMutationEpoch.current;
    const request = selectionRequests.current.begin(projectId + ':' + observedMutationEpoch);
    try {
      const data = await api('/api/projects/' + encodeURIComponent(projectId) + '/selection', { signal: request.signal });
      if (!request.isCurrent() || selectionProjectIdRef.current !== projectId || observedMutationEpoch !== selectionMutationEpoch.current) return false;
      applyProjectSelection(data.selection);
      return true;
    } catch (nextError) {
      if (!isAbortError(nextError) && request.isCurrent()) setError(nextError.message || '无法读取当前选片。');
      return false;
    }
  }, [activeProjectId]);

  const refreshSharedAssets = useCallback(async () => {
    const request = sharedAssetRequests.current.begin('shared-assets');
    try {
      const data = await api('/api/shared-assets', { signal: request.signal });
      if (!request.isCurrent()) return false;
      setSharedAssets(data.assets || EMPTY);
      return true;
    } catch (nextError) {
      if (!isAbortError(nextError) && request.isCurrent()) setError(nextError.message || '无法读取共享素材。');
      return false;
    }
  }, []);

  const reportRefreshError = useCallback((nextError) => {
    if (nextError?.category === 'connection') setConnectionError(nextError.message || '无法连接本地 Studio。');
    else setError(nextError?.message || '无法读取本地 Studio。');
  }, []);
  const { refreshAll, refreshContext: refreshCurrentContext } = useRouteRefresh({
    route,
    beforeRefresh: openWorkbenchSession,
    refreshGlobal: refreshStudio,
    refreshContext,
    onError: reportRefreshError,
    onSettled: () => setLoading(false)
  });
  const refresh = useCallback(async () => {
    const refreshed = await refreshAll();
    return refreshed ? refreshAssets() : false;
  }, [refreshAll, refreshAssets]);
  useEffect(() => {
    void refreshAssets();
    return () => assetRequests.current.cancel();
  }, [refreshAssets]);
  const applyEventRefreshPlan = useCallback((plan) => {
    setEventRevision((current) => ({
      taskOverview: current.taskOverview + (plan.taskOverview ? 1 : 0),
      creativeRecord: current.creativeRecord + (plan.creativeRecord ? 1 : 0),
      studioOverview: current.studioOverview + (plan.studioOverview ? 1 : 0),
      planVersions: current.planVersions + (plan.planVersions ? 1 : 0),
      runs: current.runs + (plan.refreshContext ? 1 : 0),
      canvasLayout: current.canvasLayout + (plan.refreshCanvasLayout || plan.canvasLayout ? 1 : 0)
    }));
  }, []);
  eventRefreshCallbacks.current = {
    refresh: async (plan) => {
      const contextRefresh = plan.refreshContext ? (plan.scope === 'all' ? refreshAll() : refreshCurrentContext()) : Promise.resolve(true);
      const assetRefresh = plan.refreshAssets ? refreshAssets() : Promise.resolve(true);
      const selectionRefresh = plan.refreshSelection ? refreshSelection() : Promise.resolve(true);
      const sharedRefresh = plan.refreshSharedAssets && plan.scope !== 'all' ? refreshSharedAssets() : Promise.resolve(true);
      const refreshed = await Promise.all([contextRefresh, assetRefresh, selectionRefresh, sharedRefresh]);
      return refreshed.every(Boolean);
    },
    applyPlan: applyEventRefreshPlan
  };
  eventRefreshQueueRef.current ||= createEventRefreshQueue({
    refresh: (plan) => eventRefreshCallbacks.current.refresh(plan),
    applyPlan: (plan) => eventRefreshCallbacks.current.applyPlan(plan)
  });
  useEffect(() => () => eventRefreshQueueRef.current?.dispose(), []);
  const refreshForEvents = useCallback((events) => eventRefreshQueueRef.current.request(studioEventRefreshPlan(events)), []);
  const refreshSnapshot = useCallback(async () => {
    const refreshed = await refresh();
    const selectionRefreshed = refreshed ? await refreshSelection() : false;
    if (refreshed && selectionRefreshed) applyEventRefreshPlan({ taskOverview: true, creativeRecord: true, studioOverview: true, planVersions: true, refreshContext: true, canvasLayout: true });
    return refreshed && selectionRefreshed;
  }, [refresh, refreshSelection, applyEventRefreshPlan]);
  const updateRecoveryPhase = useCallback((phase) => { recoveryPhaseRef.current = phase; setRecoveryPhase(phase); }, []);
  const finishStudioRecovery = useCallback(async () => {
    if (!['stopping', 'reconnecting'].includes(recoveryPhaseRef.current)) return true;
    const restored = await refreshSnapshot();
    if (!restored) return false;
    restartMonitorEpoch.current += 1;
    setConnectionError('');
    updateRecoveryPhase('restored');
    if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = window.setTimeout(() => updateRecoveryPhase('ready'), 2400);
    return true;
  }, [refreshSnapshot, updateRecoveryPhase]);
  const monitorStudioRestart = useCallback(async (epoch, previousStartedAt) => {
    for (let attempt = 0; attempt < 100 && restartMonitorEpoch.current === epoch; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      try {
        const next = await api('/api/studio');
        const nextStartedAt = next?.runtime?.startedAt;
        if ((!previousStartedAt && nextStartedAt) || (previousStartedAt && nextStartedAt && nextStartedAt !== previousStartedAt)) {
          await finishStudioRecovery();
          return;
        }
      } catch { /* daemon is inside the expected restart gap */ }
    }
    if (restartMonitorEpoch.current === epoch) setError('Studio 重启超时。请复制脱敏诊断并检查本地 daemon 日志。');
  }, [finishStudioRecovery]);
  const beginStudioRestart = useCallback(() => {
    if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
    const epoch = ++restartMonitorEpoch.current;
    updateRecoveryPhase('stopping');
    void monitorStudioRestart(epoch, studio?.runtime?.startedAt || null);
  }, [monitorStudioRestart, studio?.runtime?.startedAt, updateRecoveryPhase]);
  const handleConnectionError = useCallback((message) => {
    setConnectionError(message);
    if (message) updateRecoveryPhase('reconnecting');
  }, [updateRecoveryPhase]);
  const handleReconnected = useCallback(async () => { await finishStudioRecovery(); }, [finishStudioRecovery]);
  useStudioEvents({
    studioId: studio?.studioId || null,
    onEventBatch: refreshForEvents,
    onSnapshot: refreshSnapshot,
    onConnectionError: handleConnectionError,
    onReconnected: handleReconnected,
    onRequestError: setError
  });

  const copyRuntimeDiagnostic = async () => {
    try {
      const diagnostic = redactedRuntimeDiagnostic({ studio, provider, recoveryPhase, connectionError });
      if (!navigator.clipboard?.writeText) throw new Error('当前浏览器未提供剪贴板权限。');
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
      setNotice('已复制脱敏运行诊断；内容不含 Provider 密钥或工作区路径。');
    } catch (nextError) { setError(nextError.message || '无法复制脱敏诊断。'); }
  };
  const repairRuntime = async () => {
    if (runtimeRepairing) return;
    setRuntimeRepairing(true);
    try {
      await api('/api/restart', { method: 'POST', idempotencyKey: uniqueKey('runtime-repair'), body: {} });
      beginStudioRestart();
    } catch (nextError) { setError(nextError.message || '无法安全重启 Studio。'); }
    finally { setRuntimeRepairing(false); }
  };
  useEffect(() => {
    if (!session) { setSessionPlanStatus(null); return undefined; }
    const controller = new AbortController();
     void api('/api/sessions/' + encodeURIComponent(session.id) + '/plan-status', { signal: controller.signal }).then(setSessionPlanStatus).catch((nextError) => {
       if (!isAbortError(nextError)) setError(nextError.message || '无法读取当前会话计划状态。');
     });
     return () => controller.abort();
  }, [session?.id, session?.version, eventRevision.planVersions, eventRevision.creativeRecord, eventRevision.runs]);

  const selectedProject = useMemo(() => activeProjectId ? projects.find((project) => project.id === activeProjectId) || null : null, [projects, activeProjectId]);
  const selectedTask = useMemo(() => activeTaskId ? tasks.find((task) => task.id === activeTaskId) || null : null, [tasks, activeTaskId]);
  const selectedRound = useMemo(() => activeRoundId ? rounds.find((round) => round.id === activeRoundId) || null : null, [rounds, activeRoundId]);
  const activeRun = useMemo(() => activeRunId ? runs.find((run) => run.id === activeRunId) || null : null, [runs, activeRunId]);
  useEffect(() => {
    if (!pendingDerivedAfterTask || !selectedTask || pendingDerivedAfterTask.taskId !== selectedTask.id) return;
    setDerivedError('');
    setDerivedDialog({ assets: pendingDerivedAfterTask.assets, purpose: pendingDerivedAfterTask.purpose, actionId: pendingDerivedAfterTask.actionId });
    setPendingDerivedAfterTask(null);
  }, [pendingDerivedAfterTask, selectedTask?.id]);
  useEffect(() => {
    deliveryOperationEpoch.current += 1;
    deliveryInteractionRef.current.reset();
    setDeliveryCreating(false);
    if (!selectedProject) { setDeliveryCompletion(null); return; }
    try {
      const stored = JSON.parse(window.localStorage.getItem(DELIVERY_COMPLETION_PREFIX + selectedProject.id) || 'null');
      setDeliveryCompletion(stored?.projectId === selectedProject.id && stored?.operationId ? stored : null);
    } catch {
      window.localStorage.removeItem(DELIVERY_COMPLETION_PREFIX + selectedProject.id);
      setDeliveryCompletion(null);
    }
  }, [selectedProject?.id]);
  const visibleAssets = view === 'trash' ? assets.filter((asset) => asset.deletedAt) : assets.filter((asset) => !asset.deletedAt);
  const selectedAssets = selectionAssets.filter((asset) => !asset.deletedAt);
  const totalAssetPages = assetPageCount(assetTotal, assetPageSize);
  const allPageAssetsSelected = visibleAssets.length > 0 && visibleAssets.every((asset) => selectedAssetIds.has(asset.id));
  const pageSelectionBusy = visibleAssets.some((asset) => selectionBusyIds.has(asset.id));
  const sharedAssetIds = useMemo(() => new Set(sharedAssets.map((asset) => asset.id)), [sharedAssets]);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const referenceMaterials = useMemo(() => normalizeReferenceMaterials(selectedRound?.plan || {}), [selectedRound?.id, selectedRound?.version, selectedRound?.plan]);
  const referenceAssetIds = useMemo(() => referenceMaterials.map((item) => item.assetId), [referenceMaterials]);
  const contextMaterialNeeds = useMemo(() => materialNeedsForContext(selectedProject, selectedTask, selectedRound, projectTemplates), [selectedProject, selectedTask, selectedRound, projectTemplates]);
  const materialNeedCounts = useMemo(() => materialNeedCompletionCounts(contextMaterialNeeds, assets, referenceMaterials), [contextMaterialNeeds.join('|'), assets, referenceMaterials]);
  const selectionAssetById = useMemo(() => new Map(selectionAssets.map((asset) => [asset.id, asset])), [selectionAssets]);
  const deliveryFlowAssets = deliveryCompletion ? deliveryCompletion.assetIds.map((assetId) => assetById.get(assetId) || selectionAssetById.get(assetId) || { id: assetId, display: { label: '已冻结交付图片' } }) : selectedAssets;
  const selectedTaskStatus = taskPresentation(selectedTask, rounds);
  const visibleRunItems = runItemPage.items;
  const lineageVisibleRunItems = view === 'lineage' ? lineageRunItems : visibleRunItems;
  const runExecutionStatus = runExecutionPresentationFromCounts(activeRun, runItemPage.statusCounts);
  const runItemDetail = useMemo(() => runItemDetailId ? visibleRunItems.find((item) => item.id === runItemDetailId) || null : null, [runItemDetailId, visibleRunItems]);
  const runLifecycleStatus = activeRun ? statusPresentation('run', activeRun.status) : null;
  const canCancelActiveRun = Boolean(activeRun && !['completed', 'cancelled'].includes(activeRun.status));
  const uploadTarget = assetScope === 'round' && selectedRound ? { type: 'creative_round', id: selectedRound.id } : assetScope === 'task' && selectedTask ? { type: 'creative_task', id: selectedTask.id } : selectedProject ? { type: 'project', id: selectedProject.id } : null;
  const canImport = ['assets', 'lineage'].includes(view) && Boolean(selectedProject);
  const importLabel = selectedImportNeed ? '导入“' + selectedImportNeed + '”' : selectedRound && assetScope === 'round' ? '添加为本轮参考' : '导入到项目';
  const deliverySelection = useMemo(() => projectDeliverySelection(selectedProject?.id || null, selectedAssets), [selectedProject?.id, selectedAssets]);
  const selectedDeliveryAssets = deliverySelection.eligibleAssets;
  useEffect(() => {
    if (!selectedProject || !referenceAssetIds.length) { setReferenceAssets(EMPTY); return undefined; }
    const controller = new AbortController();
    const params = new URLSearchParams({ projectId: selectedProject.id });
    for (const assetId of referenceAssetIds) params.append('assetId', assetId);
    void api('/api/assets/by-id?' + params.toString(), { signal: controller.signal }).then((data) => setReferenceAssets(data.assets || EMPTY)).catch((nextError) => {
      if (!isAbortError(nextError)) setReferenceError(nextError.message || '无法读取参考素材。');
    });
    return () => controller.abort();
  }, [selectedProject?.id, referenceAssetIds.join('|')]);

  const eligibleDeliveryIds = useMemo(() => new Set(deliveries.filter((delivery) => ['ready', 'exported'].includes(delivery.status)).map((delivery) => delivery.id)), [deliveries]);

  useEffect(() => {
    setAssetPage(1);
  }, [view, activeProjectId, activeTaskId, activeRoundId, assetScope]);
  useEffect(() => {
    setSelectedImportNeed((current) => contextMaterialNeeds.includes(current) ? current : contextMaterialNeeds[0] || '');
  }, [contextMaterialNeeds.join('|'), activeProjectId, activeTaskId, activeRoundId]);
  useEffect(() => {
    const nextPage = clampAssetPage(assetPage, assetTotal, assetPageSize);
    if (nextPage !== assetPage) setAssetPage(nextPage);
  }, [assetPage, assetTotal, assetPageSize]);
  useEffect(() => {
    window.localStorage.setItem(ASSET_PAGE_SIZE_KEY, String(assetPageSize));
  }, [assetPageSize]);
  useEffect(() => {
    if (view === 'runs' && activeRun && runItemPage.page !== activeRunItemPage) navigateRoute({ runItemPage: runItemPage.page }, true);
  }, [view, activeRun?.id, runItemPage.page, activeRunItemPage, navigateRoute]);
  useEffect(() => {
    setSelectedRunItemIds(new Set());
    setRunItemDetailId(null);
  }, [activeRunId, activeRunItemFilter, activeRunItemSequence]);
  useEffect(() => {
    const allowed = new Set(retryableRunItems(visibleRunItems).map((item) => item.id));
    setSelectedRunItemIds((current) => {
      const next = new Set([...current].filter((id) => allowed.has(id)));
      return next.size === current.size ? current : next;
    });
    if (runItemDetailId && !visibleRunItems.some((item) => item.id === runItemDetailId)) setRunItemDetailId(null);
  }, [visibleRunItems, runItemDetailId]);
  useEffect(() => {
    window.localStorage.setItem(RAIL_COLLAPSE_KEY, railCollapsed ? '1' : '0');
  }, [railCollapsed]);

  useEffect(() => {
    batchOperationRef.current = null;
    setBatchName('');
    setSelectedDeliveryIds(new Set());
  }, [activeProjectId]);

  useEffect(() => {
    if (selectionProjectIdRef.current !== activeProjectId) {
      selectionProjectIdRef.current = activeProjectId;
      selectionMutationEpoch.current += 1;
      selectedAssetIdsRef.current = new Set();
      selectionBusyIdsRef.current = new Set();
      setSelectedAssetIds(new Set());
      setSelectionAssets(EMPTY);
      setSelectionBusyIds(new Set());
    }
    if (!activeProjectId) return undefined;
    void refreshSelection();
    return () => selectionRequests.current.cancel();
  }, [activeProjectId, refreshSelection]);

  useEffect(() => {
    if (!selectedTask) { taskOverviewRequests.current.cancel(); setTaskOverview(null); return undefined; }
    const request = taskOverviewRequests.current.begin(selectedTask.id + ':' + eventRevision.taskOverview);
    void api('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/overview', { signal: request.signal }).then((data) => {
      if (request.isCurrent()) setTaskOverview(data.overview || null);
    }).catch((nextError) => {
      if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取任务创作概览。');
    });
    return () => request.abort();
  }, [selectedTask?.id, eventRevision.taskOverview]);
  useEffect(() => {
    if (!selectedRound) { creativeRecordRequests.current.cancel(); setCreativeRecord(null); return undefined; }
    const params = new URLSearchParams();
    params.set('includeItems', '0');
    if (activeRunId) params.set('runId', activeRunId);
    const signature = [selectedRound.id, activeRunId || '', eventRevision.creativeRecord].join(':');
    const request = creativeRecordRequests.current.begin(signature);
    void api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/creative-record?' + params.toString(), { signal: request.signal }).then((data) => {
      if (request.isCurrent()) setCreativeRecord(data.record || null);
    }).catch((nextError) => {
      if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取轮次创作记录。');
    });
    return () => request.abort();
  }, [selectedRound?.id, activeRunId, eventRevision.creativeRecord]);
  useEffect(() => {
    if (view !== 'studio-overview' || !selectedTask) { studioOverviewRequests.current.cancel(); setStudioOverview(null); return undefined; }
    const signature = [view, selectedTask.id, compareRoundIds.join('|'), eventRevision.studioOverview].join(':');
    const request = studioOverviewRequests.current.begin(signature);
    const params = new URLSearchParams();
    for (const roundId of compareRoundIds) params.append('round', roundId);
    void api('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/studio-overview?' + params.toString(), { signal: request.signal }).then((data) => {
      if (request.isCurrent()) setStudioOverview(data.overview || null);
    }).catch((nextError) => {
      if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取任务轮次比较。');
    });
    return () => request.abort();
  }, [view, selectedTask?.id, compareRoundIds.join('|'), eventRevision.studioOverview]);

  useEffect(() => {
    if (assetProvenance && !assets.some((asset) => asset.id === assetProvenance.asset?.id)) setAssetProvenance(null);
  }, [assets, assetProvenance]);
  useEffect(() => {
    if (!session || restoredSessionContext.current || route.projectId || studioView) return;
    restoredSessionContext.current = true;
    if (session.activeProjectId) navigateRoute({ view: 'lineage', projectId: session.activeProjectId, taskId: session.activeTaskId, roundId: session.activeRoundId, compareRoundIds: session.activeRoundId ? [session.activeRoundId] : [], runId: null, assetScope: session.activeRoundId ? 'round' : session.activeTaskId ? 'task' : 'project' }, true);
  }, [session, route.projectId, studioView, navigateRoute]);

  useEffect(() => {
    if (!session || !selectedProject || (activeTaskId && !selectedTask) || (activeRoundId && !selectedRound)) return;
    const desired = { signature: [selectedProject.id, selectedTask?.id || '', selectedRound?.id || ''].join(':'), projectId: selectedProject.id, taskId: selectedTask?.id || null, roundId: selectedRound?.id || null };
    if (desired.signature === contextSignature.current) return;
    contextSignature.current = desired.signature;
    desiredContextRef.current = desired;
    contextWriteQueue.current = contextWriteQueue.current.catch(() => undefined).then(async () => {
      const current = sessionRef.current;
      const target = desiredContextRef.current;
      if (!current || !target || target.signature !== contextSignature.current) return;
      try {
        const next = await api('/api/sessions/' + encodeURIComponent(current.id) + '/context', { method: 'POST', idempotencyKey: uniqueKey('session-context'), body: { projectId: target.projectId, taskId: target.taskId, roundId: target.roundId, expectedVersion: current.version } });
        sessionRef.current = next;
        setSession(next);
      } catch (nextError) {
        contextSignature.current = '';
        setError(nextError.message || '无法保存工作上下文。');
      }
    });
  }, [session, selectedProject, selectedTask, selectedRound, activeTaskId, activeRoundId]);

  const upload = async (files) => {
    const images = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;

    const failed = [];
    const uploadMaterialNeed = selectedImportNeed && contextMaterialNeeds.includes(selectedImportNeed) ? selectedImportNeed : '';
    const uploadMaterialPreset = uploadMaterialNeed ? materialNeedUsagePreset(uploadMaterialNeed) : assetScope === 'round' ? { usage: 'subject', usageLabel: REFERENCE_USAGE_LABELS.subject } : null;
    const importedAssets = [];
    try {
      setUploading(true); setUploadProgress({ completed: 0, total: images.length }); setError(''); setNotice('');
      await mapWithConcurrency(images, async (file) => {
        try {
          const response = await fetch('/api/assets/import', {
            method: 'POST',
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'idempotency-key': uniqueKey('upload'),
              'x-daoge-filename': encodeURIComponent(file.name),
              ...(uploadTarget ? { 'x-daoge-target-type': uploadTarget.type, 'x-daoge-target-id': uploadTarget.id } : {}),
              ...(uploadMaterialNeed ? { 'x-daoge-material-need': encodeURIComponent(uploadMaterialNeed), 'x-daoge-material-usage': uploadMaterialPreset.usage } : {})
            },
            body: file
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || '无法导入图片。');
          if (payload?.data?.id) importedAssets.push(payload.data);
        } catch (nextError) {
          failed.push({ name: file.name, message: nextError.message || '无法导入图片。' });
        }
        setUploadProgress((current) => ({ completed: Math.min(images.length, (current?.completed || 0) + 1), total: images.length }));
      }, ASSET_IMPORT_CONCURRENCY);
      await refresh();
      const succeeded = images.length - failed.length;
      let referenceSaved = false;
      if (succeeded && importedAssets.length && selectedRound && assetScope === 'round' && selectedRound.status === 'draft') {
        const materialMap = new Map(referenceMaterials.map((item) => [item.assetId, item]));
        const usage = uploadMaterialPreset?.usage || 'subject';
        const note = uploadMaterialNeed ? materialNeedReferenceNote(uploadMaterialNeed, usage) : '本轮直接导入 · ' + (REFERENCE_USAGE_LABELS[usage] || usage);
        for (const asset of importedAssets) materialMap.set(asset.id, { assetId: asset.id, usage, note });
        referenceSaved = await saveRoundReferenceMaterials([...materialMap.values()], false);
      }
      if (succeeded) setNotice('已导入 ' + succeeded + ' 张图片' + (referenceSaved ? '，并已按用途加入当前草稿轮次参考素材' : '') + (failed.length ? '，' + failed.length + ' 张失败。' : '。'));
      if (failed.length) setError('有 ' + failed.length + ' 张图片导入失败：' + failed.slice(0, 3).map((item) => item.name).join('、') + (failed.length > 3 ? ' 等' : '') + '。');
    } finally {
      setUploading(false); setUploadProgress(null); if (inputRef.current) inputRef.current.value = '';
    }
  };
  const importDerivedMaskAsset = async (file) => {
    if (!selectedProject) throw new Error('请先选择项目，再导入遮罩图。');
    if (!file?.type?.startsWith('image/')) throw new Error('请选择图片文件作为遮罩。');
    const response = await fetch('/api/assets/import', {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'idempotency-key': uniqueKey('mask-upload'),
        'x-daoge-filename': encodeURIComponent(file.name || 'mask.png'),
        'x-daoge-target-type': 'project',
        'x-daoge-target-id': selectedProject.id
      },
      body: file
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || '无法导入遮罩图。');
    await refresh();
    return payload.data;
  };

  const review = async (assetId, decision, feedback = {}) => {
    try {
      await api('/api/assets/' + encodeURIComponent(assetId) + '/review', { method: 'POST', idempotencyKey: uniqueKey('review'), body: { decision, taskId: selectedTask?.id, roundId: selectedRound?.id, feedback } });
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法保存选择。'); }
  };
  const moveAssetToTrash = async (assetId) => {
    await api('/api/assets/' + encodeURIComponent(assetId) + '/trash', { method: 'POST', idempotencyKey: uniqueKey('trash'), body: {} });
    await refresh();
  };
  const trash = async (assetId) => {
    try {
      const { impact } = await api('/api/assets/' + encodeURIComponent(assetId) + '/impact');
      if (impact.deliveryCount || impact.relationCount) {
        setConfirmationError('');
        setConfirmation({ kind: 'trash', assetId });
        return;
      }
      await moveAssetToTrash(assetId);
    } catch (nextError) { setError(nextError.message || '无法移入回收站。'); }
  };
  const restore = async (assetId) => { try { await api('/api/assets/' + encodeURIComponent(assetId) + '/restore', { method: 'POST', idempotencyKey: uniqueKey('restore'), body: {} }); await refresh(); } catch (nextError) { setError(nextError.message || '无法恢复资产。'); } };
  const applyProjectSelection = (selection) => {
    const nextAssets = selection?.assets || EMPTY;
    const ids = new Set(nextAssets.map((asset) => asset.id));
    selectedAssetIdsRef.current = ids;
    setSelectedAssetIds(ids);
    setSelectionAssets(nextAssets);
  };
  const markSelectionBusy = (assetIds, busy) => {
    for (const assetId of assetIds) { if (busy) selectionBusyIdsRef.current.add(assetId); else selectionBusyIdsRef.current.delete(assetId); }
    setSelectionBusyIds(new Set(selectionBusyIdsRef.current));
  };
  const enqueueSelectionWrite = (projectId, assetIds, request, fallbackMessage) => {
    const epoch = ++selectionMutationEpoch.current;
    markSelectionBusy(assetIds, true);
    const operation = selectionWriteQueue.current.catch(() => undefined).then(async () => {
      const data = await request();
      if (selectionProjectIdRef.current === projectId && epoch === selectionMutationEpoch.current) applyProjectSelection(data.selection);
    });
    selectionWriteQueue.current = operation.catch(() => undefined);
    void operation.catch(async (nextError) => {
      if (selectionProjectIdRef.current !== projectId || epoch !== selectionMutationEpoch.current) return;
      setError(nextError.message || fallbackMessage);
      await refresh();
    }).finally(() => { if (selectionProjectIdRef.current === projectId) markSelectionBusy(assetIds, false); });
  };
  const setAssetSelection = (assetId, selected) => {
    if (!selectedProject || selectionBusyIdsRef.current.has(assetId)) return;
    const nextIds = new Set(selectedAssetIdsRef.current);
    if (selected) nextIds.add(assetId); else nextIds.delete(assetId);
    selectedAssetIdsRef.current = nextIds;
    setSelectedAssetIds(new Set(nextIds));
    setSelectionAssets((current) => selected ? (current.some((asset) => asset.id === assetId) ? current : [...current, assetById.get(assetId)].filter(Boolean)) : current.filter((asset) => asset.id !== assetId));
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, [assetId], () => api('/api/projects/' + encodeURIComponent(projectId) + '/selection/assets/' + encodeURIComponent(assetId), { method: 'POST', idempotencyKey: uniqueKey('asset-selection'), body: { selected } }), '无法保存当前选片。');
  };
  const toggleSelection = (assetId) => setAssetSelection(assetId, !selectedAssetIdsRef.current.has(assetId));
  const markAsDeliverable = async (asset) => {
    if (!selectedProject) return;
    if (selectedAssetIdsRef.current.has(asset.id)) { toggleSelection(asset.id); return; }
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, [asset.id], async () => {
      if (asset.review?.decision !== 'keep') await api('/api/assets/' + encodeURIComponent(asset.id) + '/review', { method: 'POST', idempotencyKey: uniqueKey('delivery-keep'), body: { decision: 'keep' } });
      return api('/api/projects/' + encodeURIComponent(projectId) + '/selection/assets/' + encodeURIComponent(asset.id), { method: 'POST', idempotencyKey: uniqueKey('delivery-select'), body: { selected: true } });
    }, '无法将图片选为成果。');
  };
  const clearSelection = () => {
    if (!selectedProject || !selectionAssets.length) return;
    const selected = [...selectionAssets];
    selectedAssetIdsRef.current = new Set();
    setSelectedAssetIds(new Set());
    setSelectionAssets(EMPTY);
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, selected.map((asset) => asset.id), async () => {
      let latest = { assets: EMPTY };
      for (let offset = 0; offset < selected.length; offset += 500) {
        const data = await api('/api/projects/' + encodeURIComponent(projectId) + '/selection/batch', { method: 'POST', idempotencyKey: uniqueKey('asset-selection-clear'), body: { assetIds: selected.slice(offset, offset + 500).map((asset) => asset.id), selected: false } });
        latest = data.selection || latest;
      }
      return { selection: latest };
    }, '无法清空当前选片。');
  };
  const setPageSelection = (selected) => {
    if (!selectedProject || !visibleAssets.length || pageSelectionBusy) return;
    const candidates = visibleAssets.filter((asset) => selectedAssetIdsRef.current.has(asset.id) !== selected);
    if (!candidates.length) return;
    const projectId = selectedProject.id;
    const candidateIds = candidates.map((asset) => asset.id);
    enqueueSelectionWrite(projectId, candidateIds, () => api('/api/projects/' + encodeURIComponent(projectId) + '/selection/batch', { method: 'POST', idempotencyKey: uniqueKey('page-selection'), body: { assetIds: candidateIds, selected, keepAssetIds: selected ? candidates.filter((asset) => asset.review?.decision !== 'keep').map((asset) => asset.id) : [] } }), '无法更新本页选片。');
  };
  const setAssetsSelection = (assetIds, selected) => {
    if (!selectedProject || !assetIds.length) return;
    const uniqueIds = [...new Set(assetIds)].filter(Boolean);
    const nextIds = new Set(selectedAssetIdsRef.current);
    for (const assetId of uniqueIds) { if (selected) nextIds.add(assetId); else nextIds.delete(assetId); }
    selectedAssetIdsRef.current = nextIds;
    setSelectedAssetIds(new Set(nextIds));
    setSelectionAssets((current) => selected ? [...current, ...uniqueIds.map((assetId) => assetById.get(assetId)).filter((asset) => asset && !current.some((item) => item.id === asset.id))] : current.filter((asset) => !uniqueIds.includes(asset.id)));
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, uniqueIds, () => api('/api/projects/' + encodeURIComponent(projectId) + '/selection/batch', { method: 'POST', idempotencyKey: uniqueKey('canvas-selection'), body: { assetIds: uniqueIds, selected, keepAssetIds: selected ? uniqueIds.filter((assetId) => assetById.get(assetId)?.review?.decision !== 'keep') : [] } }), '无法更新创作谱系选片。');
  };
  const batchReview = async (assetIds, decision) => {
    try {
      const uniqueIds = [...new Set(assetIds)].filter(Boolean);
      for (const assetId of uniqueIds) await api('/api/assets/' + encodeURIComponent(assetId) + '/review', { method: 'POST', idempotencyKey: uniqueKey('canvas-review'), body: { decision, taskId: selectedTask?.id, roundId: selectedRound?.id, feedback: {} } });
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法批量保存评审。'); }
  };
  const inspectAsset = async (assetId) => {
    try { const data = await api('/api/assets/' + encodeURIComponent(assetId) + '/provenance'); setAssetProvenance(data.provenance || null); } catch (nextError) { setError(nextError.message || '无法读取素材来源与评审记录。'); }
  };
  const downloadAsset = (asset) => {
    const link = document.createElement('a');
    link.href = assetOriginalUrl(asset, true);
    link.download = 'daoge-pic-image';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const downloadArchive = (url) => {
    const link = document.createElement('a');
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const downloadProjectArchive = (assetIds) => {
    if (!selectedProject || !assetIds.length) { setError('请先在项目资产中选择要打包的图片。'); return; }
    downloadArchive(projectArchiveUrl(selectedProject.id, assetIds));
  };
  const downloadDeliveryArchive = (delivery, sequences) => {
    if (!sequences.length) { setError('请至少选择一张交付图片。'); return; }
    downloadArchive(deliveryArchiveUrl(delivery.id, sequences));
  };
  const setAssetShared = async (asset, shared) => {
    try {
      await api('/api/assets/' + encodeURIComponent(asset.id) + '/shared', { method: 'POST', idempotencyKey: uniqueKey('asset-shared'), body: { shared } });
      setNotice(shared ? '图片已加入跨项目共享素材。' : '图片已从跨项目共享素材移除。');
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法更新跨项目共享素材。'); }
  };
  const copyAsset = async (asset) => {
    const fileUrl = asset.fileUrl || assetOriginalUrl(asset);
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('图片暂时无法读取。');
      const image = await response.blob();
      if (await writeImageBlobToClipboard(image)) {
        setNotice(image.type === 'image/png' ? '图片已复制，可粘贴到支持图片的应用。' : '图片已转换为 PNG 并复制，可粘贴到支持图片的应用。');
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(new URL(fileUrl, window.location.href).href);
        setNotice('当前浏览器不支持直接复制图片，已复制图片链接。');
        return;
      }
      throw new Error('当前浏览器未提供剪贴板权限。');
    } catch (nextError) { setError(nextError.message || '无法复制图片，请使用下载原图。'); }
  };
  const completeDelivery = async () => {
    if (!selectedProject) { setError('请先打开一个项目。'); return; }
    if (!deliveryInteractionRef.current.begin()) return;
    let intent = deliveryCompletion;
    if (intent?.phase === 'complete') {
      window.localStorage.removeItem(DELIVERY_COMPLETION_PREFIX + intent.projectId);
      setDeliveryCompletion(null);
      setDeliveryName('');
      setNotice('交付已完成，图片已生成实体文件，可直接下载或复制。');
      deliveryInteractionRef.current.end();
      return;
    }
    if (!intent) {
      if (deliverySelection.state !== 'ready') {
        setError(deliverySelectionMessage(deliverySelection));
        deliveryInteractionRef.current.end();
        return;
      }
      intent = {
        operationId: uniqueKey('delivery-complete'),
        projectId: selectedProject.id,
        name: deliveryName.trim() || '交付-' + new Date().toISOString().slice(0, 10),
        assetIds: selectedDeliveryAssets.map((asset) => asset.id),
        phase: 'draft',
        stage: 'starting'
      };
      window.localStorage.setItem(DELIVERY_COMPLETION_PREFIX + intent.projectId, JSON.stringify(intent));
      setDeliveryCompletion(intent);
    }
    const projectId = intent.projectId;
    const operationEpoch = ++deliveryOperationEpoch.current;
    setDeliveryCreating(true);
    try {
      const result = await api('/api/deliveries/complete', { method: 'POST', idempotencyKey: intent.operationId, body: { projectId, name: intent.name, assetIds: intent.assetIds, phase: intent.phase } });
      const nextIntent = result.nextAction ? { ...intent, deliveryId: result.delivery.id, phase: result.nextAction, stage: result.stage } : { ...intent, deliveryId: result.delivery.id, phase: 'complete', stage: 'exported' };
      window.localStorage.setItem(DELIVERY_COMPLETION_PREFIX + projectId, JSON.stringify(nextIntent));
      if (isDeliveryOperationCurrent({ activeProjectId: activeProjectIdRef.current, projectId, currentEpoch: deliveryOperationEpoch.current, operationEpoch })) {
        setDeliveryCompletion(nextIntent);
        setNotice(result.nextAction ? result.stage === 'draft' ? '交付草稿已唯一创建。下一步准备交付。' : '交付已准备完成。下一步导出实体文件。' : '实体文件已导出。检查后完成本次交付。');
        await refresh();
      }
    } catch (nextError) {
      if (isDeliveryOperationCurrent({ activeProjectId: activeProjectIdRef.current, projectId, currentEpoch: deliveryOperationEpoch.current, operationEpoch })) setError(nextError.message || '无法继续交付；当前阶段已保留，可重试。');
    } finally {
      if (isDeliveryOperationCurrent({ activeProjectId: activeProjectIdRef.current, projectId, currentEpoch: deliveryOperationEpoch.current, operationEpoch })) {
        deliveryInteractionRef.current.end();
        setDeliveryCreating(false);
      }
    }
  };
  const deliveryAction = async (delivery, action) => {
    setDeliveryBusyId(delivery.id);
    try {
      if (action === 'update') {
        if (deliverySelection.state !== 'ready') throw new Error(deliverySelectionMessage(deliverySelection));
        await api('/api/deliveries/' + encodeURIComponent(delivery.id) + '/items', { method: 'PUT', idempotencyKey: uniqueKey('delivery-update'), body: { assetIds: selectedDeliveryAssets.map((asset) => asset.id) } });
      } else {
        const path = action === 'ready' ? '/ready' : action === 'draft' ? '/draft' : '/export';
        await api('/api/deliveries/' + encodeURIComponent(delivery.id) + path, { method: 'POST', idempotencyKey: uniqueKey('delivery-' + action), body: {} });
      }
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法更新交付状态。'); } finally { setDeliveryBusyId(null); }
  };
  const toggleComparedRound = (roundId) => {
    const next = compareRoundIds.includes(roundId) ? compareRoundIds.filter((id) => id !== roundId) : [...compareRoundIds, roundId].slice(0, 12);
    navigateRoute({ view: 'studio-overview', roundId: next[0] || null, compareRoundIds: next, runId: null, assetScope: 'task' });
  };
  useEffect(() => {
    searchCoordinatorRef.current.search(searchQuery, (state) => {
      setSearchResults(state.results);
      setSearchError(state.error);
      setSearchLoading(state.loading);
    });
    return () => searchCoordinatorRef.current.cancel();
  }, [searchQuery]);
  useEffect(() => () => searchCoordinatorRef.current.dispose(), []);
  const openSearchResult = (result) => {
    const changes = result.entityType === 'project' ? { view: 'lineage', projectId: result.projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' } : { view: 'lineage', projectId: result.projectId, taskId: result.taskId, roundId: result.entityType === 'round' ? result.entityId : null, compareRoundIds: result.entityType === 'round' ? [result.entityId] : [], runId: null, assetScope: result.entityType === 'round' ? 'round' : 'task' };
    setSearchResults(EMPTY); setSearchQuery(''); navigateRoute(changes);
  };
  const openCreationDialog = (kind) => {
    setCreationError('');
    setNotice('');
    setCreationDialog(kind);
  };
  const dismissCreationDialog = () => {
    if (creationBusy) return;
    setCreationDialog(null);
    setCreationError('');
  };
  const afterCreationContext = async (currentSession, projectId, taskId = null, roundId = null) => {
    contextSignature.current = [projectId || '', taskId || '', roundId || ''].join(':');
    if (currentSession?.id) await refreshWorkbenchSession(currentSession.id);
  };
  const createProjectFromStudio = async (form) => {
    if (creationBusy) return;
    if (!form.name) { setCreationError('请输入项目名称。'); return; }
    setCreationBusy(true);
    setCreationError('');
    setError('');
    try {
      const currentSession = sessionRef.current || session || await openWorkbenchSession();
      const receipt = await api('/api/projects', { method: 'POST', idempotencyKey: uniqueKey('studio-project-create'), body: { name: form.name, description: form.description || undefined, templateId: form.templateId || undefined, templateVersion: form.templateVersion || undefined, sessionId: currentSession?.id } });
      const project = receipt.value;
      await afterCreationContext(currentSession, project.id);
      setCreationDialog(null);
      await refresh();
      navigateRoute(selectProject(route, project.id));
    } catch (nextError) {
      setCreationError(nextError.message || '无法创建项目。');
    } finally {
      setCreationBusy(false);
    }
  };
  const createTaskFromStudio = async (form) => {
    if (creationBusy || !selectedProject) return;
    if (!form.name) { setCreationError('请输入任务名称。'); return; }
    setCreationBusy(true);
    setCreationError('');
    setError('');
    try {
      const currentSession = sessionRef.current || session || await openWorkbenchSession();
      const taskReceipt = await api('/api/tasks', { method: 'POST', idempotencyKey: uniqueKey('studio-task-create'), body: { projectId: selectedProject.id, name: form.name, taskTypeId: form.taskTypeId || undefined, styleKitId: form.styleKitId || undefined, brandKitId: form.brandKitId || undefined, intent: form.intent, sessionId: currentSession?.id } });
      const createdTask = taskReceipt.value;
      let createdRound = null;
      if (form.createRound) {
        const roundReceipt = await api('/api/rounds', { method: 'POST', idempotencyKey: uniqueKey('studio-round-create'), body: { taskId: createdTask.id, purpose: form.roundPurpose, plan: form.plan, sessionId: currentSession?.id } });
        createdRound = roundReceipt.value;
      }
      await afterCreationContext(currentSession, selectedProject.id, createdTask.id, createdRound?.id || null);
      setCreationDialog(null);
      await refresh();
      navigateRoute(createdRound ? { view: 'lineage', projectId: selectedProject.id, taskId: createdTask.id, roundId: createdRound.id, compareRoundIds: [createdRound.id], runId: null, assetScope: 'round' } : selectTask(route, createdTask.id));
    } catch (nextError) {
      setCreationError(nextError.message || '无法创建任务。');
    } finally {
      setCreationBusy(false);
    }
  };
  const createRoundFromStudio = async (form) => {
    if (creationBusy || !selectedProject || !selectedTask) return;
    setCreationBusy(true);
    setCreationError('');
    setError('');
    try {
      const currentSession = sessionRef.current || session || await openWorkbenchSession();
      const receipt = await api('/api/rounds', { method: 'POST', idempotencyKey: uniqueKey('studio-round-create'), body: { taskId: selectedTask.id, purpose: form.purpose, parentRoundId: form.parentRoundId || undefined, plan: form.plan, sessionId: currentSession?.id } });
      const createdRound = receipt.value;
      const pendingReference = pendingReferenceAfterRound;
      let referenceAttachError = '';
      if (pendingReference?.assets?.length) {
        const materialMap = new Map(normalizeReferenceMaterials(createdRound.plan || {}).map((item) => [item.assetId, item]));
        for (const asset of pendingReference.assets) materialMap.set(asset.id, { assetId: asset.id, usage: pendingReference.usage, note: REFERENCE_USAGE_LABELS[pendingReference.usage] || pendingReference.usage });
        try {
          const plan = planWithReferenceMaterials(createdRound.plan || {}, [...materialMap.values()]);
          await api('/api/rounds/' + encodeURIComponent(createdRound.id) + '/draft-context', { method: 'PUT', idempotencyKey: uniqueKey('round-reference-create'), body: { plan, expectedVersion: createdRound.version } });
        } catch (nextError) {
          referenceAttachError = nextError.message || '参考素材未能自动加入。';
        }
        setPendingReferenceAfterRound(null);
      }
      await afterCreationContext(currentSession, selectedProject.id, selectedTask.id, createdRound.id);
      setCreationDialog(null);
      if (referenceAttachError) setError('轮次已创建，但参考素材未能自动加入：' + referenceAttachError);
      await refresh();
      navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: selectedTask.id, roundId: createdRound.id, compareRoundIds: [createdRound.id], runId: null, assetScope: 'round' });
    } catch (nextError) {
      setCreationError(nextError.message || '无法创建轮次。');
    } finally {
      setCreationBusy(false);
    }
  };

  const restoreSessionContext = (context) => {
    if (!context?.project?.id) return;
    navigateRoute({ view: 'lineage', projectId: context.project.id, taskId: context.task?.id || null, roundId: context.round?.id || null, compareRoundIds: context.round?.id ? [context.round.id] : [], runId: null, assetScope: context.round?.id ? 'round' : context.task?.id ? 'task' : 'project' });
  };
  const openReferenceDialog = () => {
    if (!selectedProject || !selectedTask || !selectedRound) { setError('请先选择项目、任务和轮次。'); return; }
    if (selectedRound.status !== 'draft') { setError('当前轮次已进入确认或运行流程，参考素材请回到 Agent 修改计划。'); return; }
    setReferenceError('');
    setReferenceDialog('round');
  };
  const dismissReferenceDialog = () => {
    if (referenceBusy) return;
    setReferenceDialog(null);
    setReferenceError('');
  };
  const dismissReferenceResolver = () => {
    if (referenceBusy) return;
    setReferenceResolver(null);
    setReferenceError('');
  };
  const taskForId = (taskId, taskList = tasks) => taskList.find((task) => task.id === taskId) || null;
  const roundForId = (roundId, roundList = rounds) => roundList.find((round) => round.id === roundId) || null;
  const draftRoundsForTask = (task, roundList = rounds) => task ? roundList.filter((round) => round.taskId === task.id && round.status === 'draft') : EMPTY;
  const draftRoundsForCurrentTask = () => draftRoundsForTask(selectedTask);
  const referenceTaskIdsForAssets = (sourceAssets, roundList = rounds) => [...new Set(sourceAssets.flatMap((asset) => {
    const sourceRound = roundForId(asset?.display?.roundId || asset?.source?.roundId || asset?.source?.creativeRoundId || null, roundList);
    return [asset?.display?.taskId, asset?.source?.taskId, asset?.source?.creativeTaskId, sourceRound?.taskId].filter(Boolean);
  }))];
  const referenceTargetForAssets = (sourceAssets, availableRounds = rounds) => {
    if (selectedRound?.status === 'draft') return { task: selectedTask || taskForId(selectedRound.taskId), draftRounds: [selectedRound], tasks: selectedTask ? [selectedTask] : tasks };
    if (selectedTask) return { task: selectedTask, draftRounds: draftRoundsForTask(selectedTask, availableRounds), tasks: [selectedTask] };
    const inferredTasks = referenceTaskIdsForAssets(sourceAssets, availableRounds).map(taskForId).filter(Boolean);
    if (inferredTasks.length === 1) return { task: inferredTasks[0], draftRounds: draftRoundsForTask(inferredTasks[0], availableRounds), tasks: inferredTasks };
    const allDraftRounds = availableRounds.filter((round) => round.status === 'draft');
    if (allDraftRounds.length === 1) {
      const task = taskForId(allDraftRounds[0].taskId);
      return { task, draftRounds: allDraftRounds, tasks: task ? [task] : tasks };
    }
    if (tasks.length === 1) return { task: tasks[0], draftRounds: draftRoundsForTask(tasks[0], availableRounds), tasks };
    return { task: null, draftRounds: allDraftRounds, tasks };
  };
  const loadReferenceRounds = async (candidateTasks) => {
    const taskList = [...new Map(candidateTasks.filter((task) => task?.id).map((task) => [task.id, task])).values()];
    if (!taskList.length) return rounds;
    const roundLists = await Promise.all(taskList.map((task) => api('/api/tasks/' + encodeURIComponent(task.id) + '/rounds').then((data) => data.rounds || EMPTY)));
    const loadedRounds = [...new Map([...rounds, ...roundLists.flat()].map((round) => [round.id, round])).values()];
    setRounds((current) => [...new Map([...current, ...roundLists.flat()].map((round) => [round.id, round])).values()]);
    return loadedRounds;
  };
  const saveReferenceMaterialsForRound = async (round, materials, close = true, message = '') => {
    if (referenceBusy || !selectedProject || !round) return false;
    if (round.status !== 'draft') { setReferenceError('当前轮次已进入确认或运行流程，不能在 Studio 直接改参考素材。'); return false; }
    setReferenceBusy(true);
    setReferenceError('');
    try {
      const plan = planWithReferenceMaterials(round.plan || {}, materials);
      await api('/api/rounds/' + encodeURIComponent(round.id) + '/draft-context', { method: 'PUT', idempotencyKey: uniqueKey('round-reference'), body: { plan, expectedVersion: round.version } });
      if (close) setReferenceDialog(null);
      setNotice(message || (materials.length ? '参考素材已保存到当前轮次上下文。请回到 Agent 整理并确认生成计划。' : '当前轮次参考素材已清空。'));
      await refresh();
      setEventRevision((current) => ({ ...current, planVersions: current.planVersions + 1, creativeRecord: current.creativeRecord + 1 }));
      return true;
    } catch (nextError) {
      setReferenceError(nextError.message || '无法保存参考素材。');
      setError(nextError.message || '无法保存参考素材。');
      return false;
    } finally {
      setReferenceBusy(false);
    }
  };
  const chooseReferenceTask = (taskId) => {
    if (!referenceResolver) return;
    const nextTask = tasks.find((item) => item.id === taskId) || null;
    if (!nextTask) { setReferenceError('这个任务已不可用，请刷新后重试。'); return; }
    const availableRounds = [...new Map([...rounds, ...referenceResolver.draftRounds].map((round) => [round.id, round])).values()];
    setReferenceResolver((current) => current ? { ...current, task: nextTask, draftRounds: draftRoundsForTask(nextTask, availableRounds), tasks } : current);
    setReferenceError('');
  };
  const saveRoundReferenceMaterials = async (materials, close = true) => saveReferenceMaterialsForRound(selectedRound, materials, close);
  const addAssetsToRoundReferences = async (round, sourceAssets, usage = 'subject', message = '') => {
    const materialMap = new Map(normalizeReferenceMaterials(round?.plan || {}).map((item) => [item.assetId, item]));
    for (const asset of sourceAssets) materialMap.set(asset.id, { assetId: asset.id, usage, note: REFERENCE_USAGE_LABELS[usage] || usage });
    return saveReferenceMaterialsForRound(round, [...materialMap.values()], false, message);
  };
  const chooseReferenceRound = async (roundId) => {
    if (!referenceResolver) return;
    const round = rounds.find((item) => item.id === roundId) || referenceResolver.draftRounds.find((item) => item.id === roundId) || null;
    if (!round || round.status !== 'draft') { setReferenceError('这个草稿轮次已不可用，请刷新后重试。'); return; }
    const targetTask = taskForId(round.taskId) || referenceResolver.task || selectedTask;
    const label = (ROUND_PURPOSE_LABELS[round.purpose] || round.purpose) + ' · 计划 v' + round.planVersion;
    const saved = await addAssetsToRoundReferences(round, referenceResolver.assets, referenceResolver.usage, '参考素材已加入“' + label + '”。请回到 Agent 整理并确认生成计划。');
    if (saved) {
      setReferenceResolver(null);
      navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: targetTask?.id || round.taskId, roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' });
    }
  };
  const createRoundForPendingReference = () => {
    if (!referenceResolver) return;
    const targetTask = referenceResolver.task || (referenceResolver.tasks?.length === 1 ? referenceResolver.tasks[0] : null);
    if (!targetTask) { setReferenceError('请先进入一个任务，再新建草稿轮次。'); return; }
    setPendingReferenceAfterRound({ assets: referenceResolver.assets, usage: referenceResolver.usage });
    setReferenceResolver(null);
    if (!selectedTask || selectedTask.id !== targetTask.id) navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: targetTask.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
    openCreationDialog('round');
  };
  const removeRoundReference = (assetId) => {
    void saveRoundReferenceMaterials(referenceMaterials.filter((item) => item.assetId !== assetId), false);
  };
  const openDerivedRoundDialog = (nextAssets, purpose = 'variation', actionId = '') => {
    const sourceAssets = (nextAssets || EMPTY).filter((asset) => asset && !asset.deletedAt);
    if (!selectedProject) { setError('请先打开一个项目，再继续创作。'); return; }
    if (!sourceAssets.length) { setError('请先选择至少一张可用图片。'); return; }
    const inferredTasks = referenceTaskIdsForAssets(sourceAssets).map(taskForId).filter(Boolean);
    const targetTask = selectedTask || (inferredTasks.length === 1 ? inferredTasks[0] : tasks.length === 1 ? tasks[0] : null);
    if (!targetTask) { setError(tasks.length ? '请先选择任务，再继续创作。' : '请先新建任务，再继续创作。'); return; }
    setError('');
    setPreviewAssets(EMPTY);
    setDerivedError('');
    if (!selectedTask || selectedTask.id !== targetTask.id) {
      setPendingDerivedAfterTask({ assets: sourceAssets, purpose, actionId, taskId: targetTask.id });
      navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: targetTask.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
      return;
    }
    setDerivedDialog({ assets: sourceAssets, purpose, actionId });
  };
  const dismissDerivedDialog = () => {
    if (derivedBusy) return;
    setDerivedDialog(null);
    setDerivedError('');
  };
  const createDerivedRoundFromAssets = async (form) => {
    if (derivedBusy || !selectedProject || !selectedTask) return;
    setDerivedBusy(true);
    setDerivedError('');
    setError('');
    try {
      const currentSession = sessionRef.current || session || await openWorkbenchSession();
      const receipt = await api('/api/rounds/derived', { method: 'POST', idempotencyKey: uniqueKey('studio-derived-round'), body: { ...form, taskId: selectedTask.id, sessionId: currentSession?.id } });
      const createdRound = receipt.value;
      await afterCreationContext(currentSession, selectedProject.id, selectedTask.id, createdRound.id);
      setDerivedDialog(null);
      setNotice('已基于图片创建下一轮草稿，并设为当前上下文。已回到创作谱系；请让 Agent 整理可确认计划。');
      await refresh();
      navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: selectedTask.id, roundId: createdRound.id, compareRoundIds: [createdRound.id], runId: null, assetScope: 'round' });
    } catch (nextError) {
      setDerivedError(nextError.message || '无法基于图片创建下一轮。');
    } finally {
      setDerivedBusy(false);
    }
  };
  const addAssetsToCurrentRoundReferences = async (nextAssets, usage = 'subject') => {
    const sourceAssets = (nextAssets || EMPTY).filter((asset) => asset && !asset.deletedAt);
    if (!selectedProject) { setError('请先打开一个项目，再把图片作为参考。'); return false; }
    if (!sourceAssets.length) { setError('请先选择至少一张可用图片。'); return false; }
    let target = referenceTargetForAssets(sourceAssets);
    if (selectedRound?.status !== 'draft') {
      const inferredTasks = referenceTaskIdsForAssets(sourceAssets).map(taskForId).filter(Boolean);
      const candidateTasks = selectedTask ? [selectedTask] : inferredTasks.length ? inferredTasks : tasks;
      try {
        const availableRounds = await loadReferenceRounds(candidateTasks);
        target = referenceTargetForAssets(sourceAssets, availableRounds);
      } catch (nextError) {
        setError(nextError.message || '无法读取可用草稿轮次，请刷新后重试。');
        return false;
      }
    }
    if (target.draftRounds.length === 1) {
      const round = target.draftRounds[0];
      const targetTask = target.task || taskForId(round.taskId);
      const label = (ROUND_PURPOSE_LABELS[round.purpose] || round.purpose) + ' · 计划 v' + round.planVersion;
      const saved = await addAssetsToRoundReferences(round, sourceAssets, usage, '已自动加入草稿轮次“' + label + '”。请回到 Agent 整理并确认生成计划。');
      if (saved) navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: targetTask?.id || round.taskId, roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' });
      return saved;
    }
    if (!target.task && !target.draftRounds.length && !target.tasks.length) { setError('请先新建任务和草稿轮次，再把图片作为参考。'); return false; }
    setError('');
    setReferenceError('');
    setPreviewAssets(EMPTY);
    setReferenceResolver({ assets: sourceAssets, usage, task: target.task, tasks: target.tasks, draftRounds: target.draftRounds });
    return false;
  };
  const openRejectReviewDialog = (nextAssets, options = {}) => {
    const sourceAssets = (nextAssets || EMPTY).filter((asset) => asset && !asset.deletedAt);
    if (!sourceAssets.length) { setError('请先选择至少一张可用图片。'); return; }
    setPreviewAssets(EMPTY);
    setRejectError('');
    setRejectDialog({ assets: sourceAssets, createNextRound: Boolean(options?.createNextRound) });
  };
  const dismissRejectDialog = () => {
    if (rejectBusy) return;
    setRejectDialog(null);
    setRejectError('');
  };
  const saveRejectReview = async (feedback, options = {}) => {
    if (rejectBusy || !rejectDialog?.assets?.length) return;
    const addAsNegative = typeof options === 'boolean' ? options : Boolean(options?.addAsNegative);
    const createNextRound = typeof options === 'object' && Boolean(options?.createNextRound);
    if (createNextRound && (!selectedProject || !selectedTask)) { setRejectError('请先选择项目和任务，再从反馈创建下一轮。'); return; }
    setRejectBusy(true);
    setRejectError('');
    try {
      const rejectedAssets = rejectDialog.assets;
      for (const asset of rejectedAssets) await api('/api/assets/' + encodeURIComponent(asset.id) + '/review', { method: 'POST', idempotencyKey: uniqueKey('reject-review'), body: { decision: 'reject', taskId: selectedTask?.id, roundId: selectedRound?.id, feedback } });
      setRejectDialog(null);
      if (createNextRound) {
        const currentSession = sessionRef.current || session || await openWorkbenchSession();
        const form = rejectFeedbackToDerivedForm(feedback, rejectedAssets);
        const receipt = await api('/api/rounds/derived', { method: 'POST', idempotencyKey: uniqueKey('reject-derived-round'), body: { ...form, taskId: selectedTask.id, sessionId: currentSession?.id } });
        const createdRound = receipt.value;
        await afterCreationContext(currentSession, selectedProject.id, selectedTask.id, createdRound.id);
        setNotice('不采用原因已保存，并已创建带反例参考的下一轮草稿。请让 Agent 基于新上下文整理计划。');
        await refresh();
        navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: selectedTask.id, roundId: createdRound.id, compareRoundIds: [createdRound.id], runId: null, assetScope: 'round' });
        return;
      }
      const negativeSaved = addAsNegative ? await addAssetsToCurrentRoundReferences(rejectedAssets, 'negative') : false;
      if (!addAsNegative) await refresh();
      setNotice(negativeSaved ? '不采用原因已保存，并已作为当前草稿轮次反例参考。' : '不采用原因已保存。');
    } catch (nextError) {
      setRejectError(nextError.message || '无法保存不采用原因。');
    } finally {
      setRejectBusy(false);
    }
  };

  const toggleBatchDelivery = (deliveryId) => setSelectedDeliveryIds((current) => { const next = new Set(current); if (next.has(deliveryId)) next.delete(deliveryId); else next.add(deliveryId); return next; });
  const batchAction = async (action, batch = null, version = null) => {
    if (batchBusyRef.current) return;
    const snapshot = createBatchOperationSnapshot({ action, batchId: batch?.id || null, versionId: version?.id || null, deliveryIds: selectedDeliveryIds, eligibleDeliveryIds, name: batchName });
    const signature = batchOperationSignature(snapshot);
    if (!batchOperationRef.current || batchOperationRef.current.signature !== signature) batchOperationRef.current = { signature, key: uniqueKey('batch-' + action) };
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      if (snapshot.action === 'create') {
        if (!selectedProject || !snapshot.deliveryIds.length) throw new Error('请选择至少一份已准备或已导出的交付。');
        await api('/api/delivery-batches', { method: 'POST', idempotencyKey: batchOperationRef.current.key, body: { projectId: selectedProject.id, name: snapshot.name || '交付批次-' + new Date().toISOString().slice(0, 10), deliveryIds: snapshot.deliveryIds } });
        setBatchName(''); setSelectedDeliveryIds(new Set());
      } else if (snapshot.action === 'revise') {
        await api('/api/delivery-batches/' + encodeURIComponent(snapshot.batchId) + '/revisions', { method: 'POST', idempotencyKey: batchOperationRef.current.key, body: { deliveryIds: snapshot.deliveryIds } });
      } else if (snapshot.versionId) {
        await api('/api/delivery-batch-versions/' + encodeURIComponent(snapshot.versionId) + '/ready', { method: 'POST', idempotencyKey: batchOperationRef.current.key, body: {} });
      }
      batchOperationRef.current = null;
      await refresh();
    } catch (nextError) {
      setError(nextError.message || '无法更新交付批次。');
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  };
  const updateRunItemControls = (changes) => navigateRoute(changes, false);
  const setRunItemFilter = (filter) => updateRunItemControls({ runItemFilter: normalizeRunItemFilter(filter), runItemPage: 1 });
  const setRunItemPageNumber = (page) => updateRunItemControls({ runItemPage: normalizeRunItemPageNumber(page) });
  const setRunItemPageSizeValue = (pageSize) => updateRunItemControls({ runItemPageSize: normalizeRunItemPageSize(pageSize), runItemPage: 1 });
  const setRunItemSequenceValue = (sequence) => updateRunItemControls({ runItemSequence: normalizeRunItemSequence(sequence), runItemPage: 1 });
  const toggleRunItemSelection = (itemId) => {
    const item = retryableRunItems(visibleRunItems).find((candidate) => candidate.id === itemId);
    if (!item) return;
    setSelectedRunItemIds((current) => { const next = new Set(current); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next; });
  };
  const selectRetryablePageItems = (selected) => {
    const pageIds = retryableRunItems(visibleRunItems).map((item) => item.id);
    setSelectedRunItemIds((current) => { const next = new Set(current); for (const itemId of pageIds) selected ? next.add(itemId) : next.delete(itemId); return next; });
  };
  const retryRunItemsByIds = async (itemIds) => {
    if (!activeRun) return;
    const retryIds = [...new Set(itemIds)].filter(Boolean);
    if (!retryIds.length) return;
    try {
      await api('/api/runs/' + encodeURIComponent(activeRun.id) + '/retry', { method: 'POST', idempotencyKey: uniqueKey('retry-run-item'), body: { itemIds: retryIds } });
      setSelectedRunItemIds(new Set());
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法重试生成项。'); }
  };
  const retryRunItem = async (itemId) => retryRunItemsByIds([itemId]);
  const controlRun = async (action, runId = activeRun?.id) => {
    const targetRunId = runId || activeRun?.id;
    if (!targetRunId) return;
    if (action === 'resume') {
      setError('恢复运行需要在当前智能体会话中重新确认。');
      return;
    }
    const path = action === 'pause' ? '/pause' : action === 'cancel' ? '/cancel' : '/retry';
    try {
      await api('/api/runs/' + encodeURIComponent(targetRunId) + path, { method: 'POST', idempotencyKey: uniqueKey('run-' + action), body: {} });
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法更新生成运行。'); }
  };
  const copyRunPrompt = async (run) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('当前浏览器未提供剪贴板权限。');
      const textValue = (value) => typeof value === 'string' ? value.trim() : '';
      const itemPromptPrefix = '\n\nSpecific scene direction for this image: ';
      const summaryPrompt = typeof run?.planSnapshot?.prompt === 'string' ? run.planSnapshot.prompt.trim() : typeof run === 'string' ? run.trim() : '';
      let prompt = summaryPrompt;
      let copiedItemCount = 0;
      if (run && typeof run === 'object' && selectedRound?.id && Number.isFinite(Number(run.planVersion))) {
        const data = await api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/plan-versions');
        const version = listItems(data.planVersions).find((item) => Number(item.planVersion) === Number(run.planVersion));
        const fullPrompt = textValue(version?.plan?.prompt);
        const itemPrompts = Array.isArray(version?.plan?.itemPrompts) ? version.plan.itemPrompts.map(textValue).filter(Boolean) : [];
        if (fullPrompt) {
          copiedItemCount = itemPrompts.length;
          prompt = itemPrompts.length ? itemPrompts.map((itemPrompt, index) => '第 ' + (index + 1) + ' 张完整提示词\n' + fullPrompt + itemPromptPrefix + itemPrompt).join('\n\n---\n\n') : fullPrompt;
        }
      }
      if (!prompt) throw new Error('当前运行没有可复制的提示词。');
      await navigator.clipboard.writeText(prompt);
      setNotice(copiedItemCount ? '已复制 ' + copiedItemCount + ' 条逐图完整提示词。' : prompt.length > summaryPrompt.length ? '已复制本次运行的完整提示词。' : '已复制本次运行的提示词。');
    } catch (nextError) { setError(nextError.message || '无法复制本次提示词。'); }
  };
  const openGenerationConfirmation = async (targetRound = selectedRound) => {
    if (!targetRound || targetRound.status !== 'awaiting_confirmation') return;
    setGenerationConfirmationBusy(true);
    setGenerationConfirmationError('');
    try {
      let status = sessionPlanStatus;
      if (!status?.pendingConfirmation || status.context?.round?.id !== targetRound.id) {
        if (!session) throw new Error('当前 Workbench 尚未建立只读会话状态。');
        status = await api('/api/sessions/' + encodeURIComponent(session.id) + '/plan-status');
        setSessionPlanStatus(status);
      }
      if (!status.pendingConfirmation || status.context?.round?.id !== targetRound.id) throw new Error('请先由当前智能体会话发起这个计划的确认挑战。');
      setGenerationConfirmation({ challenge: status.pendingConfirmation, round: targetRound });
    } catch (nextError) {
      setError(nextError.message || '无法读取本次生成确认挑战。');
    } finally {
      setGenerationConfirmationBusy(false);
    }
  };
  const dismissGenerationConfirmation = () => {
    if (generationConfirmationBusy) return;
    setGenerationConfirmation(null);
    setGenerationConfirmationError('');
  };
  const confirmGenerationPlan = async () => {
    if (!generationConfirmation) return;
    setGenerationConfirmationBusy(true);
    setGenerationConfirmationError('');
    try {
      const confirmationSessionId = generationConfirmation.challenge.sessionId;
      await api('/api/rounds/' + encodeURIComponent(generationConfirmation.round.id) + '/confirm', { method: 'POST', idempotencyKey: uniqueKey('user-confirm'), body: { expectedVersion: generationConfirmation.challenge.expectedVersion, sessionId: confirmationSessionId, challenge: generationConfirmation.challenge.challenge } });
      setGenerationConfirmation(null);
      setNotice('计划已由当前用户确认。请返回当前智能体会话，由会话执行预检并创建运行。');
      await refresh();
      return true;
    } catch (nextError) {
      setGenerationConfirmationError(nextError.message || '确认计划失败。');
      return false;
    } finally {
      setGenerationConfirmationBusy(false);
    }
  };
  const openArchiveConfirmation = () => {
    if (!selectedProject || selectedProject.status === 'archived') return;
    setConfirmationError('');
    setConfirmation({ kind: 'archive', projectId: selectedProject.id, projectName: selectedProject.name });
  };
  const dismissConfirmation = () => {
    if (confirmationBusy) return;
    setConfirmation(null);
    setConfirmationError('');
  };
  const confirmPendingAction = async () => {
    if (!confirmation) return;
    setConfirmationBusy(true);
    setConfirmationError('');
    try {
      if (confirmation.kind === 'trash') await moveAssetToTrash(confirmation.assetId);
      else {
        await api('/api/projects/' + encodeURIComponent(confirmation.projectId) + '/archive', { method: 'POST', idempotencyKey: uniqueKey('archive-project'), body: {} });
        await refresh();
      }
      setConfirmation(null);
    } catch (nextError) {
      setConfirmationError(nextError.message || (confirmation.kind === 'trash' ? '无法移入回收站。' : '无法归档项目。'));
    } finally { setConfirmationBusy(false); }
  };
  const openProviderDetails = () => { setProviderDetails({ open: true }); };
  const openAdvancedDetails = async () => {
    if (!selectedRound) return;
    const request = advancedDetailRequests.current.begin([selectedRound.id, activeRunId || ''].join(':'));
    try {
      const [plans, dryRuns] = await Promise.all([api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/plan-versions', { signal: request.signal }), api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/dry-runs', { signal: request.signal })]);
      if (request.isCurrent()) setAdvancedDetails(normalizeAdvancedDetails({ plans: plans.planVersions, dryRuns: dryRuns.dryRuns }));
    } catch (nextError) { if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取高级详情。'); }
  };
  useEffect(() => {
    advancedDetailRequests.current.cancel();
    setAdvancedDetails(null);
  }, [view, selectedRound?.id, activeRunId]);
  const refreshPlanVersions = async () => {
    if (!selectedRound) { planVersionRequests.current.cancel(); setPlanVersions(EMPTY); return; }
    const request = planVersionRequests.current.begin([view, selectedRound.id, eventRevision.planVersions].join(':'));
    try {
      setPlanVersionsLoading(true);
      const plans = await api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/plan-versions', { signal: request.signal });
      if (request.isCurrent()) setPlanVersions(plans.planVersions || EMPTY);
    } catch (nextError) { if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取计划版本。'); } finally { if (request.isCurrent()) setPlanVersionsLoading(false); }
  };
  useEffect(() => {
    if (view !== 'prompts' || !selectedRound) {
      planVersionRequests.current.cancel();
      setPlanVersions(EMPTY);
      setPlanVersionsLoading(false);
      return undefined;
    }
    void refreshPlanVersions();
    return () => planVersionRequests.current.cancel();
  }, [view, selectedRound?.id, eventRevision.planVersions]);
  const dismissGuide = () => { window.localStorage.setItem('daoge-pic:guide-dismissed', '1'); };
  const openImportEntry = () => {
    if (!selectedProject) { openCreationDialog('project'); return; }
    if (canImport && view !== 'library') { inputRef.current?.click(); return; }
    navigateRoute({ view: 'assets', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  };


  const renderAssetsView = () => <section className={'asset-stage ' + (selectedAssets.length && routeView === 'assets' ? 'has-selection' : '')}>
    <div className="asset-stage-head">
      <div><span className="asset-count">{assetTotal.toString().padStart(2, '0')}</span><span className="asset-count-label">{routeView === 'trash' ? '回收站图片' : '张图片'}</span></div>
      <div className="asset-stage-tools">
        {routeView === 'assets' && <div className="asset-scope-control" aria-label="资产范围">{ASSET_SCOPES.filter((scope) => scope !== 'studio').map((scope) => <button type="button" key={scope} className={assetScope === scope ? 'is-active' : ''} disabled={(scope === 'round' && !selectedRound) || (scope === 'task' && !selectedTask) || (scope === 'project' && !selectedProject)} onClick={() => navigateRoute({ assetScope: scope })}>{ASSET_SCOPE_LABELS[scope]}</button>)}</div>}
        {routeView === 'assets' && selectedProject && <button type="button" className="command-button asset-import-button" disabled={uploading} onClick={() => inputRef.current?.click()}><Upload size={16} />{uploading && uploadProgress ? '正在导入 ' + uploadProgress.completed + '/' + uploadProgress.total : importLabel}</button>}
        <div className="asset-filter" aria-label="素材筛选"><SlidersHorizontal size={14} />{[['all', '全部'], ['generated', '生成'], ['import', '导入']].map(([value, label]) => <button type="button" key={value} className={assetFilter === value ? 'is-active' : ''} onClick={() => { setAssetFilter(value); setAssetPage(1); }}>{label}</button>)}</div>
        {routeView === 'assets' && visibleAssets.length > 0 && <button type="button" className="outline-button asset-select-page" disabled={pageSelectionBusy} onClick={() => void setPageSelection(!allPageAssetsSelected)}><Check size={15} />{allPageAssetsSelected ? '取消全选本页' : '全选本页'}</button>}
        <details className="asset-view-options"><summary><SlidersHorizontal size={14} />显示</summary><label className="asset-page-size"><span>每页</span><select aria-label="每页资产数量" value={assetPageSize} onChange={(event) => { setAssetPageSize(normalizeAssetPageSize(event.target.value)); setAssetPage(1); }}>{ASSET_PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select><span>张</span></label></details>
        {routeView === 'assets' && selectedProject && <button type="button" className="outline-button asset-trash-link" onClick={() => navigateRoute({ view: 'trash', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' })}><Trash2 size={15} />回收站</button>}
        {routeView === 'trash' && selectedProject && <button type="button" className="outline-button" onClick={() => navigateRoute({ view: 'assets', assetScope: 'project' })}><ImagePlus size={15} />返回素材</button>}
        {selectedAssets.length === 2 && <IconButton label="对比两张已选素材" onClick={() => { setPreviewZoom(1); setPreviewAssets(selectedAssets); }}><Eye size={16} /></IconButton>}
        <div className="asset-hint">{routeView === 'trash' ? '当前项目回收站' : selectedAssetIds.size ? selectedAssetIds.size + ' 张已选择' : ASSET_SCOPE_LABELS[assetScope] + '资产'}</div>
      </div>
    </div>
    {routeView === 'assets' && selectedProject && <MaterialImportGuide materialNeeds={contextMaterialNeeds} selectedNeed={selectedImportNeed} completedCounts={materialNeedCounts} assetScope={assetScope} selectedRound={selectedRound} onSelectNeed={setSelectedImportNeed} />}
    {routeView === 'assets' && selectedProject && selectedAssets.length > 0 && <AssetSelectionStrip assets={selectedAssets} selectedTask={selectedTask} selectedRound={selectedRound} onRemove={toggleSelection} onClear={() => void clearSelection()} onDownloadArchive={() => downloadProjectArchive(selectedAssets.map((asset) => asset.id))} onDeliver={() => navigateRoute({ view: 'deliveries', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} onOpenDerive={openDerivedRoundDialog} onAddReference={(nextAssets, usage) => void addAssetsToCurrentRoundReferences(nextAssets, usage)} onReject={openRejectReviewDialog} onOpenReference={openReferenceDialog} />}
    {visibleAssets.length ? <><div className="asset-grid">{visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selectedAssetIds.has(asset.id)} selectionBusy={selectionBusyIds.has(asset.id)} shared={sharedAssetIds.has(asset.id)} selectedTask={selectedTask} fallbackTask={taskForId(asset?.display?.taskId || asset?.source?.taskId || asset?.source?.creativeTaskId)} selectedRound={selectedRound} onToggleSelect={markAsDeliverable} onReview={review} onTrash={trash} onRestore={restore} onInspect={inspectAsset} onDownload={downloadAsset} onCopy={copyAsset} onSetShared={setAssetShared} onOpenDerive={openDerivedRoundDialog} onAddReference={(nextAssets, usage) => void addAssetsToCurrentRoundReferences(nextAssets, usage)} onReject={openRejectReviewDialog} onOpenReference={openReferenceDialog} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />)}</div><nav className="asset-pagination" aria-label="资产分页"><button type="button" className="outline-button" disabled={assetPage <= 1} onClick={() => setAssetPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} />上一页</button><span>第 <b>{assetPage}</b> / {totalAssetPages} 页 · 共 {assetTotal} 张</span><button type="button" className="outline-button" disabled={assetPage >= totalAssetPages} onClick={() => setAssetPage((current) => Math.min(totalAssetPages, current + 1))}>下一页<ChevronRight size={15} /></button></nav></> : <div className="empty-stage asset-empty">{routeView === 'trash' ? <Archive size={30} strokeWidth={1.15} /> : <Inbox size={30} strokeWidth={1.15} />}<p>{routeView === 'trash' ? '当前项目回收站为空' : (assetScope === 'round' && !selectedRound ? '请先从任务上下文选择轮次，再查看本轮结果。' : '当前范围内暂未找到资产。')}</p>{routeView === 'assets' && <button type="button" className="outline-button" onClick={() => inputRef.current?.click()}><Upload size={16} />导入图片</button>}</div>}
  </section>;
  const viewRenderers = {
    projects: () => <ProjectIndex projects={projects} projectTemplates={projectTemplates} onCreateProject={() => openCreationDialog('project')} onOpenProject={(projectId) => navigateRoute(selectProject(route, projectId))} />,
    'project-overview': () => selectedProject ? <ProjectOverview project={selectedProject} projectTemplates={projectTemplates} tasks={tasks} selectedCount={selectedAssets.length} onCreateTask={() => openCreationDialog('task')} onArchive={openArchiveConfirmation} onOpenTasks={() => navigateRoute({ view: 'tasks', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenAssets={() => navigateRoute({ view: 'assets', assetScope: 'project', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenDeliveries={() => navigateRoute({ view: 'deliveries', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenTask={(taskId) => navigateRoute(selectTask(route, taskId))} /> : null,
    lineage: () => selectedProject ? <CreativeLineageCanvas
      request={api}
      project={selectedProject}
      tasks={tasks}
      selectedTask={selectedTask}
      rounds={rounds}
      selectedRound={selectedRound}
      runs={runs}
      activeRun={activeRun}
      runItems={lineageVisibleRunItems}
      runItemCoverage={lineageRunItemCoverage}
      assets={visibleAssets}
      assetTotal={assetTotal}
      sharedAssets={sharedAssets}
      selectedAssetIds={selectedAssetIds}
      selectionBusyIds={selectionBusyIds}
      deliveries={deliveries}
      taskTypes={taskTypes}
      styleKits={styleKits}
      brandKits={brandKits}
      sessionPlanStatus={sessionPlanStatus}
      layoutRevision={eventRevision.canvasLayout}
      onNavigate={navigateRoute}
      onPreviewAsset={(asset) => { setPreviewZoom(1); setPreviewAssets([asset]); }}
      onInspectAsset={inspectAsset}
      onToggleAsset={markAsDeliverable}
      onBatchSelectAssets={setAssetsSelection}
      onReviewAsset={review}
      onBatchReviewAssets={batchReview}
      onSetAssetShared={setAssetShared}
      onDownloadAsset={downloadAsset}
      onCopyAsset={copyAsset}
      onRetryRunItem={retryRunItem}
      onControlRun={controlRun}
      onOpenProvider={openProviderDetails}
      onCreateTask={() => openCreationDialog('task')}
      onCreateRound={() => openCreationDialog('round')}
      onOpenReference={openReferenceDialog}
      onOpenDerive={openDerivedRoundDialog}
      onAddReference={(nextAssets, usage) => void addAssetsToCurrentRoundReferences(nextAssets, usage)}
      onReject={openRejectReviewDialog}
      onCreateDelivery={() => navigateRoute({ view: 'deliveries', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' })}
      onOpenConfirmation={(round) => void openGenerationConfirmation(round)}
    /> : null,
    assets: () => renderAssetsView(),
    tasks: () => selectedProject ? <ProjectTaskList project={selectedProject} tasks={tasks} onCreateTask={() => openCreationDialog('task')} onOpenTask={(taskId) => navigateRoute(selectTask(route, taskId))} /> : null,
    'studio-overview': () => <section className="overview-stage">
      <div className="overview-head"><div><p className="eyebrow">同一任务内的显式对比</p><h2>{selectedTask ? selectedTask.name : '请选择任务'}</h2><span>{studioOverview?.availableRounds?.length || 0} 个可比较轮次。比较不会推断或启动运行。</span></div>{taskOverview && <div className="overview-metrics"><span>轮次 {taskOverview.summary?.roundCount || 0}</span><span>运行 {taskOverview.summary?.runCount || 0}</span><span>结果 {taskOverview.summary?.resultCount || 0}</span></div>}</div>
      {selectedTask ? <><div className="compare-selector">{(studioOverview?.availableRounds || rounds).map((round) => <label key={round.id}><input type="checkbox" checked={compareRoundIds.includes(round.id)} onChange={() => toggleComparedRound(round.id)} /><span>{({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[round.purpose] || round.purpose} · 计划 v{round.planVersion}</span></label>)}</div>{studioOverview?.comparisons?.length ? <div className="comparison-grid">{studioOverview.comparisons.map((comparison) => <article key={comparison.round.id} className="comparison-column"><header><div><p>轮次 {comparison.round.planVersion}</p><h3>{({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[comparison.round.purpose] || comparison.round.purpose}</h3></div><StatusPill value={comparison.round.status} scope="round" /></header><dl><div><dt>上游</dt><dd>{comparison.lineage?.rounds?.length ? '承接 ' + comparison.lineage.rounds.length + ' 个轮次' : '首个方向'}</dd></div><div><dt>计划</dt><dd>{comparison.round.plan?.operation === 'edit' ? '编辑' : '生成'} · {comparison.round.plan?.itemCount || 0} 项</dd></div><div><dt>产出</dt><dd>{comparison.summary?.resultCount || 0} 个结果</dd></div></dl>{comparison.runsTruncated && <p className="comparison-truncated">仅显示最近 24 次运行</p>}<div className="comparison-runs">{comparison.runs?.map((run) => <section key={run.id}><button type="button" className="trace-link" onClick={() => navigateRoute({ view: 'runs', projectId: selectedProject?.id, taskId: selectedTask.id, roundId: comparison.round.id, compareRoundIds: [comparison.round.id], runId: run.id })}><b>运行项 {run.items?.length || 0}</b><StatusPill value={run.status} scope="run" /></button><div className="comparison-assets">{run.items?.flatMap((item) => item.outputAssets || []).map((asset) => <button type="button" key={asset.id} title="查看资产来源与评审" onClick={() => void inspectAsset(asset.id)}><img src={assetThumbnailUrl(asset)} alt="轮次结果" loading="lazy" decoding="async" /><span>{asset.review?.decision === 'keep' ? '保留' : asset.review?.decision === 'review' ? '待复核' : '未评审'}</span></button>)}</div></section>)}</div></article>)}</div> : <div className="empty-stage"><Columns3 size={30} strokeWidth={1.15} /><p>勾选一个或多个轮次后，比较计划、运行、结果和当前评审。</p></div>}</> : <div className="empty-stage"><Columns3 size={30} strokeWidth={1.15} /><p>请先选择项目和任务，再打开创作总览。</p></div>}
    </section>,
    prompts: () => <><PromptWorkspace round={selectedRound} planVersions={planVersions} loading={planVersionsLoading} onRefresh={() => void refreshPlanVersions()} />{selectedRound?.status === 'awaiting_confirmation' && <section className="human-confirmation-gate"><div><p className="eyebrow">人工确认闸门 · 可写操作</p><h3>等待当前用户确认计划</h3><span>这是独立于只读摘要的写入闸门。Skill 只能创建挑战；此 Workbench 标签只负责激活计划，确认后由当前智能体会话执行预检并创建唯一运行。</span></div><button type="button" className="command-button" onClick={() => void openGenerationConfirmation()} disabled={!session || generationConfirmationBusy}><LockKeyhole size={16} />{generationConfirmationBusy ? '正在准备确认' : '审阅并确认计划'}</button></section>}</>,
    runs: () => <GenerationHistory selectedRound={selectedRound} runs={runs} activeRunId={activeRunId} activeRun={activeRun} runExecutionStatus={runExecutionStatus} runLifecycleStatus={runLifecycleStatus} taskOverview={taskOverview} creativeRecord={creativeRecord} visibleRunItems={visibleRunItems} runItemPage={runItemPage} runItemFilter={activeRunItemFilter} runItemPageSize={activeRunItemPageSize} runItemSequence={activeRunItemSequence} selectedRunItemIds={selectedRunItemIds} runItemDetail={runItemDetail} canCancelActiveRun={canCancelActiveRun} advancedDetails={advancedDetails} onSelectRun={(runId) => navigateRoute({ runId, runItemFilter: DEFAULT_RUN_ITEM_FILTER, runItemPage: 1, runItemPageSize: DEFAULT_RUN_ITEM_PAGE_SIZE, runItemSequence: null })} onControlRun={controlRun} onRetryItem={retryRunItem} onInspectAsset={inspectAsset} onSetRunItemFilter={setRunItemFilter} onSetRunItemPage={setRunItemPageNumber} onSetRunItemPageSize={setRunItemPageSizeValue} onSetRunItemSequence={setRunItemSequenceValue} onToggleRunItemSelection={toggleRunItemSelection} onSelectRetryablePageItems={selectRetryablePageItems} onRetrySelectedItems={retryRunItemsByIds} onOpenRunItemDetail={(item) => setRunItemDetailId(item.id)} onCloseRunItemDetail={() => setRunItemDetailId(null)} onToggleAdvanced={() => advancedDetails ? setAdvancedDetails(null) : void openAdvancedDetails()} onCloseAdvanced={() => setAdvancedDetails(null)} onCopyPrompt={copyRunPrompt} />,
    guide: () => <LearningCenter onDismiss={dismissGuide} onNavigate={(nextView) => navigateRoute({ view: nextView })} />,
    library: () => <CreativeLibrary taskTypes={taskTypes} styleKits={styleKits} brandKits={brandKits} sharedAssets={sharedAssets} onOpenProjects={() => navigateRoute({ view: 'projects' })} onOpenSharedAssets={() => navigateRoute({ view: 'shared-assets' })} />,
    'shared-assets': () => <SharedAssets assets={sharedAssets} onDownload={downloadAsset} onCopy={copyAsset} onSetShared={setAssetShared} onOpenProjects={() => navigateRoute({ view: 'projects' })} />,
    deliveries: () => <CreatorDelivery project={selectedProject} selection={deliverySelection} deliveryName={deliveryName} deliveryCreating={deliveryCreating} completion={deliveryCompletion} frozen={Boolean(deliveryCompletion || deliveryCreating)} onDeliveryNameChange={setDeliveryName} onCreate={() => void completeDelivery()} onOpenAssets={() => navigateRoute({ view: 'assets', assetScope: 'project', taskId: null, roundId: null, compareRoundIds: [], runId: null })} selectedAssets={deliveryFlowAssets} deliveries={deliveries} assets={assets} deliveryBusyId={deliveryBusyId} onDeliveryAction={deliveryAction} onRemoveSelection={(asset) => toggleSelection(asset.id)} onDownload={downloadAsset} onCopy={copyAsset} onArchiveProject={downloadProjectArchive} onArchiveDelivery={downloadDeliveryArchive} batches={deliveryBatches} batchName={batchName} selectedDeliveryIds={selectedDeliveryIds} batchBusy={batchBusy} onBatchNameChange={setBatchName} onToggleDelivery={toggleBatchDelivery} onBatchAction={batchAction} />,
    trash: () => renderAssetsView()
  };
  const renderActiveView = viewRenderers[routeView];

  if (loading) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在连接 Studio</span></div>;
  return <main className={'studio-shell' + (railCollapsed ? ' is-rail-collapsed' : '')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files).filter((item) => item.type.startsWith('image/')); if (files.length && canImport) void upload(files); }} onPaste={(event) => { const files = [...event.clipboardData.files].filter((item) => item.type.startsWith('image/')); if (files.length && canImport) { event.preventDefault(); void upload(files); } }}>
    <aside className="studio-rail" aria-label="Studio 左侧控制栏">
      <div className="rail-brand-row"><div className="brand-mark" aria-label="DAOGE Pic"><span>DAOGE</span><b>Pic</b></div><button type="button" className="rail-collapse-toggle" onClick={() => setRailCollapsed((current) => !current)} title={railCollapsed ? '展开左侧栏' : '折叠左侧栏'} aria-label={railCollapsed ? '展开左侧栏' : '折叠左侧栏'} aria-pressed={railCollapsed}>{railCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button></div>
      <WorkbenchNavigation view={view} project={selectedProject} task={selectedTask} round={selectedRound} provider={provider} studio={studio} recoveryPhase={recoveryPhase} repairing={runtimeRepairing} onNavigate={(nextView, changes = {}) => navigateRoute({ view: nextView, ...changes })} onOpenProvider={openProviderDetails} onOpenGuide={() => navigateRoute({ view: 'guide' })} onCopyRuntimeDiagnostic={() => void copyRuntimeDiagnostic()} onRefresh={() => void refresh()} onRepair={() => void repairRuntime()} />
    </aside>

    <section className="work-surface">
      <div className="workspace-chrome">
        <header className="surface-header">
          <div className="heading-group"><p className="eyebrow">{surfaceEyebrow(view, Boolean(selectedProject))}</p><h1>{surfaceTitle(view, selectedProject)}</h1><span>{surfaceSubtitle(view, selectedProject)}</span></div>
          <div className="header-actions">
            <StudioSearch query={searchQuery} results={searchResults} loading={searchLoading} error={searchError} onQueryChange={setSearchQuery} onOpenResult={openSearchResult} />
            <IconButton label="刷新工作台" onClick={() => void refresh()}><RefreshCw size={17} /></IconButton>
            <input ref={inputRef} className="file-input" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void upload(event.target.files)} />
          </div>
        </header>
        {!studioView ? <>
          <WorkspaceContextBar project={selectedProject} tasks={tasks} task={selectedTask} rounds={rounds} selectedRound={selectedRound} view={view} assetScope={assetScope} sessionPlanStatus={sessionPlanStatus} onProject={() => navigateRoute({ view: 'project-overview', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onTasks={() => navigateRoute({ view: 'tasks', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onSelectTask={(taskId) => taskId ? navigateRoute(selectTask(route, taskId)) : navigateRoute({ view: 'lineage', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' })} onSelectRound={(roundId) => { const nextRound = rounds.find((round) => round.id === roundId); roundId ? navigateRoute({ view: 'lineage', taskId: nextRound?.taskId || selectedTask?.id || null, roundId, compareRoundIds: [roundId], runId: null, assetScope: 'round' }) : navigateRoute({ view: 'lineage', taskId: selectedTask?.id || null, roundId: null, compareRoundIds: [], runId: null, assetScope: selectedTask ? 'task' : 'project' }); }} onCreateRound={() => openCreationDialog('round')} onNavigate={(nextView, changes = {}) => navigateRoute({ view: nextView, ...changes })} onRestoreContext={restoreSessionContext} />
        </> : <SessionPlanSummary sessionPlanStatus={sessionPlanStatus} onRestoreContext={restoreSessionContext} />}
      </div>
      <RuntimeHealthAlertStrip studio={studio} recoveryPhase={recoveryPhase} repairing={runtimeRepairing} onCopy={() => void copyRuntimeDiagnostic()} onRefresh={() => void refresh()} onRepair={() => void repairRuntime()} />
      {connectionError && <div className="connection-error-strip" role="alert" aria-live="assertive"><CloudOff size={16} /><span>{connectionError}</span></div>}
      {error && <div className="error-strip" role="alert" aria-live="assertive"><CircleAlert size={16} /><span>{error}</span><IconButton label="关闭请求错误" onClick={() => setError('')}><X size={15} /></IconButton></div>}
      {contextError && <div className="error-strip" role="alert" aria-live="assertive"><CircleAlert size={16} /><span>{contextError}</span><IconButton label="关闭上下文错误" onClick={() => setContextError('')}><X size={15} /></IconButton></div>}
      {notice && <div className="notice-strip" role="status" aria-live="polite"><Check size={16} /><span>{notice}</span><IconButton label="关闭通知" onClick={() => setNotice('')}><X size={15} /></IconButton></div>}
      {renderActiveView()}
    </section>

    {assetProvenance && <aside className="asset-inspector" aria-label="资产来源与评审记录"><div className="asset-inspector-head"><div><p className="eyebrow">资产检查器</p><h2>{assetProvenance.asset?.kind === 'generated' ? '生成结果来源链' : '导入素材来源链'}</h2></div><IconButton label="关闭资产检查器" onClick={() => setAssetProvenance(null)}><X size={16} /></IconButton></div><div className="asset-inspector-section"><span>来源</span><p>{assetProvenance.asset?.kind === 'generated' ? '由已确认轮次中的运行项保存' : '导入到当前 Studio 的素材'}</p>{assetProvenance.outputs?.map((output) => <button type="button" key={output.runItem.id} className="trace-link" onClick={() => { navigateRoute({ view: 'runs', projectId: output.project.id, taskId: output.task.id, roundId: output.round.id, runId: output.run.id }); setAssetProvenance(null); }}><span>{output.project.name} / {output.task.name}</span><b>{output.round.purpose} · 运行项 {output.runItem.sequence}</b></button>)}</div><div className="asset-inspector-section"><span>评审历史</span>{assetProvenance.reviews?.length ? assetProvenance.reviews.map((review) => <p key={review.id}><b>{review.decision === 'keep' ? '保留' : review.decision === 'review' ? '待复核' : review.decision === 'reject' ? '不采用' : '衍生方向'}</b> · {review.createdAt}</p>) : <p>尚未记录评审。</p>}</div><div className="asset-inspector-section"><span>交付引用</span>{assetProvenance.deliveries?.length ? assetProvenance.deliveries.map((delivery) => <p key={delivery.id}>{delivery.name} · {delivery.status}</p>) : <p>尚未加入交付草稿。</p>}</div><div className="asset-inspector-section"><span>批次版本</span>{assetProvenance.deliveryBatches?.length ? assetProvenance.deliveryBatches.map((batch) => <p key={batch.versionId}>{batch.name} · v{batch.versionNo} · {batch.status === 'ready' ? '已准备' : batch.status === 'draft' ? '草稿' : '已被新修订版本替代'}</p>) : <p>尚未加入版本化交付批次。</p>}</div></aside>}
    {generationConfirmation && <ConfirmationDialog label="确认创作计划" title={'确认计划 v' + generationConfirmation.round.planVersion + '？'} message="此操作代表当前用户已审阅计划，并把确认绑定到当前 conversation 与计划哈希。确认不会调用 Provider；请返回当前智能体会话继续预检和生成。" confirmLabel="确认计划" busy={generationConfirmationBusy} error={generationConfirmationError} tone="warning" onCancel={dismissGenerationConfirmation} onConfirm={confirmGenerationPlan} />}
    {previewAssets.length > 0 && <ImageInspectorDialog assets={previewAssets} zoom={previewZoom} selectedAssetIds={selectedAssetIds} selectionBusyIds={selectionBusyIds} selectedProject={selectedProject} selectedTask={selectedTask} fallbackTask={previewAssets.length === 1 ? taskForId(previewAssets[0]?.display?.taskId || previewAssets[0]?.source?.taskId || previewAssets[0]?.source?.creativeTaskId) : null} selectedRound={selectedRound} onClose={() => setPreviewAssets([])} onZoom={setPreviewZoom} onToggleDeliverable={markAsDeliverable} onReview={review} onOpenDerive={openDerivedRoundDialog} onAddReference={(nextAssets, usage) => void addAssetsToCurrentRoundReferences(nextAssets, usage)} onReject={openRejectReviewDialog} onOpenReference={openReferenceDialog} />}
    {rejectDialog && <RejectReviewDialog assets={rejectDialog.assets} canAddNegative={Boolean(selectedRound && selectedRound.status === 'draft')} canCreateNextRound={Boolean(selectedProject && selectedTask)} initialCreateNextRound={rejectDialog.createNextRound} busy={rejectBusy} error={rejectError} onDismiss={dismissRejectDialog} onSave={saveRejectReview} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {providerDetails && <ProviderSettings request={api} onDismiss={() => setProviderDetails(null)} onChanged={refresh} />}
    {creationDialog === 'project' && <ProjectCreationDialog projectTemplates={projectTemplates} busy={creationBusy} error={creationError} onDismiss={dismissCreationDialog} onCreate={createProjectFromStudio} />}
    {creationDialog === 'task' && selectedProject && <TaskCreationDialog project={selectedProject} projectTemplates={projectTemplates} taskTypes={taskTypes} styleKits={styleKits} brandKits={brandKits} busy={creationBusy} error={creationError} onDismiss={dismissCreationDialog} onCreate={createTaskFromStudio} />}
    {referenceResolver && selectedProject && <ReferenceRoundResolverDialog project={selectedProject} task={referenceResolver.task || selectedTask} tasks={referenceResolver.tasks || tasks} draftRounds={referenceResolver.draftRounds || EMPTY} assets={referenceResolver.assets || EMPTY} usage={referenceResolver.usage || 'subject'} busy={referenceBusy} error={referenceError} onDismiss={dismissReferenceResolver} onUseRound={(roundId) => void chooseReferenceRound(roundId)} onSelectTask={chooseReferenceTask} onCreateRound={createRoundForPendingReference} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {referenceDialog === 'round' && selectedProject && selectedTask && selectedRound && <ReferenceAssetDialog project={selectedProject} task={selectedTask} round={selectedRound} sharedAssets={sharedAssets} selectedMaterials={referenceMaterials} busy={referenceBusy} error={referenceError} onDismiss={dismissReferenceDialog} onSave={(materials) => void saveRoundReferenceMaterials(materials)} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {creationDialog === 'round' && selectedTask && <RoundCreationDialog task={selectedTask} rounds={rounds} currentRound={selectedRound} busy={creationBusy} error={creationError} onDismiss={dismissCreationDialog} onCreate={createRoundFromStudio} />}
    {derivedDialog && selectedProject && selectedTask && <DerivedRoundDialog project={selectedProject} task={selectedTask} rounds={rounds} currentRound={selectedRound} assets={derivedDialog.assets} initialPurpose={derivedDialog.purpose} initialActionId={derivedDialog.actionId} busy={derivedBusy} error={derivedError} onDismiss={dismissDerivedDialog} onCreate={createDerivedRoundFromAssets} onImportMask={importDerivedMaskAsset} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {confirmation && <ConfirmationDialog label={confirmation.kind === 'archive' ? '确认归档项目' : '确认移入回收站'} title={confirmation.kind === 'archive' ? '归档“' + confirmation.projectName + '”？' : '将图片移入回收站？'} message={confirmation.kind === 'archive' ? '归档后将关闭该项目下的任务与轮次。未完成生成必须先暂停或取消。是否继续？' : '这张图片仍被选择、资料库或交付引用。移入回收站不会删除已冻结交付，是否继续？'} confirmLabel={confirmation.kind === 'archive' ? '确认归档' : '继续移入'} busy={confirmationBusy} error={confirmationError} onCancel={dismissConfirmation} onConfirm={confirmPendingAction} />}
  </main>;
}

function renderWorkbench() {
  createRoot(document.getElementById('root')).render(<WorkbenchErrorBoundary><LocalStudioAuthorizationGate /></WorkbenchErrorBoundary>);
}

renderWorkbench();
