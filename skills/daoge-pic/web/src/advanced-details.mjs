export function normalizeAdvancedDetails(value) {
  const plans = Array.isArray(value?.plans) ? value.plans.filter((plan) => plan && typeof plan === 'object') : [];
  const dryRuns = Array.isArray(value?.dryRuns) ? value.dryRuns.filter((preview) => preview && typeof preview === 'object') : [];
  return { plans, dryRuns };
}

export function dryRunEvidence(preview) {
  const planSnapshot = preview?.planSnapshot && typeof preview.planSnapshot === 'object' ? preview.planSnapshot : null;
  const provider = preview?.providerSnapshot && typeof preview.providerSnapshot === 'object' ? preview.providerSnapshot : {};
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object' ? provider.capabilities : {};
  const itemCount = Number.isInteger(preview?.itemCount) ? preview.itemCount : null;
  return {
    status: planSnapshot ? '预检通过' : '记录不完整',
    planVersion: Number.isInteger(preview?.planVersion) ? preview.planVersion : null,
    details: {
      planSnapshot: planSnapshot || {},
      provider: {
        providerId: typeof provider.providerId === 'string' ? provider.providerId : null,
        model: typeof provider.model === 'string' ? provider.model : null,
        referenceEnabled: provider.referenceEnabled === true,
        capabilities
      },
      itemCount,
      createdAt: typeof preview?.createdAt === 'string' ? preview.createdAt : null
    }
  };
}
