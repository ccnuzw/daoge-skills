const { openProviderDatabase, closeProviderDatabase, createProviderProfile, resolveActiveProviderConfig, providerStatus } = require('../../dist/vnext/studio/provider-store');

function configureProvider(initialized, overrides = {}) {
  const db = openProviderDatabase(initialized.paths);
  try {
    createProviderProfile(db, {
      name: overrides.name || 'Test Provider',
      providerId: overrides.providerId || 'openai-images',
      model: overrides.model || 'fixture-model',
      baseUrl: overrides.baseUrl || 'https://images.example.test/v1',
      apiKey: overrides.apiKey || 'fixture-provider-key',
      options: { referenceEnabled: overrides.referenceEnabled === true },
      active: true,
      idempotencyKey: overrides.idempotencyKey || 'test-provider-create'
    });
    return { config: resolveActiveProviderConfig(db), status: providerStatus(db) };
  } finally {
    closeProviderDatabase(db);
  }
}

module.exports = { configureProvider };
