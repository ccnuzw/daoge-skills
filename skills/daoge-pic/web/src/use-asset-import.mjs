import { useState } from 'react';
import { ASSET_IMPORT_CONCURRENCY, mapWithConcurrency } from './bounded-concurrency.mjs';
import { errorMessageForDisplay } from './error-model.mjs';
import { advanceUploadProgress, imageFilesFrom, maskImportHeaders, maskImportProblem, mergeImportedReferences, resolveUploadMaterial, shouldLinkImportedToRound, uploadOutcome } from './asset-import-model.mjs';
import { REFERENCE_USAGE_LABELS, materialNeedReferenceNote } from './reference-usage-model.mjs';

/**
 * 导入素材这两个动作，以及它们需要的一点点状态。
 *
 * 这里只做接线：发请求、推进度、把结果交给 App 去展示。**该挂到哪个范围、算不算成功、
 * 要不要进参考素材**这些判断全在 `asset-import-model.mjs` 里，那里有单测。
 *
 * 依赖多达十几个，是因为这两个动作本来就在 App 正中间：它要知道当前项目/任务/轮次、
 * 当前范围、素材需求、参考素材，还要能刷列表和弹提示。全部显式传进来，而不是让 hook
 * 自己伸手去够 —— 这样谁依赖什么一眼看得见。
 *
 * @param {object} input
 * @param {(path: string, options?: object) => Promise<any>} input.api
 * @param {() => Promise<any>} input.refresh
 * @param {(prefix: string) => string} input.uniqueKey
 * @param {{ type: string, id: string }|null} input.uploadTarget 由 resolveUploadTarget 决定
 * @param {string} input.assetScope
 * @param {string} input.selectedImportNeed
 * @param {string[]} input.contextMaterialNeeds
 * @param {{ id: string }|null} input.selectedProject
 * @param {{ id: string, status?: string }|null} input.selectedRound
 * @param {Array<{ assetId: string, usage: string, note?: string }>} input.referenceMaterials
 * @param {(materials: any[], close?: boolean) => Promise<boolean>} input.saveRoundReferenceMaterials
 * @param {(value: string) => void} input.setError
 * @param {(value: string) => void} input.setNotice
 * @param {{ current: { value?: string } | null }} input.inputRef 传完文件后要清掉，否则选同名文件不触发 change
 */
export function useAssetImport({
  api,
  refresh,
  uniqueKey,
  uploadTarget,
  assetScope,
  selectedImportNeed,
  contextMaterialNeeds,
  selectedProject,
  selectedRound,
  referenceMaterials,
  saveRoundReferenceMaterials,
  setError,
  setNotice,
  inputRef
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);

  const upload = async (files) => {
    const images = imageFilesFrom(files);
    if (!images.length) return;

    const failed = [];
    const { need: uploadMaterialNeed, preset: uploadMaterialPreset } = resolveUploadMaterial({ selectedImportNeed, contextMaterialNeeds, assetScope });
    const importedAssets = [];
    try {
      setUploading(true); setUploadProgress({ completed: 0, total: images.length }); setError(''); setNotice('');
      await mapWithConcurrency(images, async (file) => {
        try {
          const data = await api('/api/assets/import', {
            method: 'POST',
            idempotencyKey: uniqueKey('upload'),
            contentType: file.type || 'application/octet-stream',
            headers: {
              'x-daoge-filename': encodeURIComponent(file.name),
              ...(uploadTarget ? { 'x-daoge-target-type': uploadTarget.type, 'x-daoge-target-id': uploadTarget.id } : {}),
              ...(uploadMaterialNeed ? { 'x-daoge-material-need': encodeURIComponent(uploadMaterialNeed), 'x-daoge-material-usage': uploadMaterialPreset.usage } : {})
            },
            rawBody: file
          });
          if (data?.id) importedAssets.push(data);
        } catch (nextError) {
          failed.push({ name: file.name, message: errorMessageForDisplay(nextError, '无法导入图片。') });
        }
        setUploadProgress((current) => advanceUploadProgress(current, images.length));
      }, ASSET_IMPORT_CONCURRENCY);
      await refresh();
      let referenceSaved = false;
      const usage = uploadMaterialPreset?.usage || 'subject';
      if (shouldLinkImportedToRound({ succeeded: images.length - failed.length, importedCount: importedAssets.length, selectedRound, assetScope })) {
        const note = uploadMaterialNeed ? materialNeedReferenceNote(uploadMaterialNeed, usage) : '本轮直接导入 · ' + (REFERENCE_USAGE_LABELS[usage] || usage);
        referenceSaved = await saveRoundReferenceMaterials(mergeImportedReferences({ existing: referenceMaterials, importedAssets, usage, note }), false);
      }
      const outcome = uploadOutcome({ total: images.length, failed, savedAsReference: referenceSaved });
      if (outcome.notice) setNotice(outcome.notice);
      if (outcome.error) setError(outcome.error);
    } finally {
      setUploading(false); setUploadProgress(null); if (inputRef.current) inputRef.current.value = '';
    }
  };

  const importDerivedMaskAsset = async (file) => {
    const problem = maskImportProblem({ selectedProject, file });
    if (problem) throw new Error(problem);
    const data = await api('/api/assets/import', {
      method: 'POST',
      idempotencyKey: uniqueKey('mask-upload'),
      contentType: file.type || 'application/octet-stream',
      headers: maskImportHeaders({ projectId: selectedProject.id, file }),
      rawBody: file
    });
    await refresh();
    return data;
  };

  return { uploading, uploadProgress, upload, importDerivedMaskAsset };
}
