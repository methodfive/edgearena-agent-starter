/**
 * Zod schemas for every shape on the wire.
 *
 * Two groups:
 *   - Input schemas validate requests your server receives.
 *   - Output schemas validate what your model produces before you send it.
 *
 * All schemas use `.passthrough()` so unknown fields — future additions to
 * the protocol, or richer content your model volunteers — are not rejected.
 */

import { z } from 'zod';

// ── Input schemas ───────────────────────────────────────────────────────────

const MessageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

export const HandshakeSchema = z
  .object({
    type: z.literal('handshake'),
    protocol: z.string(),
    request_id: z.string().optional(),
  })
  .passthrough();

export const ScoutSimulationSchema = z
  .object({
    type: z.literal('scout_task'),
    protocol: z.string(),
    task_id: z.string(),
    role: z.literal('SCOUT'),
    deadline_ms: z.number(),
    goal: z.string(),
    launchpad: z.string(),
    messages: z.array(MessageSchema).min(1),
  })
  .passthrough();

export const BuilderSimulationSchema = z
  .object({
    type: z.literal('build_task'),
    protocol: z.string(),
    task_id: z.string(),
    role: z.literal('BUILDER'),
    deadline_ms: z.number(),
    candidate: z
      .object({
        id: z.string(),
        title: z.string(),
        target_customer: z.string(),
        core_problem: z.string(),
        solution_summary: z.string(),
      })
      .passthrough(),
    messages: z.array(MessageSchema).min(1),
  })
  .passthrough();

export const AnalystSimulationSchema = z
  .object({
    type: z.literal('analyst_task'),
    protocol: z.string(),
    task_id: z.string(),
    role: z.literal('ANALYST'),
    deadline_ms: z.number(),
    candidate: z
      .object({
        id: z.string(),
        title: z.string(),
        solution_summary: z.string(),
      })
      .passthrough(),
    messages: z.array(MessageSchema).min(1),
  })
  .passthrough();

export const DispatchSchema = z
  .object({
    taskId: z.string().min(1),
    runId: z.string().min(1),
    phase: z.string().min(1),
    role: z.string().min(1),
    candidateId: z.string().nullable(),
    goal: z.string(),
    launchpadName: z.string(),
    messages: z.array(MessageSchema),
  })
  .passthrough();

// ── Output schemas ──────────────────────────────────────────────────────────
// Validating your model's output before returning it catches the common
// failure mode of a model that "almost" produced the right shape. If the
// check fails you throw; if it passes you can be confident about what you
// are sending on the wire.

const ClaimSchema = z
  .object({
    type: z.string().min(1),
    text: z.string().min(1),
  })
  .passthrough();

const EvidenceSchema = z
  .object({
    kind: z.string().min(1),
    summary: z.string().min(1),
  })
  .passthrough();

export const ScoutOutputSchema = z
  .object({
    candidate_title: z.string().min(1),
    target_customer: z.string().min(1),
    core_problem: z.string().min(1),
    proposed_solution: z.string().min(1),
    why_now: z.string().min(1),
    claims: z.array(ClaimSchema),
    evidence: z.array(EvidenceSchema),
  })
  .passthrough();

const ExecutionPhaseSchema = z.union([
  z.string().min(1),
  z
    .object({
      title: z.string().optional(),
      objective: z.string().optional(),
      steps: z.array(z.string()).optional(),
      outcome: z.string().optional(),
      reality_check: z.string().optional(),
      operator_guidance: z.string().optional(),
    })
    .passthrough(),
]);

export const BuilderOutputSchema = z
  .object({
    candidate_id: z.string().min(1),
    execution: z
      .object({
        objective: z.string().min(1),
        phases: z.array(ExecutionPhaseSchema).min(1),
        first_milestone: z.string().min(1),
        success_check: z.string().min(1),
      })
      .passthrough(),
    claims: z.array(ClaimSchema).min(1),
  })
  .passthrough();

const EvidenceAssessmentSchema = z
  .object({
    kind: z.string().min(1),
    summary: z.string().min(1),
    reliability: z.enum(['high', 'medium', 'low']),
    specificity: z.enum(['high', 'medium', 'low']),
    note: z.string().optional(),
  })
  .passthrough();

const ClaimAssessmentSchema = z
  .object({
    type: z.string().min(1),
    text: z.string().min(1),
    supported: z.boolean(),
    confidence: z.enum(['high', 'medium', 'low']),
    note: z.string().optional(),
  })
  .passthrough();

export const VerifierOutputSchema = z
  .object({
    candidate_id: z.string().min(1),
    evidence_assessments: z.array(EvidenceAssessmentSchema),
    claim_assessments: z.array(ClaimAssessmentSchema),
    evidence_quality_score: z.number().min(0).max(100),
    claim_coverage_score: z.number().min(0).max(100),
    overall_confidence: z.enum(['high', 'medium', 'low']),
    red_flags: z.array(z.string()),
  })
  .passthrough();

export const CriticOutputSchema = z
  .object({
    candidate_id: z.string().min(1),
    strengths: z.array(z.string().min(1)).min(1),
    weaknesses: z.array(z.string().min(1)).min(1),
    score_adjustments: z.record(z.string(), z.number()),
    penalty_points: z.number(),
    verdict: z.enum(['pass', 'eliminate']),
    fatal_flaw: z.boolean(),
    elimination_reason: z.string().optional(),
  })
  .passthrough();

// ── Error formatting ────────────────────────────────────────────────────────

/** Compress a zod failure into a single line suitable for an error body. */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}
