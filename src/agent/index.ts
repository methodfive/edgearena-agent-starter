/**
 * Your agent. This file is where task handling lives — a new developer
 * customizing the template should usually start here.
 *
 * Two entry points, matching the two payload shapes you receive. Both
 * forward the incoming `messages` array to your model and validate the
 * reply against the expected output schema:
 *
 *   handleDispatch(payload)  — live task in a run.
 *   handleSimulation(req)    — onboarding test during registration.
 *
 * There are no prompts defined in this repo. Every `messages` array is
 * built upstream and arrives ready to forward — so your agent tests and
 * runs against the exact same prompts the platform uses.
 *
 * Customization paths, in order of how much you'd need to change:
 *   1. `.env`        — swap model, provider, API key, timeouts.
 *   2. This file     — inject extra context into messages, route phases
 *                      to different models, add retries, replace the LLM
 *                      with a tool-using pipeline.
 *
 * Throw `AgentTaskError` to signal failure — the server turns it into an
 * HTTP 502 response.
 */

import type { ZodType } from 'zod';

import { config } from '../config/env';
import { LlmError, callChat, type ChatMessage } from '../llm/client';
import { parseAndValidate } from '../llm/json';
import type {
  BuilderOutput,
  CriticOutput,
  DispatchPayload,
  RoleOutput,
  ScoutOutput,
  SimulationMessage,
  SimulationRequest,
  VerifierOutput,
} from '../protocol/types';
import {
  BuilderOutputSchema,
  CriticOutputSchema,
  ScoutOutputSchema,
  VerifierOutputSchema,
} from '../protocol/validate';
import { logInfo } from '../utils/logger';

// ── Public types ────────────────────────────────────────────────────────────

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  modelId: string;
}

export interface AgentResult<T extends RoleOutput> {
  output: T;
  usage: Usage;
}

export interface HandlerOptions {
  /** Maximum time to wait for the model, in milliseconds. */
  timeoutMs: number;
  /** Optional correlation id threaded into logs (taskId from the request). */
  taskId?: string;
}

/** Which output schema to validate the model's reply against. */
type OutputKind = 'scout' | 'builder' | 'verifier' | 'critic';

/**
 * Thrown when you cannot produce a valid response — model error, timeout,
 * or reply that fails schema validation after repair. The server catches
 * this and returns HTTP 502.
 */
export class AgentTaskError extends Error {
  override readonly name = 'AgentTaskError';
  readonly reason: 'llm_error' | 'invalid_output';
  /** Raw model text that failed to parse/validate. Set on `invalid_output`
   *  failures so the caller (platform onboarding UI, run-time error logs)
   *  can show what the model actually produced. */
  readonly rawOutput?: string;
  constructor(reason: 'llm_error' | 'invalid_output', message: string, rawOutput?: string) {
    super(message);
    this.reason = reason;
    this.rawOutput = rawOutput;
  }
}

// ── Runtime dispatch: forward the incoming messages to the model ───────────

export async function handleDispatch(
  payload: DispatchPayload,
  opts: HandlerOptions,
): Promise<AgentResult<RoleOutput>> {
  const kind = outputKindForPhase(payload.phase);
  const messages = normalizeMessages(payload.messages);
  const result = await runLlm(messages, kind, opts);

  // The model sometimes omits, truncates, or invents the candidate id.
  // The caller expects the exact one they sent, so force it.
  if (kind !== 'scout' && 'candidate_id' in result.output) {
    (result.output as { candidate_id: string }).candidate_id =
      payload.candidateId ?? payload.taskId;
  }
  return result;
}

// ── Onboarding simulation: same code path, different request shape ─────────

export async function handleSimulation(
  req: SimulationRequest,
  opts: HandlerOptions,
): Promise<AgentResult<RoleOutput>> {
  const kind = outputKindForSimulation(req.type);
  const messages = normalizeMessages(req.messages);
  const result = await runLlm(messages, kind, opts);

  // Force the candidate id from the request so the response round-trips
  // even when the model truncates or hallucinates it.
  if (kind !== 'scout' && 'candidate_id' in result.output) {
    const candidateId =
      req.type === 'scout_task' ? req.task_id : req.candidate.id;
    (result.output as { candidate_id: string }).candidate_id = candidateId;
  }
  return result;
}

// ── Internals ──────────────────────────────────────────────────────────────

async function runLlm(
  messages: ChatMessage[],
  kind: OutputKind,
  opts: HandlerOptions,
): Promise<AgentResult<RoleOutput>> {
  let res;
  try {
    res = await callChat(config.llm, messages, {
      timeoutMs: opts.timeoutMs,
      taskId: opts.taskId,
    });
  } catch (err) {
    const msg = err instanceof LlmError ? err.message : (err as Error).message;
    throw new AgentTaskError('llm_error', msg);
  }

  const schema = schemaFor(kind);
  const parsed = parseAndValidate(res.text, schema);
  if (!parsed.ok) {
    throw new AgentTaskError(
      'invalid_output',
      `${kind} output failed validation: ${parsed.error}`,
      res.text,
    );
  }
  if (parsed.repaired) logInfo('output_repaired', { kind, taskId: opts.taskId });

  return { output: parsed.data, usage: res };
}

function schemaFor(kind: OutputKind): ZodType<RoleOutput> {
  switch (kind) {
    case 'scout':
      return ScoutOutputSchema as unknown as ZodType<ScoutOutput>;
    case 'builder':
      return BuilderOutputSchema as unknown as ZodType<BuilderOutput>;
    case 'verifier':
      return VerifierOutputSchema as unknown as ZodType<VerifierOutput>;
    case 'critic':
      return CriticOutputSchema as unknown as ZodType<CriticOutput>;
  }
}

/**
 * Map a live `phase` string to the output schema to validate against.
 *
 *   SCOUT    → scout candidate
 *   BUILD    → execution plan with claims
 *   VERIFY   → evidence + claim assessments
 *   CRITIQUE → strengths, weaknesses, verdict, score adjustments
 *
 * Unknown phases throw; the caller surfaces that as an HTTP 502.
 */
function outputKindForPhase(phase: string): OutputKind {
  switch (phase.toUpperCase()) {
    case 'SCOUT':
      return 'scout';
    case 'BUILD':
      return 'builder';
    case 'VERIFY':
      return 'verifier';
    case 'CRITIQUE':
      return 'critic';
    default:
      throw new AgentTaskError('invalid_output', `Unsupported phase: ${phase}`);
  }
}

/** Map a simulation `type` discriminator to the output schema. */
function outputKindForSimulation(type: SimulationRequest['type']): OutputKind {
  switch (type) {
    case 'scout_task':
      return 'scout';
    case 'build_task':
      return 'builder';
    case 'analyst_task':
      // Onboarding exercises the analyst role via the Critic path — that is
      // the response shape the registration schema check looks for.
      return 'critic';
  }
}

/**
 * Narrow the incoming messages to the role union the chat client expects.
 * Unknown role strings become 'user' — forward-compat for any new role
 * names that might get introduced.
 */
function normalizeMessages(
  raw: Array<{ role: string; content: string }> | SimulationMessage[],
): ChatMessage[] {
  return raw.map((m) => {
    const r = m.role.toLowerCase();
    const role: ChatMessage['role'] = r === 'system' || r === 'assistant' ? r : 'user';
    return { role, content: m.content };
  });
}
