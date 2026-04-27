/**
 * All HTTP route handlers and the helpers they share.
 *
 * Mounted by `./index.ts` on an Express app that has already installed a
 * JSON body parser with raw-body capture (the raw bytes are needed for
 * HMAC signature verification).
 */

import { type NextFunction, type Request, type Response, Router } from 'express';

import { AgentTaskError, handleDispatch, handleSimulation } from '../agent';
import { config } from '../config/env';
import {
  type DispatchResponse,
  type ErrorResponse,
  type HandshakeResponse,
  PROTOCOL_VERSION,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '../protocol/types';
import {
  AnalystSimulationSchema,
  BuilderSimulationSchema,
  DispatchSchema,
  HandshakeSchema,
  ScoutSimulationSchema,
  formatZodError,
} from '../protocol/validate';
import { logError } from '../utils/logger';
import { verifySignature } from '../utils/signature';

export interface RawBodyRequest extends Request {
  rawBody?: string;
}

export const router = Router();

// ── GET /  liveness ────────────────────────────────────────────────────────

router.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: 'edgearena-agent',
    protocol: PROTOCOL_VERSION,
    agent: { name: config.agent.name, role: config.agent.role },
    model: config.llm.model,
  });
});

// ── POST /  shape-routed ───────────────────────────────────────────────────
// The same URL receives all three POST payloads. Handshake and simulation
// carry a `type` discriminator; dispatch payloads don't — those are
// identified by the presence of `taskId` + `runId` + `messages`. If a
// future protocol revision adds a discriminator for dispatch, prefer
// that over the shape check.

router.post('/', (req: Request, res: Response, next: NextFunction) => {
  const body = req.body;
  if (!isPlainObject(body)) {
    return void badRequest(res, 'Request body must be a JSON object');
  }

  if (body.type === 'handshake') return handleHandshakeRequest(req, res);

  if (body.type === 'scout_task' || body.type === 'build_task' || body.type === 'analyst_task') {
    handleSimulationRequest(req, res).catch(next);
    return;
  }

  if ('taskId' in body && 'runId' in body && 'messages' in body) {
    handleDispatchRequest(req, res).catch(next);
    return;
  }

  badRequest(
    res,
    'Unrecognized payload — expected a handshake, a simulation, or a task dispatch.',
  );
});

// ── Per-shape handlers ─────────────────────────────────────────────────────

function handleHandshakeRequest(req: Request, res: Response): void {
  const parsed = HandshakeSchema.safeParse(req.body);
  if (!parsed.success) return void badRequest(res, formatZodError(parsed.error));

  const response: HandshakeResponse = { ok: true, protocol: PROTOCOL_VERSION };
  res.status(200).json(response);
}

async function handleSimulationRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as { type: string };
  const schema =
    body.type === 'scout_task' ? ScoutSimulationSchema
    : body.type === 'build_task' ? BuilderSimulationSchema
    : body.type === 'analyst_task' ? AnalystSimulationSchema
    : null;

  if (!schema) return void badRequest(res, `Unsupported simulation type: ${String(body.type)}`);

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return void badRequest(res, formatZodError(parsed.error));

  // Onboarding advertises its deadline in the payload. Honour whichever is
  // shorter — the payload hint or our configured LLM timeout.
  const advertised = Number(parsed.data.deadline_ms);
  const timeoutMs = Number.isFinite(advertised) && advertised > 0
    ? Math.min(advertised, config.llm.timeoutMs)
    : config.llm.timeoutMs;

  try {
    const { output } = await handleSimulation(
      parsed.data as Parameters<typeof handleSimulation>[0],
      { timeoutMs, taskId: parsed.data.task_id },
    );
    res.status(200).json(output);
  } catch (err) {
    writeAgentError(res, err, 'simulation_failed', { taskId: parsed.data.task_id });
  }
}

/**
 * In-memory LRU of taskIds we've already accepted. A duplicate dispatch
 * — same taskId, same body, even with a fresh signature — is a replay and
 * gets rejected. The cache is bounded so a long-running agent can't grow
 * memory without limit; once an entry falls out, that taskId could in
 * principle be replayed again, but only after `MAX_PROCESSED_TASK_IDS`
 * other tasks went by AND its timestamp is still inside the tolerance
 * window — both unlikely in practice. Production agents that need
 * stronger guarantees should swap this for a Redis/DB-backed store.
 */
const MAX_PROCESSED_TASK_IDS = 1024;
const processedTaskIds = new Set<string>();

function rememberTaskId(taskId: string): void {
  processedTaskIds.add(taskId);
  if (processedTaskIds.size > MAX_PROCESSED_TASK_IDS) {
    // Set iteration order is insertion order — drop the oldest.
    const oldest = processedTaskIds.values().next().value;
    if (oldest !== undefined) processedTaskIds.delete(oldest);
  }
}

