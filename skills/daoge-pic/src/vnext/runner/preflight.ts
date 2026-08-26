import { ImageOperation, ImageProviderCapabilities } from '../providers/contracts';
import { SafeProviderStatus } from '../studio/provider-config';

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

export function preflightGenerationPlan(plan: PreflightPlan, providerStatus: SafeProviderStatus): PreflightResult {
  const normalizedPlan: PreflightPlan = {
    operation: plan.operation,
    itemCount: Number(plan.itemCount),
    prompt: String(plan.prompt || '').trim(),
    referenceAssetIds: Array.from(new Set(plan.referenceAssetIds || [])),
    maskAssetId: plan.maskAssetId || undefined,
    output: plan.output || {}
  };
  const issues: PreflightIssue[] = [];
  const capabilities = capabilitiesFromStatus(providerStatus);
  if (!providerStatus.configured || !providerStatus.providerId || !capabilities) {
    issues.push({ code: 'provider_not_ready', message: '当前生成配置未完成，无法开始生图。', field: 'provider' });
  }
  if (!Number.isInteger(normalizedPlan.itemCount) || normalizedPlan.itemCount < 1 || normalizedPlan.itemCount > 1000) {
    issues.push({ code: 'invalid_item_count', message: '生成数量必须是 1 到 1000 之间的整数。', field: 'itemCount' });
  }
  if (!normalizedPlan.prompt) issues.push({ code: 'missing_prompt', message: '创作计划缺少可执行的图像描述。', field: 'prompt' });
  if (capabilities && !capabilities.textToImage && normalizedPlan.operation === 'generate') {
    issues.push({ code: 'generate_unsupported', message: '当前生成配置不支持文生图。', field: 'operation' });
  }
  if (normalizedPlan.operation === 'edit') {
    if (!normalizedPlan.referenceAssetIds || normalizedPlan.referenceAssetIds.length === 0) {
      issues.push({ code: 'missing_reference', message: '图像编辑需要至少一张已导入或已生成的参考图片。', field: 'referenceAssetIds' });
    }
    if (capabilities && !capabilities.referenceEdit) {
      issues.push({ code: 'reference_edit_unsupported', message: '当前生成配置不支持参考图编辑。', field: 'referenceAssetIds' });
    }
  }
  if (normalizedPlan.maskAssetId && capabilities && !capabilities.maskEdit) {
    issues.push({ code: 'mask_unsupported', message: '当前生成配置不支持遮罩编辑。', field: 'maskAssetId' });
  }
  return { valid: issues.length === 0, issues, normalizedPlan };
}
