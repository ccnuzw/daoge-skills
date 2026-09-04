const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfirmationGate, planHash } = require('../../dist/vnext/api/confirmation-gate');

test('confirmation gate issues only a plan/preflight/conversation-bound token after challenge confirmation', () => {
  let now = new Date('2026-09-04T00:00:00.000Z');
  const gate = new ConfirmationGate('a'.repeat(32), () => now);
  const hash = planHash({ itemCount: 2, operation: 'generate', prompt: 'safe plan' });
  const challenge = gate.createChallenge({ roundId: 'round-1', sessionId: 'session-1', conversationId: 'conversation-1', planHash: hash, expectedVersion: 2 });
  assert.throws(() => gate.issueToken({ roundId: 'round-1', preflightId: 'dryrun-1', planHash: hash, conversationId: 'conversation-1' }), /fresh user confirmation/);
  gate.confirm({ roundId: 'round-1', challenge: challenge.challenge, sessionId: 'session-1', planHash: hash });
  const token = gate.issueToken({ roundId: 'round-1', preflightId: 'dryrun-1', planHash: hash, conversationId: 'conversation-1' });
  assert.equal(gate.verifyToken(token, { roundId: 'round-1', preflightId: 'dryrun-1', planHash: hash, conversationId: 'conversation-1' }), true);
  assert.equal(gate.verifyToken(token, { roundId: 'round-1', preflightId: 'dryrun-2', planHash: hash, conversationId: 'conversation-1' }), false);
  assert.equal(gate.verifyToken(token, { roundId: 'round-1', preflightId: 'dryrun-1', planHash: planHash({ itemCount: 3 }), conversationId: 'conversation-1' }), false);
  assert.equal(gate.verifyToken(token, { roundId: 'round-1', preflightId: 'dryrun-1', planHash: hash, conversationId: 'conversation-2' }), false);
});

test('confirmation gate rejects stale, mismatched, and expired user challenges', () => {
  let now = new Date('2026-09-04T00:00:00.000Z');
  const gate = new ConfirmationGate('b'.repeat(32), () => now);
  const hash = planHash({ operation: 'generate', itemCount: 1, prompt: 'plan' });
  const challenge = gate.createChallenge({ roundId: 'round-2', sessionId: 'session-2', conversationId: 'conversation-2', planHash: hash, expectedVersion: 1 });
  assert.throws(() => gate.confirm({ roundId: 'round-2', challenge: challenge.challenge, sessionId: 'session-other', planHash: hash }), /invalid/);
  assert.throws(() => gate.confirm({ roundId: 'round-2', challenge: challenge.challenge, sessionId: 'session-2', planHash: planHash({ changed: true }) }), /invalid/);
  now = new Date('2026-09-04T00:11:00.000Z');
  assert.throws(() => gate.confirm({ roundId: 'round-2', challenge: challenge.challenge, sessionId: 'session-2', planHash: hash }), /invalid/);
});
