export function createProviderEditForm(profile) {
  return {
    name: profile.name,
    providerId: profile.providerId,
    model: profile.model,
    baseUrlAction: 'keep',
    baseUrl: '',
    apiKeyAction: 'keep',
    apiKey: '',
    referenceEnabled: profile.referenceEnabled === true
  };
}
