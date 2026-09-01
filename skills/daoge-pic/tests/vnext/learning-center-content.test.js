const test = require('node:test');
const assert = require('node:assert/strict');

test('learning center covers every core Studio domain with structured guidance', async () => {
  const { LEARNING_FILTERS, LEARNING_PHASES, LEARNING_TOPICS } = await import('../../web/src/learning-center-content.mjs');
  const ids = new Set(LEARNING_TOPICS.map((topic) => topic.id));
  for (const required of ['projects', 'plans', 'preflight', 'runs', 'assets', 'references', 'library', 'delivery', 'recovery', 'safety']) assert.equal(ids.has(required), true);
  assert.equal(ids.size, LEARNING_TOPICS.length);
  assert.equal(LEARNING_FILTERS.some((item) => item.id === 'assets'), true);
  assert.deepEqual(LEARNING_PHASES.map((phase) => phase.id), ['projects', 'plans', 'runs', 'assets', 'delivery']);
  for (const topic of LEARNING_TOPICS) {
    assert.ok(topic.summary && topic.studio && topic.conversation);
    assert.ok(Array.isArray(topic.checkpoints) && topic.checkpoints.length >= 3);
    assert.ok(['start', 'create', 'assets', 'delivery', 'safety'].includes(topic.group));
  }
});
const fs = require('node:fs');
const path = require('node:path');

test('learning center only deep-links to Studio-global views', () => {
  const skillRoot = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const content = fs.readFileSync(path.join(skillRoot, 'web/src/learning-center-content.mjs'), 'utf8');
  assert.match(source, /<LearningCenter onDismiss=\{dismissGuide\} onNavigate=\{\([^)]*\) => navigateRoute\(\{ view: [^}]+ \}\)\} \/>/);
  assert.match(content, /action: 'projects'/);
  assert.match(content, /action: 'library'/);
  assert.doesNotMatch(content, /action: 'runs'/);
  assert.doesNotMatch(content, /action: 'deliveries'/);
});
