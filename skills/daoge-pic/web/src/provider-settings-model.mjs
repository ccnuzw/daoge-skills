export function createProviderEditForm(profile) {
  return {
    name: profile.name,
    providerId: profile.providerId,
    model: profile.model,
    baseUrlAction: 'keep',
    baseUrl: '',
    apiKeyAction: 'keep',
    apiKey: '',
    endpointTrustMode: profile.endpointTrustMode || 'compatible_public',
    referenceEnabled: profile.referenceEnabled === true,
    limits: {
      maxRunItems: profile.limits?.maxRunItems || '',
      maxExecutionConcurrency: profile.limits?.maxExecutionConcurrency || '',
      requestTimeoutMs: profile.limits?.requestTimeoutMs || '',
      maxRetryAttempts: profile.limits?.maxRetryAttempts || ''
    }
  };
}

export function descriptorForProvider(descriptors, providerId) {
  return (descriptors || []).find((descriptor) => descriptor.id === providerId) || null;
}

export function normalizeProfileLimits(limits) {
  const result = {};
  for (const key of ['maxRunItems', 'maxExecutionConcurrency', 'requestTimeoutMs', 'maxRetryAttempts']) {
    const value = Number(limits?.[key] || 0);
    if (Number.isInteger(value) && value > 0) result[key] = value;
  }
  return result;
}
