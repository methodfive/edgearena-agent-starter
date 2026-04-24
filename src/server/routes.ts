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
} from '../protocol/types';
import {
  AnalystSimulationSchema,
  BuilderSimulationSchema,
  DispatchSchema,
  HandshakeSchema,
  ScoutSimulationSchema,
  formatZodError,
} from '../protocol/validate';
import { logError, logWarn } from '../utils/logger';
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

async function handleDispatchRequest(req: RawBodyRequest, res: Response): Promise<void> {
  const parsed = DispatchSchema.safeParse(req.body);
  if (!parsed.success) return void badRequest(res, formatZodError(parsed.error));

  const rawBody = req.rawBody ?? '';
  const providedSig = headerAsString(req.headers[SIGNATURE_HEADER]);

  if (config.edgearenaApiKey) {
    if (!providedSig || !verifySignature(rawBody, config.edgearenaApiKey, providedSig)) {
      res.status(401).json({
        error: 'Invalid or missing signature',
        code: 'invalid_signature',
      } satisfies ErrorResponse);
      return;
    }
  } else {
    logWarn('unverified_dispatch', {
      note: 'EDGEARENA_API_KEY not set — signature was not verified.',
      taskId: parsed.data.taskId,
    });
  }

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
    logError(event, { ...extra, reason: err.reason, message: err.message });
    if (!res.headersSent) {
      res.status(502).json({
        error: err.reason === 'llm_error'
          ? 'Upstream model call failed'
          : 'Agent produced an invalid response',
        code: err.reason,
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
