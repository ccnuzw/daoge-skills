const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplateDirectory, searchTemplateDirectory } = require('../../src/domain/template_catalog');

test('template directory exposes category tags scenarios preview and examples', () => {
  const directory = buildTemplateDirectory();
  assert.equal(directory.templates.length >= 20, true);
  const poster = directory.templates.find((item) => item.id === 'campaign-poster');
  assert.equal(poster.category, 'poster-and-campaigns');
  assert.equal(Array.isArray(poster.tags), true);
  assert.equal(Array.isArray(poster.scenarios), true);
  assert.equal(typeof poster.description, 'string');
  assert.equal(typeof poster.exampleParams.startCommand, 'string');
  assert.equal(Array.isArray(poster.preview.qualityRules), true);
});

test('template directory supports category keyword and recommended filters', () => {
  const ui = searchTemplateDirectory({ category: 'ui-mockups' });
  assert.equal(ui.templates.every((item) => item.category === 'ui-mockups'), true);
  const keyword = searchTemplateDirectory({ keyword: '电商' });
  assert.equal(keyword.templates.some((item) => item.id === 'ecommerce-clean' || item.id === 'detail-page-set'), true);
  const recommended = searchTemplateDirectory({ recommendedOnly: true });
  assert.equal(recommended.templates.length > 0, true);
  assert.equal(recommended.templates.every((item) => item.recommended || item.commonUse), true);
});
