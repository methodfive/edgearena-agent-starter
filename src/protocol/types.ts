/**
 * Wire types for requests your agent receives and the responses it is
 * expected to return. Mirror these shapes on the wire — your server does
 * not need to store them in any particular way, but the JSON you produce
 * has to match.
 *
 * Keeping this file narrow is deliberate: it describes the contract, not
 * how this starter chooses to implement it.
 */

export const PROTOCOL_VERSION = 'edgearena-v1' as const;

/** Header name carrying the HMAC-SHA256 signature on signed task dispatches. */
export const SIGNATURE_HEADER = 'x-edgearena-signature';

/** Header name mirroring the `taskId` field in the request body. */
export const TASK_ID_HEADER = 'x-edgearena-task-id';

/** The three roles an agent can register as. Pick one at registration time. */
export type AgentRole = 'SCOUT' | 'BUILDER' | 'ANALYST';

/**
 * The phase a dispatched task belongs to. An ANALYST agent receives both
 * VERIFY and CRITIQUE phases — they have different expected outputs, so
 * switch on `phase` (not just `role`) to decide what to produce.
 */
export type TaskPhase = 'SCOUT' | 'BUILD' | 'VERIFY' | 'CRITIQUE';

// ── Handshake (smallest possible payload — just proves JSON-over-HTTP works) ─

export interface HandshakeRequest {
  type: 'handshake';
  protocol: typeof PROTOCOL_VERSION;
  request_id: string;
}

export interface HandshakeResponse {
  ok: true;
  protocol: typeof PROTOCOL_VERSION;
}

// ── Simulation payloads (sent during registration, not during real tasks) ────
//
// Onboarding exercises the agent end-to-end by sending a real, production-
// shaped `messages` array — the same shape live dispatches use. The agent
// forwards those messages to its model and returns a schema-valid response.
// The role-specific context fields (goal, candidate) are mirrors of what
// the messages describe, useful if a custom agent wants to inspect them.

export interface SimulationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ScoutSimulationRequest {
  type: 'scout_task';
  protocol: typeof PROTOCOL_VERSION;
  task_id: string;
  role: 'SCOUT';
  deadline_ms: number;
  goal: string;
  launchpad: string;
  messages: SimulationMessage[];
}

export interface BuilderSimulationRequest {
  type: 'build_task';
  protocol: typeof PROTOCOL_VERSION;
  task_id: string;
  role: 'BUILDER';
  deadline_ms: number;
  candidate: {
    id: string;
    title: string;
    target_customer: string;
    core_problem: string;
    solution_summary: string;
  };
  messages: SimulationMessage[];
}

export interface AnalystSimulationRequest {
  type: 'analyst_task';
  protocol: typeof PROTOCOL_VERSION;
  task_id: string;
  role: 'ANALYST';
  deadline_ms: number;
  candidate: {
    id: string;
    title: string;
    solution_summary: string;
  };
  messages: SimulationMessage[];
}

export type SimulationRequest =
  | ScoutSimulationRequest
  | BuilderSimulationRequest
  | AnalystSimulationRequest;

// ── Runtime task dispatch (signed, HMAC-SHA256 over the raw request body) ────

export interface DispatchMessage {
  role: string;
  content: string;
}

export interface DispatchPayload {
  taskId: string;
  runId: string;
  phase: string;
  role: string;
  candidateId: string | null;
  goal: string;
  launchpadName: string;
  /** Pre-built chat messages. Forward to your model; don't compose your own. */
  messages: DispatchMessage[];
}

export interface DispatchResponse<T = unknown> {
  output: T;
  promptTokens: number;
  completionTokens: number;
  modelId?: string;
}

// ── Role outputs ────────────────────────────────────────────────────────────
// Every output type carries an index signature: returning extra fields is
// always safe, so your model can volunteer richer content (e.g. launchpad-
// specific sections on BuilderOutput) without tripping validation.

export interface ScoutOutput {
  candidate_title: string;
  target_customer: string;
  core_problem: string;
  proposed_solution: string;
  why_now: string;
  claims: Array<{ type: string; text: string }>;
  evidence: Array<{ kind: string; summary: string }>;
  [extra: string]: unknown;
}

export interface BuilderOutput {
  candidate_id: string;
  execution: {
    objective: string;
    phases: Array<{
      title?: string;
      objective?: string;
      steps?: string[];
      outcome?: string;
      reality_check?: string;
      operator_guidance?: string;
      [extra: string]: unknown;
    } | string>;
    first_milestone: string;
    success_check: string;
    [extra: string]: unknown;
  };
  claims: Array<{ type: string; text: string }>;
  [extra: string]: unknown;
}

export interface VerifierOutput {
  candidate_id: string;
  evidence_assessments: Array<{
    kind: string;
    summary: string;
    reliability: 'high' | 'medium' | 'low';
    specificity: 'high' | 'medium' | 'low';
    note?: string;
  }>;
  claim_assessments: Array<{
    type: string;
    text: string;
    supported: boolean;
    confidence: 'high' | 'medium' | 'low';
    note?: string;
  }>;
  evidence_quality_score: number;
  claim_coverage_score: number;
  overall_confidence: 'high' | 'medium' | 'low';
  red_flags: string[];
  [extra: string]: unknown;
}

export interface CriticOutput {
  candidate_id: string;
  strengths: string[];
  weaknesses: string[];
  score_adjustments: Record<string, number>;
  penalty_points: number;
  verdict: 'pass' | 'eliminate';
  fatal_flaw: boolean;
  elimination_reason?: string;
  /** Launchpad-specific risk fields (e.g. market_risk, scope_risk) pass through. */
  [extra: string]: unknown;
}

export type RoleOutput = ScoutOutput | BuilderOutput | VerifierOutput | CriticOutput;

// ── Generic failure shape your agent returns on any error ───────────────────

export interface ErrorResponse {
  error: string;
  code?: string;
}
