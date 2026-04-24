/**
 * HMAC verification tests. Signature handling is security-critical — the
 * whole point is that a request can't be accepted without the shared key.
 * Any regression here must be caught immediately.
 */

import { createHmac } from 'crypto';

import { signRequest, verifySignature } from './signature';

const KEY = 'sa_test_key_0000000000000000000000';
const BODY = '{"taskId":"t1","runId":"r1","phase":"SCOUT"}';

describe('signRequest', () => {
  test('produces a "sha256=<hex>" formatted header value', () => {
    const sig = signRequest(BODY, KEY);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  test('matches a known HMAC-SHA256 over the body', () => {
    const expected =
      'sha256=' + createHmac('sha256', KEY).update(BODY).digest('hex');
    expect(signRequest(BODY, KEY)).toBe(expected);
  });

  test('is stable for the same input', () => {
    expect(signRequest(BODY, KEY)).toBe(signRequest(BODY, KEY));
  });

  test('changes when the body changes by a single byte', () => {
    expect(signRequest(BODY, KEY)).not.toBe(signRequest(BODY + 'x', KEY));
  });

  test('changes when the key changes', () => {
    expect(signRequest(BODY, KEY)).not.toBe(signRequest(BODY, KEY + 'x'));
  });
});

describe('verifySignature', () => {
  test('accepts a correct signature', () => {
    const sig = signRequest(BODY, KEY);
    expect(verifySignature(BODY, KEY, sig)).toBe(true);
  });

  test('rejects a signature made with a different key', () => {
    const sig = signRequest(BODY, 'different-key');
    expect(verifySignature(BODY, KEY, sig)).toBe(false);
  });

  test('rejects a signature made over a different body', () => {
    const sig = signRequest(BODY + 'tampered', KEY);
    expect(verifySignature(BODY, KEY, sig)).toBe(false);
  });

  test('rejects a signature with tampered characters', () => {
    const sig = signRequest(BODY, KEY);
    // Flip the last hex character.
    const tampered = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect(verifySignature(BODY, KEY, tampered)).toBe(false);
  });

  test('rejects signatures of the wrong length without throwing', () => {
    // timingSafeEqual throws on length mismatch — verifySignature has to
    // guard against that so a malformed header can't crash the server.
    expect(() => verifySignature(BODY, KEY, 'sha256=short')).not.toThrow();
    expect(verifySignature(BODY, KEY, 'sha256=short')).toBe(false);
  });

  test('rejects an empty signature header', () => {
    expect(verifySignature(BODY, KEY, '')).toBe(false);
  });

  test('rejects a signature missing the "sha256=" prefix', () => {
    const sig = signRequest(BODY, KEY);
    const withoutPrefix = sig.slice('sha256='.length);
    expect(verifySignature(BODY, KEY, withoutPrefix)).toBe(false);
  });

  test('is length-constant-time on same-length inputs', () => {
    // We can't directly test timing safety, but we can confirm the API
    // returns false for a same-length wrong value without throwing.
    const sig = signRequest(BODY, KEY);
    const wrongSameLength = 'sha256=' + 'f'.repeat(64);
    expect(wrongSameLength.length).toBe(sig.length);
    expect(verifySignature(BODY, KEY, wrongSameLength)).toBe(false);
  });
});
