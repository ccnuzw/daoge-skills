const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { requestJson, fetchStudio } = require('./local-studio-test-helper');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-protocol-'));
}

test('runtime exposes protocol version separately from artifact version and rejects incompatible writers', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const studio = await requestJson(started, '/api/studio');
    assert.deepEqual(studio.body.data.protocol, { name: 'daoge-pic-skill-protocol', version: '2.0.0', runtimeVersion: '5.10.1', supportedRange: '>=2.0.0 <3.0.0' });
    const incompatible = await fetchStudio(started, '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'bad-protocol', 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/1.9.0' }, body: JSON.stringify({ name: 'blocked' }) });
    assert.equal(incompatible.status, 400);
    assert.match((await incompatible.json()).error.message, /协议不兼容/);
    const compatible = await fetchStudio(started, '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'compatible-protocol', 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.5' }, body: JSON.stringify({ name: 'accepted-compatible' }) });
    assert.equal(compatible.status, 200);
    const incompatibleRead = await fetchStudio(started, '/api/studio', { headers: { 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/1.9.0' } });
    assert.equal(incompatibleRead.status, 400);
    const missingProtocol = await fetch(started.url + '/api/studio', { headers: { authorization: 'Bearer ' + started.access.bearerToken } });
    assert.equal(missingProtocol.status, 400);
    assert.match((await missingProtocol.json()).error.message, /必须声明/);
    const declaration = JSON.parse(fs.readFileSync(path.join(__dirname, '../..', 'protocol-version.json'), 'utf8'));
    assert.equal(declaration.version, '2.0.0');
    assert.equal(declaration.runtimeCompatibility, '>=5.10.1 <6.0.0');
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
