/**
 * HMAC-SHA256 helpers for verifying signed task dispatches.
 *
 * The signature covers `${timestamp}\n${host+path}\n${rawRequestBody}`,
 * keyed by the agent's shared API key. Including the timestamp and URL
 * blocks two classes of replay attack:
 *   - replaying an old captured request after the tolerance window;
 *   - replaying a request signed for one endpoint against a different
 *     endpoint that happens to share an API key.
 *
 * The signature covers the exact raw request bytes received on the wire.
 * Never re-serialize a parsed body before verifying — JSON key order and
 * whitespace are not guaranteed to round-trip and will break the check.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Maximum tolerable clock skew between platform and agent. Requests whose
 * timestamp falls outside this window are rejected as potential replays.
 * ±300s matches the Stripe / Slack standard.
 */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Canonical "host+path" form of a URL used in the signed material. Strips
 * scheme, query, and fragment so the platform and the agent derive the
 * same string for the same destination URL.
 */
export function canonicalUrl(url: string): string {
  const u = new URL(url);
  return u.host + u.pathname;
}

/**
 * Build the signature header value for `rawBody` against the supplied
 * timestamp and destination URL, keyed by the shared secret. Used in
 * tests and anywhere you need to sign your own payloads (e.g. an async
 * completion callback).
 */
export function signRequest(
  rawBody: string,
  apiKey: string,
  timestamp: number,
  url: string,
): string {
  const material = `${timestamp}\n${canonicalUrl(url)}\n${rawBody}`;
  return `sha256=${createHmac('sha256', apiKey).update(material).digest('hex')}`;
}

/**
 * Constant-time check that `providedSignature` matches the expected HMAC
 * for `(timestamp, url, rawBody)` AND that `timestamp` falls inside
 * `TIMESTAMP_TOLERANCE_SECONDS` of `nowSeconds`. Returns false on any
 * mismatch (including length mismatches and out-of-window timestamps)
 * without leaking timing information. `nowSeconds` is injectable so tests
 * can pin the clock.
 */
export function verifySignature(
  rawBody: string,
  apiKey: string,
  providedSignature: string,
  timestamp: number,
  url: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(nowSeconds - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const expected = signRequest(rawBody, apiKey, timestamp, url);
  const a = Buffer.from(expected);
  const b = Buffer.from(providedSignature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
