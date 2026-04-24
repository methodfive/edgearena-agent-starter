/**
 * Minimal chat-completions client. Hits any OpenAI-compatible endpoint —
 * OpenAI itself, Groq, Together, Fireworks, OpenRouter, local Ollama, etc.
 *
 * Kept dependency-free on purpose. One `fetch`, Zod-shaped response parsing,
 * an AbortController for the per-call timeout, and a small retry loop for
 * transient errors (429, 5xx, network). Swap this whole file out if you
 * want to use a provider SDK instead.
 */

import type { LlmConfig } from '../config/env';
import { logWarn } from '../utils/logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  modelId: string;
}

export interface LlmCallOptions {
  /** Maximum time to wait for a single attempt, in milliseconds. */
  timeoutMs: number;
  /** Optional correlation id (e.g. taskId) for logs. */
  taskId?: string;
}

/**
 * Thrown when the chat call fails — timeout, HTTP error, or a response
 * shape we don't recognize. The agent turns this into a task failure.
 */
export class LlmError extends Error {
  override readonly name = 'LlmError';
  override readonly cause?: unknown;
  /** HTTP status if the failure came from a non-2xx response. */
  readonly status?: number;
  /** Whether this error is considered transient (worth retrying). */
  readonly retryable: boolean;
  constructor(message: string, opts: { cause?: unknown; status?: number; retryable?: boolean } = {}) {
    super(message);
    this.cause = opts.cause;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

// Keep responses in the thrown message short enough that they don't bloat
// logs or response bodies, but long enough that common provider errors
// (rate-limit reasons, model-context errors) are still readable. Full text
// is always logged separately at warn level.
const ERROR_SNIPPET_CHARS = 500;

export async function callChat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: LlmCallOptions,
): Promise<LlmResult> {
  const maxAttempts = cfg.retries + 1;
  let lastError: LlmError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callOnce(cfg, messages, opts);
    } catch (err) {
      const e = err instanceof LlmError
        ? err
        : new LlmError(`Unexpected error: ${(err as Error).message}`, { cause: err });
      lastError = e;

      // Stop retrying on fatal errors or after exhausting attempts.
      if (!e.retryable || attempt === maxAttempts) throw e;

      const delay = backoffMs(attempt);
      logWarn('llm_retry', {
        taskId: opts.taskId,
        attempt,
        maxAttempts,
        status: e.status,
        delayMs: delay,
        reason: e.message,
      });
      await sleep(delay);
    }
  }

  // Unreachable — the loop either returns or throws — but keeps TS happy.
  throw lastError ?? new LlmError('LLM call failed without a reported error');
}

async function callOnce(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: LlmCallOptions,
): Promise<LlmResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: cfg.temperature,
  };
  if (cfg.jsonMode) {
    // Most OpenAI-compatible hosts understand this; the ones that don't
    // tend to ignore it silently. Set LLM_JSON_MODE=false if yours rejects.
    body.response_format = { type: 'json_object' };
  }

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    clearTimeout(timeout);
    const name = (err as Error).name;
    if (name === 'AbortError') {
      // Timeouts are transient — the next attempt may land within budget.
      throw new LlmError(`Model call exceeded ${opts.timeoutMs}ms timeout`, {
        cause: err,
        retryable: true,
      });
    }
    throw new LlmError(`Model network error: ${(err as Error).message}`, {
      cause: err,
      retryable: true,
    });
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    // Log the full body — it often contains the specific reason (rate-limit
    // window, quota, content filter, etc.) that callers need to see.
    logWarn('llm_http_error', {
      taskId: opts.taskId,
      status: res.status,
      body: errText,
    });
    const retryable = res.status === 429 || res.status >= 500;
    throw new LlmError(
      `Model returned HTTP ${res.status}: ${errText.slice(0, ERROR_SNIPPET_CHARS)}`,
      { status: res.status, retryable },
    );
  }

  let data: ChatCompletionResponse;
  try {
    data = (await res.json()) as ChatCompletionResponse;
  } catch (err) {
    throw new LlmError('Model response body was not valid JSON', { cause: err });
  }

  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new LlmError('Model response contained no content');

  return {
    text,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    modelId: data.model ?? cfg.model,
  };
}

/** Backoff with jitter. Grows linearly per attempt and adds randomness. */
function backoffMs(attempt: number): number {
  const base = 250 * attempt;
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
