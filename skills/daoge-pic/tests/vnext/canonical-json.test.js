const assert = require('node:assert/strict');
const test = require('node:test');

const { CanonicalJsonError, canonicalJson, canonicalJsonHash, canonicalJsonValue } = require('../../dist/vnext/shared/canonical-json');

test('canonical JSON sorts object keys so semantically equal values hash equally', () => {
  const left = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } };
  const right = { a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalJsonHash(left), canonicalJsonHash(right));
});

test('integer-looking object keys remain lexicographically ordered in output', () => {
  assert.equal(canonicalJson(JSON.parse('{"10":"ten","2":"two","a":"a"}')), '{"10":"ten","2":"two","a":"a"}');
});

test('canonical JSON is stable across key insertion order for arrays of objects', () => {
  assert.equal(canonicalJson([{ a: 1, b: 2 }, { b: 2, a: 1 }]), canonicalJson([{ b: 2, a: 1 }, { a: 1, b: 2 }]));
});

test('undefined object members are dropped, while undefined elsewhere becomes null', () => {
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalJson([undefined, 1]), '[null,1]');
  assert.equal(canonicalJson(undefined), 'null');
});

test('non-finite numbers canonicalise to null instead of throwing', () => {
  assert.equal(canonicalJson({ a: Number.NaN, b: Number.POSITIVE_INFINITY }), '{"a":null,"b":null}');
});

test('a __proto__ key is treated as data, never as a prototype assignment', () => {
  const value = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
  assert.equal(canonicalJson(value), '{"__proto__":{"polluted":true},"safe":1}');
  assert.equal({}.polluted, undefined, 'canonicalising must not mutate Object.prototype');
});

test('strict mode rejects values JSON cannot represent rather than dropping them', () => {
  assert.throws(() => canonicalJsonValue({ a: undefined }, { strict: true }), (error) => error instanceof CanonicalJsonError && error.reason === 'non-json-value');
  assert.throws(() => canonicalJsonValue({ a: Number.NaN }, { strict: true }), (error) => error instanceof CanonicalJsonError && error.reason === 'non-finite-number');
  assert.ok(canonicalJsonValue({ a: 1 }, { strict: true }));
});

test('the digest is sha256 hex over the canonical JSON, not over JSON.stringify', () => {
  const value = { b: 1, a: 2 };
  assert.match(canonicalJsonHash(value), /^[a-f0-9]{64}$/);
  assert.notEqual(canonicalJsonHash(value), canonicalJsonHash({ a: 2, b: 1, c: 3 }));
});
