/**
 * HMAC-SHA256 helpers for verifying signed task dispatches.
 *
 * The signature covers the exact raw request bytes received on the wire.
 * Never re-serialize a parsed body before verifying — JSON key order and
 * whitespace are not guaranteed to round-trip and will break the check.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Build the signature header value for `rawBody`, keyed by the shared
 * secret. Used in tests and anywhere you need to sign your own payloads
 * (e.g. an async completion callback).
 */
export function signRequest(rawBody: string, apiKey: string): string {
  return `sha256=${createHmac('sha256', apiKey).update(rawBody).digest('hex')}`;
}

/**
 * Constant-time comparison between the expected signature for `rawBody`
 * and the one provided on the request. Returns false on any mismatch
 * (including length mismatches) without leaking timing information.
 */
export function verifySignature(
  rawBody: string,
  apiKey: string,
  providedSignature: string,
): boolean {
  const expected = signRequest(rawBody, apiKey);
  const a = Buffer.from(expected);
  const b = Buffer.from(providedSignature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
