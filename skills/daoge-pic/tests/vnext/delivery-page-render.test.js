const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('creator delivery renders in the delivery branch rather than the library branch', () => {
  const source = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const libraryBranch = source.indexOf("view === 'library' ?");
  const deliveryBranch = source.indexOf("view === 'deliveries' ?");
  const creatorDelivery = source.indexOf('<CreatorDelivery project={selectedProject}');
  assert.ok(libraryBranch >= 0);
  assert.ok(deliveryBranch > libraryBranch);
  assert.ok(creatorDelivery > deliveryBranch);
});
