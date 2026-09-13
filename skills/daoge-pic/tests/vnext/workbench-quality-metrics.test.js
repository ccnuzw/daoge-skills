const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

function source() {
  return fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
}

test('project overview exposes scoped quality metrics with recoverable loading', () => {
  const main = source();
  assert.match(main, /<ProjectQualityMetrics metrics=\{qualityMetrics\} loading=\{qualityMetricsLoading\} error=\{qualityMetricsError\}/);
  assert.match(main, /\/api\/projects\/'.*\/quality-metrics/);
  assert.match(main, /qualityMetricsRequests\.current\.begin\(projectId\)/);
  assert.match(main, /if \(isAbortError\(nextError\) \|\| !request\.isCurrent\(\)\) return false/);
  assert.match(main, /onRefreshQualityMetrics=\{refreshQualityMetrics\}/);
});

test('quality metrics render only safe aggregate fields and bounded failure patterns', () => {
  const main = source();
  const start = main.indexOf('function ProjectQualityMetrics(');
  const end = main.indexOf('function ProjectTaskList(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const component = main.slice(start, end);
  assert.match(component, /slice\(0, 3\)/);
  assert.match(component, /pattern\.kind/);
  assert.match(component, /pattern\.code/);
  assert.match(component, /pattern\.count/);
  assert.doesNotMatch(component, /pattern\.summary|pattern\.lastSeenAt|error_json/);
  assert.match(component, /role="alert" aria-live="assertive"/);
  assert.match(component, />重试<\/button>/);
});