/** Test-only hook: clear the dedupe cache between cases. */
export function __resetProcessedTaskIdsForTests(): void {
  processedTaskIds.clear();
}

async function handleDispatchRequest(req: RawBodyRequest, res: Response): Promise<void> {
  const parsed = DispatchSchema.safeParse(req.body);
  if (!parsed.success) return void badRequest(res, formatZodError(parsed.error));

  const rawBody = req.rawBody ?? '';
  const providedSig = headerAsString(req.headers[SIGNATURE_HEADER]);
  const providedTs = headerAsString(req.headers[TIMESTAMP_HEADER]);
  const timestamp = Number(providedTs);

  // Reconstruct the URL the platform signed against. We trust `Host` plus
  // the request path here — agents behind a proxy that rewrites these
  // headers will need to derive the canonical URL differently (e.g. from
  // a configured public URL).
  const host = headerAsString(req.headers.host);
  const path = (req.originalUrl ?? req.url ?? '/').split('?')[0];
  const targetUrl = `https://${host}${path}`;

  // Dispatches are HMAC-authenticated. Refuse to process them at all when
  // EDGEARENA_API_KEY isn't configured — running unauthenticated would let
  // any caller spoof tasks and damage the agent's reputation. The agent
  // *must* be configured with the key the platform issued at registration.
  if (!config.edgearenaApiKey) {
    logError('dispatch_misconfigured', {
      note: 'EDGEARENA_API_KEY not set — refusing dispatch. Set the env var to the key shown during agent registration.',
      taskId: parsed.data.taskId,
    });
    res.status(401).json({
      error: 'Agent is misconfigured: EDGEARENA_API_KEY env var is not set',
      code: 'agent_not_configured',
    } satisfies ErrorResponse);
    return;
  }
  if (
    !providedSig ||
    !verifySignature(rawBody, config.edgearenaApiKey, providedSig, timestamp, targetUrl)
  ) {
    res.status(401).json({
      error: 'Invalid, missing, or expired signature',
      code: 'invalid_signature',
    } satisfies ErrorResponse);
    return;
  }

  // Replay defence in depth: even when the signature, timestamp window,
  // and URL all check out, a request reusing a taskId we've already
  // accepted is rejected. Combined with the timestamp window, this
  // closes the small window where a captured request could be replayed
  // before its timestamp expires.
  if (processedTaskIds.has(parsed.data.taskId)) {
    res.status(409).json({
      error: 'Task already processed',
      code: 'duplicate_task',
    } satisfies ErrorResponse);
    return;
  }
  rememberTaskId(parsed.data.taskId);

  try {
    const { output, usage } = await handleDispatch(parsed.data, {
      timeoutMs: config.llm.timeoutMs,
      taskId: parsed.data.taskId,
    });
    const response: DispatchResponse = {
      output,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      modelId: usage.modelId,
    };
    res.status(200).json(response);
  } catch (err) {
    writeAgentError(res, err, 'dispatch_failed', { taskId: parsed.data.taskId });
  }
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/**
 * Map an error from a handler to an HTTP response. `AgentTaskError` becomes
 * 502 (upstream model failed). Anything else is a bug and becomes 500.
 */
function writeAgentError(
  res: Response,
  err: unknown,
  event: string,
  extra: Record<string, unknown> = {},
): void {
  if (err instanceof AgentTaskError) {
    logError(event, {
      ...extra,
      reason: err.reason,
      message: err.message,
      ...(err.rawOutput !== undefined ? { rawOutput: err.rawOutput.slice(0, 500) } : {}),
    });
    if (!res.headersSent) {
      // Surface the validation message and a snippet of the model's raw text
      // so the caller can show *why* validation failed (e.g. wizard's
      // "View technical details" panel). Capped at 4 KB to keep responses
      // small while still being useful for debugging.
      const rawSnippet = err.rawOutput?.slice(0, 4096);
      res.status(502).json({
        error: err.reason === 'llm_error'
          ? 'Upstream model call failed'
          : 'Agent produced an invalid response',
        code: err.reason,
        ...(err.reason === 'invalid_output' ? { validationError: err.message } : {}),
        ...(rawSnippet !== undefined ? { rawOutput: rawSnippet } : {}),
      } satisfies ErrorResponse);
    }
    return;
  }
  logError(event, { ...extra, message: (err as Error).message });
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error',
      code: 'internal_error',
    } satisfies ErrorResponse);
  }
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message, code: 'bad_request' } satisfies ErrorResponse);
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function headerAsString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}
