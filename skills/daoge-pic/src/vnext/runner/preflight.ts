import { ImageOperation, ImageProviderCapabilities, MAX_IMAGE_REQUEST_REFERENCE_ASSETS } from '../providers/contracts';
import { SafeProviderStatus } from '../studio/provider-config';
import { resolveOutputSpec } from '../providers/output-spec';

export interface PreflightPlan {
  operation: ImageOperation;
  itemCount: number;
  prompt: string;
  referenceAssetIds?: string[];
  maskAssetId?: string;
  output?: Record<string, unknown>;
}

export interface PreflightIssue {
  code: string;
  message: string;
  field?: string;
}

export interface PreflightResult {
  valid: boolean;
  issues: PreflightIssue[];
  normalizedPlan: PreflightPlan;
}

function capabilitiesFromStatus(status: SafeProviderStatus): ImageProviderCapabilities | null {
  if (!status.capabilities) return null;
  return {
    textToImage: status.capabilities.generate,
    referenceEdit: status.capabilities.referenceImage,
    maskEdit: status.capabilities.mask,
    cancellation: false,
    reconciliation: false,
    idempotency: false,
    acceptedReferenceMediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  };
}

const MAX_PLAN_PROMPT_CHARS = 64 * 1024;
const MAX_PLAN_JSON_BYTES = 256 * 1024;
const MAX_ASSET_ID_CHARS = 256;

export function preflightGenerationPlan(plan: PreflightPlan | unknown, providerStatus: SafeProviderStatus): PreflightResult {
  const issues: PreflightIssue[] = [];
  const input = plan && typeof plan === 'object' && !Array.isArray(plan) ? plan as Record<string, unknown> : {};
  const operation = input.operation === 'generate' || input.operation === 'edit' ? input.operation : 'generate';
  if (input.operation !== 'generate' && input.operation !== 'edit') issues.push({ code: 'invalid_operation', message: '图像操作只能是 generate 或 edit。', field: 'operation' });
  const itemCount = typeof input.itemCount === 'number' ? input.itemCount : Number.NaN;
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (input.prompt !== undefined && typeof input.prompt !== 'string') issues.push({ code: 'invalid_prompt', message: '提示词必须是字符串。', field: 'prompt' });
  if (prompt.length > MAX_PLAN_PROMPT_CHARS) issues.push({ code: 'prompt_too_large', message: '提示词不能超过 64 KiB。', field: 'prompt' });
  const rawReferences = input.referenceAssetIds;
  const referencesValid = rawReferences === undefined || Array.isArray(rawReferences);
  if (!referencesValid) issues.push({ code: 'invalid_reference_assets', message: '参考素材必须是字符串数组。', field: 'referenceAssetIds' });
  const referenceAssetIds = referencesValid && Array.isArray(rawReferences) ? [...new Set(rawReferences.filter((value): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ASSET_ID_CHARS))] : [];
  if (Array.isArray(rawReferences) && rawReferences.some((value) => typeof value !== 'string' || !value.trim() || value.length > MAX_ASSET_ID_CHARS)) issues.push({ code: 'invalid_reference_asset_id', message: '参考素材 ID 必须是非空短字符串。', field: 'referenceAssetIds' });
  const maskAssetId = input.maskAssetId === undefined || input.maskAssetId === null ? undefined : typeof input.maskAssetId === 'string' && input.maskAssetId.trim() && input.maskAssetId.length <= MAX_ASSET_ID_CHARS ? input.maskAssetId : undefined;
  if (input.maskAssetId !== undefined && input.maskAssetId !== null && !maskAssetId) issues.push({ code: 'invalid_mask_asset_id', message: '遮罩素材 ID 必须是非空短字符串。', field: 'maskAssetId' });
  const output = input.output === undefined ? {} : input.output && typeof input.output === 'object' && !Array.isArray(input.output) ? input.output as Record<string, unknown> : null;
  if (output === null) issues.push({ code: 'invalid_output', message: '输出规格必须是 JSON 对象。', field: 'output' });
  const normalizedPlan: PreflightPlan = { operation, itemCount, prompt, referenceAssetIds, ...(maskAssetId ? { maskAssetId } : {}), output: output || {} };
  try {
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_PLAN_JSON_BYTES) issues.push({ code: 'plan_too_large', message: '创作计划不能超过 256 KiB。', field: 'plan' });
  } catch { issues.push({ code: 'invalid_plan', message: '创作计划不是可序列化的 JSON 对象。', field: 'plan' }); }
  const capabilities = capabilitiesFromStatus(providerStatus);
  if (!providerStatus.configured || !providerStatus.providerId || !capabilities) issues.push({ code: 'provider_not_ready', message: '当前生成配置未完成，无法开始生图。', field: 'provider' });
  if (!Number.isInteger(normalizedPlan.itemCount) || normalizedPlan.itemCount < 1 || normalizedPlan.itemCount > 1000) issues.push({ code: 'invalid_item_count', message: '生成数量必须是 1 到 1000 之间的整数。', field: 'itemCount' });
  if (!normalizedPlan.prompt) issues.push({ code: 'missing_prompt', message: '创作计划缺少可执行的图像描述。', field: 'prompt' });
  if ((normalizedPlan.referenceAssetIds || []).length > MAX_IMAGE_REQUEST_REFERENCE_ASSETS) issues.push({ code: 'reference_asset_limit_exceeded', message: '参考素材最多支持 ' + MAX_IMAGE_REQUEST_REFERENCE_ASSETS + ' 张。', field: 'referenceAssetIds' });
  if (providerStatus.providerId && providerStatus.model) {
    const outputSpec = resolveOutputSpec({ providerId: providerStatus.providerId, model: providerStatus.model, output: normalizedPlan.output });
    if (!outputSpec.ok) issues.push({ code: outputSpec.code, message: outputSpec.message, field: outputSpec.field });
    else normalizedPlan.output = outputSpec.output;
  }
  if (capabilities && !capabilities.textToImage && normalizedPlan.operation === 'generate') issues.push({ code: 'generate_unsupported', message: '当前生成配置不支持文生图。', field: 'operation' });
  if (normalizedPlan.operation === 'edit') {
    if (!normalizedPlan.referenceAssetIds || normalizedPlan.referenceAssetIds.length === 0) issues.push({ code: 'missing_reference', message: '图像编辑需要至少一张已导入或已生成的参考图片。', field: 'referenceAssetIds' });
    if (capabilities && !capabilities.referenceEdit) issues.push({ code: 'reference_edit_unsupported', message: '当前生成配置不支持参考图编辑。', field: 'referenceAssetIds' });
  }
  if (normalizedPlan.maskAssetId && capabilities && !capabilities.maskEdit) issues.push({ code: 'mask_unsupported', message: '当前生成配置不支持遮罩编辑。', field: 'maskAssetId' });
  return { valid: issues.length === 0, issues, normalizedPlan };
}
