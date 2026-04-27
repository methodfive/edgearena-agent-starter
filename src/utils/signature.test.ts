/**
 * HMAC verification tests. Signature handling is security-critical — the
 * whole point is that a request can't be accepted without the shared key
 * AND can't be replayed outside its timestamp window or against a
 * different endpoint. Any regression here must be caught immediately.
 */

import { createHmac } from 'crypto';

import {
  TIMESTAMP_TOLERANCE_SECONDS,
  canonicalUrl,
  signRequest,
  verifySignature,
} from './signature';

const KEY = 'sa_test_key_0000000000000000000000';
const BODY = '{"taskId":"t1","runId":"r1","phase":"SCOUT"}';
const URL_A = 'https://agent-a.example.com/task';
const URL_B = 'https://agent-b.example.com/task';
const TS = 1_700_000_000;

describe('canonicalUrl', () => {
  test('returns host+pathname', () => {
    expect(canonicalUrl('https://agent.example.com/task')).toBe('agent.example.com/task');
  });

  test('drops scheme, query, and fragment', () => {
    expect(canonicalUrl('http://agent.example.com/task?x=1#y')).toBe('agent.example.com/task');
  });

  test('preserves the port when explicitly given', () => {
    expect(canonicalUrl('https://agent.example.com:8080/foo')).toBe('agent.example.com:8080/foo');
  });
});

describe('signRequest', () => {
  test('produces a "sha256=<hex>" formatted header value', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  test('matches a known HMAC-SHA256 over `${ts}\\n${host+path}\\n${body}`', () => {
    const material = `${TS}\n${canonicalUrl(URL_A)}\n${BODY}`;
    const expected = 'sha256=' + createHmac('sha256', KEY).update(material).digest('hex');
    expect(signRequest(BODY, KEY, TS, URL_A)).toBe(expected);
  });

  test('is stable for the same input', () => {
    expect(signRequest(BODY, KEY, TS, URL_A)).toBe(signRequest(BODY, KEY, TS, URL_A));
  });

  test('changes when the body changes by a single byte', () => {
    expect(signRequest(BODY, KEY, TS, URL_A)).not.toBe(signRequest(BODY + 'x', KEY, TS, URL_A));
  });

  test('changes when the key changes', () => {
    expect(signRequest(BODY, KEY, TS, URL_A)).not.toBe(signRequest(BODY, KEY + 'x', TS, URL_A));
  });

  test('changes when the timestamp changes', () => {
    expect(signRequest(BODY, KEY, TS, URL_A)).not.toBe(signRequest(BODY, KEY, TS + 1, URL_A));
  });

  test('changes when the URL host or path changes', () => {
    expect(signRequest(BODY, KEY, TS, URL_A)).not.toBe(signRequest(BODY, KEY, TS, URL_B));
    expect(signRequest(BODY, KEY, TS, URL_A)).not.toBe(
      signRequest(BODY, KEY, TS, 'https://agent-a.example.com/other'),
    );
  });
});

describe('verifySignature', () => {
  test('accepts a correct signature inside the tolerance window', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    expect(verifySignature(BODY, KEY, sig, TS, URL_A, TS)).toBe(true);
  });

  test('rejects a signature made with a different key', () => {
    const sig = signRequest(BODY, 'different-key', TS, URL_A);
    expect(verifySignature(BODY, KEY, sig, TS, URL_A, TS)).toBe(false);
  });

  test('rejects a signature made over a different body', () => {
    const sig = signRequest(BODY + 'tampered', KEY, TS, URL_A);
    expect(verifySignature(BODY, KEY, sig, TS, URL_A, TS)).toBe(false);
  });

  test('rejects a signature minted for a different URL (cross-endpoint replay)', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    expect(verifySignature(BODY, KEY, sig, TS, URL_B, TS)).toBe(false);
  });

  test('rejects a signature when the timestamp is outside the past tolerance', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    const now = TS + TIMESTAMP_TOLERANCE_SECONDS + 1;
    expect(verifySignature(BODY, KEY, sig, TS, URL_A, now)).toBe(false);
  });

  test('rejects a signature when the timestamp is outside the future tolerance', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    const now = TS - TIMESTAMP_TOLERANCE_SECONDS - 1;
    expect(verifySignature(BODY, KEY, sig, TS, URL_A, now)).toBe(false);
  });

  test('accepts a signature exactly at the edge of the tolerance window', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    const now = TS + TIMESTAMP_TOLERANCE_SECONDS;
    expect(verifySignature(BODY, KEY, sig, TS, URL_A, now)).toBe(true);
  });

  test('rejects a non-finite timestamp without throwing', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    expect(() => verifySignature(BODY, KEY, sig, NaN, URL_A, TS)).not.toThrow();
    expect(verifySignature(BODY, KEY, sig, NaN, URL_A, TS)).toBe(false);
    expect(verifySignature(BODY, KEY, sig, Infinity, URL_A, TS)).toBe(false);
  });

  test('rejects a tampered timestamp where the presented value disagrees with the signed one', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    // Both presented timestamp and now sit at TS+1: in-window, but the
    // signature was minted against TS, so the HMAC must mismatch.
    expect(verifySignature(BODY, KEY, sig, TS + 1, URL_A, TS + 1)).toBe(false);
  });

  test('rejects a signature with tampered characters', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    // Flip the last hex character.
    const tampered = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
    expect(verifySignature(BODY, KEY, tampered, TS, URL_A, TS)).toBe(false);
  });

  test('rejects signatures of the wrong length without throwing', () => {
    // timingSafeEqual throws on length mismatch — verifySignature has to
    // guard against that so a malformed header can't crash the server.
    expect(() => verifySignature(BODY, KEY, 'sha256=short', TS, URL_A, TS)).not.toThrow();
    expect(verifySignature(BODY, KEY, 'sha256=short', TS, URL_A, TS)).toBe(false);
  });

  test('rejects an empty signature header', () => {
    expect(verifySignature(BODY, KEY, '', TS, URL_A, TS)).toBe(false);
  });

  test('rejects a signature missing the "sha256=" prefix', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    const withoutPrefix = sig.slice('sha256='.length);
    expect(verifySignature(BODY, KEY, withoutPrefix, TS, URL_A, TS)).toBe(false);
  });

  test('is length-constant-time on same-length inputs', () => {
    // We can't directly test timing safety, but we can confirm the API
    // returns false for a same-length wrong value without throwing.
    const sig = signRequest(BODY, KEY, TS, URL_A);
    const wrongSameLength = 'sha256=' + 'f'.repeat(64);
    expect(wrongSameLength.length).toBe(sig.length);
    expect(verifySignature(BODY, KEY, wrongSameLength, TS, URL_A, TS)).toBe(false);
  });

  test('treats query/fragment differences in the URL as the same canonical destination', () => {
    const sig = signRequest(BODY, KEY, TS, URL_A);
    expect(verifySignature(BODY, KEY, sig, TS, `${URL_A}?cache=1#x`, TS)).toBe(true);
  });
});
