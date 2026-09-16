const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { ConfirmationGate } = require('../../dist/vnext/api/confirmation-gate');
const { WorkbenchPresence } = require('../../dist/vnext/runtime/workbench-presence');
const {
  DAEMON_IDENTITY_FILE,
  createConfirmationGatePersistence,
  createWorkbenchPresencePersistence,
  loadOrCreateDaemonIdentity
} = require('../../dist/vnext/runtime/daemon-state');

function temporaryRuntime() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-daemon-state-'));
}

const EXPECTED = { roundId: 'round-1', preflightId: 'preflight-1', planHash: 'plan-hash-1', conversationId: 'conversation-1' };

test('confirmation challenges, consents and tokens survive a gate restart', () => {
  const runtimeDir = temporaryRuntime();
  try {
    const secret = 's'.repeat(32);
    const first = new ConfirmationGate(secret, () => new Date('2026-09-14T00:00:00.000Z'), createConfirmationGatePersistence(runtimeDir));
    const challenge = first.createChallenge({ roundId: 'round-1', sessionId: 'session-1', conversationId: 'conversation-1', planHash: 'plan-hash-1', expectedVersion: 3 });

    const second = new ConfirmationGate(secret, () => new Date('2026-09-14T00:01:00.000Z'), createConfirmationGatePersistence(runtimeDir));
    assert.equal(second.getChallenge('round-1')?.challenge, challenge.challenge);
    assert.equal(second.validateChallenge({ roundId: 'round-1', challenge: challenge.challenge, sessionId: 'session-1', planHash: 'plan-hash-1' }), true);
    const consent = second.confirm({ roundId: 'round-1', challenge: challenge.challenge, sessionId: 'session-1', planHash: 'plan-hash-1' });
    assert.equal(consent.planHash, 'plan-hash-1');
    const token = second.issueToken(EXPECTED);

    const third = new ConfirmationGate(secret, () => new Date('2026-09-14T00:02:00.000Z'), createConfirmationGatePersistence(runtimeDir));
    assert.equal(third.verifyToken(token, EXPECTED), true);
    assert.deepEqual(third.reserveToken(token, EXPECTED, 'run:queue'), { replayed: false });

    // The single-use reservation is durable: a later process sees the same token as already used.
    const fourth = new ConfirmationGate(secret, () => new Date('2026-09-14T00:03:00.000Z'), createConfirmationGatePersistence(runtimeDir));
    assert.deepEqual(fourth.reserveToken(token, EXPECTED, 'run:queue'), { replayed: true });
    assert.throws(() => fourth.reserveToken(token, EXPECTED, 'run:other'), /already authorized/);

    // Rotating the secret invalidates previously issued tokens even though the state file still lists them.
    const rotated = new ConfirmationGate('t'.repeat(32), () => new Date('2026-09-14T00:04:00.000Z'), createConfirmationGatePersistence(runtimeDir));
    assert.equal(rotated.verifyToken(token, EXPECTED), false);

    // Expiry still applies across restarts.
    const expired = new ConfirmationGate(secret, () => new Date('2026-09-14T02:00:00.000Z'), createConfirmationGatePersistence(runtimeDir));
    assert.equal(expired.verifyToken(token, EXPECTED), false);
    assert.equal(expired.consentFor('round-1'), null);
    assert.equal(expired.getChallenge('round-1'), null);
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test('a gate without persistence keeps its previous in-memory behaviour', () => {
  const gate = new ConfirmationGate('p'.repeat(32), () => new Date('2026-09-14T00:00:00.000Z'));
  const challenge = gate.createChallenge({ roundId: 'round-1', sessionId: 'session-1', conversationId: 'conversation-1', planHash: 'plan-hash-1', expectedVersion: 1 });
  assert.equal(gate.validateChallenge({ roundId: 'round-1', challenge: challenge.challenge, sessionId: 'session-1', planHash: 'plan-hash-1' }), true);
  const restarted = new ConfirmationGate('p'.repeat(32), () => new Date('2026-09-14T00:00:00.000Z'));
  assert.equal(restarted.getChallenge('round-1'), null);
});

test('daemon identity is created once, kept at 0600, and repaired field by field', () => {
  const runtimeDir = temporaryRuntime();
  try {
    const first = loadOrCreateDaemonIdentity(runtimeDir);
    const second = loadOrCreateDaemonIdentity(runtimeDir);
    assert.deepEqual(second, first);
    for (const value of [first.capability, first.sessionToken, first.gateSecret]) assert.match(value, /^[A-Za-z0-9_-]{43,}$/);
    assert.notEqual(first.capability, first.sessionToken);
    assert.equal(first.version, 1);
    // ⚠️ Windows 没有 POSIX 权限位：fs.chmod 在那边只动只读位，mode 恒为 0666。
    // 实现里那句注释说的就是这个（"platforms without chmod keep the umask-derived mode"）。
    // 所以这条断言只在 POSIX 上成立 —— 那边才是 0600 真正生效、也真正挡得住同机其他用户的地方；
    // Windows 上这份身份文件的保护来自用户目录本身的 ACL，不是这一位。
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(runtimeDir, DAEMON_IDENTITY_FILE)).mode & 0o777, 0o600);
    }

    fs.writeFileSync(path.join(runtimeDir, DAEMON_IDENTITY_FILE), JSON.stringify({ version: 1, capability: 'too-short', sessionToken: first.sessionToken, gateSecret: first.gateSecret }));
    const repaired = loadOrCreateDaemonIdentity(runtimeDir);
    assert.equal(repaired.sessionToken, first.sessionToken);
    assert.equal(repaired.gateSecret, first.gateSecret);
    assert.match(repaired.capability, /^[A-Za-z0-9_-]{43,}$/);
    assert.notEqual(repaired.capability, 'too-short');

    fs.writeFileSync(path.join(runtimeDir, DAEMON_IDENTITY_FILE), 'not json');
    const recovered = loadOrCreateDaemonIdentity(runtimeDir);
    for (const value of [recovered.capability, recovered.sessionToken, recovered.gateSecret]) assert.match(value, /^[A-Za-z0-9_-]{43,}$/);
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});

test('workbench presence survives a restart so open reuses the existing workbench', () => {
  const runtimeDir = temporaryRuntime();
  try {
    let clock = 1000;
    const first = new WorkbenchPresence({ now: () => clock, persistence: createWorkbenchPresencePersistence(runtimeDir) });
    assert.equal(first.claim('k'.repeat(43)).reused, false);
    first.release('k'.repeat(43));
    // The per-request auth hook is throttled, so advance past the throttle window before writing it.
    clock = 4000;
    first.recordAuthenticatedConnection();

    const second = new WorkbenchPresence({ now: () => 4500, persistence: createWorkbenchPresencePersistence(runtimeDir) });
    const reopened = second.claim('m'.repeat(43));
    assert.equal(reopened.reused, true);
    assert.equal(reopened.reason, 'recent-workbench');

    // Outside the recent-presence window a fresh claim is granted again.
    const stale = new WorkbenchPresence({ now: () => 60_000, persistence: createWorkbenchPresencePersistence(runtimeDir) });
    assert.equal(stale.claim('n'.repeat(43)).reused, false);
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});
