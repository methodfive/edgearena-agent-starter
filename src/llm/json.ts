/**
 * JSON parsing + light repair. Models sometimes wrap JSON in markdown code
 * fences, add a leading sentence, or trail off with commentary. These
 * helpers try the cheapest fixes first so a slightly-off reply still makes
 * it through. Anything that still won't parse or validate is surfaced to
 * the caller as an error.
 */

import type { ZodType, ZodTypeDef } from 'zod';

export type ParseResult<T> =
  | { ok: true; data: T; repaired: boolean }
  | { ok: false; error: string };

/**
 * Try each repair pass in order. Returns the first one that parses AND
 * validates. `repaired` is true when anything beyond a direct JSON.parse
 * was needed — useful for logging so you can see when the model is drifting.
 */
export function parseAndValidate<T>(
  raw: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
): ParseResult<T> {
  const attempts: Array<{ label: string; text: string }> = [
    { label: 'direct', text: raw },
    { label: 'stripped-fences', text: stripCodeFences(raw) },
    { label: 'brace-slice', text: braceSlice(raw) },
  ];

  let lastError = 'empty input';
  for (const { label, text } of attempts) {
    if (!text) continue;
    const parsed = safeJsonParse(text);
    if (parsed === undefined) {
      lastError = `could not parse JSON (${label})`;
      continue;
    }
    const check = schema.safeParse(parsed);
    if (check.success) {
      return { ok: true, data: check.data, repaired: label !== 'direct' };
    }
    lastError = check.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  }
  return { ok: false, error: lastError };
}

/** `JSON.parse` that returns undefined instead of throwing. */
export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Strip a single markdown code fence wrapper if one is present.
 *   ```json ... ```   →  ...
 *   ``` ... ```       →  ...
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const withoutOpen = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, '');
  const closeIdx = withoutOpen.lastIndexOf('```');
  return closeIdx === -1 ? withoutOpen.trim() : withoutOpen.slice(0, closeIdx).trim();
}

/**
 * Return the substring between the first `{` and the last `}`. Useful when
 * a model prefaces its reply with "Sure! Here's the JSON:" or trails off
 * with a closing remark.
 */
export function braceSlice(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return '';
  return text.slice(start, end + 1);
}
