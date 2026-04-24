/**
 * Schema tests. These are the wire contract — if they drift, every agent
 * running against this template drifts with them. Keep them strict.
 */

import {
  AnalystSimulationSchema,
  BuilderOutputSchema,
  BuilderSimulationSchema,
  CriticOutputSchema,
  DispatchSchema,
  HandshakeSchema,
  ScoutOutputSchema,
  ScoutSimulationSchema,
  VerifierOutputSchema,
} from './validate';

// ── Fixtures ────────────────────────────────────────────────────────────────

const validMessages = [
  { role: 'system', content: 'you are a scout' },
  { role: 'user', content: 'go' },
];

const validScoutSim = {
  type: 'scout_task',
  protocol: 'edgearena-v1',
  task_id: 't-1',
  role: 'SCOUT',
  deadline_ms: 8000,
  goal: 'Find a niche',
  launchpad: 'make-money',
  messages: validMessages,
};

const validBuilderSim = {
  type: 'build_task',
  protocol: 'edgearena-v1',
  task_id: 't-1',
  role: 'BUILDER',
  deadline_ms: 8000,
  candidate: {
    id: 'c-1',
    title: 'x',
    target_customer: 'y',
    core_problem: 'z',
    solution_summary: 'w',
  },
  messages: validMessages,
};

const validAnalystSim = {
  type: 'analyst_task',
  protocol: 'edgearena-v1',
  task_id: 't-1',
  role: 'ANALYST',
  deadline_ms: 8000,
  candidate: { id: 'c-1', title: 'x', solution_summary: 'w' },
  messages: validMessages,
};

const validDispatch = {
  taskId: 't-1',
  runId: 'r-1',
  phase: 'SCOUT',
  role: 'SCOUT',
  candidateId: null,
  goal: 'g',
  launchpadName: 'make-money',
  messages: validMessages,
};

const validScoutOutput = {
  candidate_title: 'A',
  target_customer: 'B',
  core_problem: 'C',
  proposed_solution: 'D',
  why_now: 'E',
  claims: [{ type: 'demand', text: 'people want this' }],
  evidence: [{ kind: 'market', summary: 'signals' }],
};

const validBuilderOutput = {
  candidate_id: 'c-1',
  execution: {
    objective: 'ship',
    phases: ['phase 1'],
    first_milestone: 'one user',
    success_check: 'five users',
  },
  claims: [{ type: 'feasibility', text: 'buildable' }],
};

const validVerifierOutput = {
  candidate_id: 'c-1',
  evidence_assessments: [
    { kind: 'market', summary: 'threads', reliability: 'medium', specificity: 'medium' },
  ],
  claim_assessments: [
    { type: 'feasibility', text: 'stack works', supported: true, confidence: 'high' },
  ],
  evidence_quality_score: 65,
  claim_coverage_score: 70,
  overall_confidence: 'medium',
  red_flags: [],
};

const validCriticOutput = {
  candidate_id: 'c-1',
  strengths: ['clear'],
  weaknesses: ['risky'],
  score_adjustments: { novelty_delta: -5 },
  penalty_points: 3,
  verdict: 'pass',
  fatal_flaw: false,
};

// ── Input schemas ──────────────────────────────────────────────────────────

describe('HandshakeSchema', () => {
  test('accepts minimal valid handshake', () => {
    expect(
      HandshakeSchema.safeParse({ type: 'handshake', protocol: 'edgearena-v1' }).success,
    ).toBe(true);
  });

  test('rejects wrong type', () => {
    const r = HandshakeSchema.safeParse({ type: 'other', protocol: 'edgearena-v1' });
    expect(r.success).toBe(false);
  });
});

describe('ScoutSimulationSchema', () => {
  test('accepts valid payload', () => {
    expect(ScoutSimulationSchema.safeParse(validScoutSim).success).toBe(true);
  });

  test('rejects when messages is missing', () => {
    const { messages: _drop, ...rest } = validScoutSim;
    expect(ScoutSimulationSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects when messages is empty', () => {
    expect(ScoutSimulationSchema.safeParse({ ...validScoutSim, messages: [] }).success).toBe(false);
  });

  test('rejects wrong role literal', () => {
    expect(
      ScoutSimulationSchema.safeParse({ ...validScoutSim, role: 'BUILDER' }).success,
    ).toBe(false);
  });

  test('passthrough keeps unknown fields', () => {
    const r = ScoutSimulationSchema.safeParse({ ...validScoutSim, future_field: 'ok' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).future_field).toBe('ok');
    }
  });
});

describe('BuilderSimulationSchema', () => {
  test('accepts valid payload', () => {
    expect(BuilderSimulationSchema.safeParse(validBuilderSim).success).toBe(true);
  });

  test('rejects when candidate is missing', () => {
    const { candidate: _drop, ...rest } = validBuilderSim;
    expect(BuilderSimulationSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects when messages is missing', () => {
    const { messages: _drop, ...rest } = validBuilderSim;
    expect(BuilderSimulationSchema.safeParse(rest).success).toBe(false);
  });
});

describe('AnalystSimulationSchema', () => {
  test('accepts valid payload', () => {
    expect(AnalystSimulationSchema.safeParse(validAnalystSim).success).toBe(true);
  });

  test('rejects when messages is missing', () => {
    const { messages: _drop, ...rest } = validAnalystSim;
    expect(AnalystSimulationSchema.safeParse(rest).success).toBe(false);
  });
});

describe('DispatchSchema', () => {
  test('accepts valid dispatch', () => {
    expect(DispatchSchema.safeParse(validDispatch).success).toBe(true);
  });

  test('accepts null candidateId', () => {
    expect(
      DispatchSchema.safeParse({ ...validDispatch, candidateId: null }).success,
    ).toBe(true);
  });

  test('accepts string candidateId', () => {
    expect(
      DispatchSchema.safeParse({ ...validDispatch, candidateId: 'c-1' }).success,
    ).toBe(true);
  });

  test('rejects when taskId missing', () => {
    const { taskId: _drop, ...rest } = validDispatch;
    expect(DispatchSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects when messages missing', () => {
    const { messages: _drop, ...rest } = validDispatch;
    expect(DispatchSchema.safeParse(rest).success).toBe(false);
  });

  test('accepts empty messages array (model may not need history)', () => {
    expect(DispatchSchema.safeParse({ ...validDispatch, messages: [] }).success).toBe(true);
  });
});

// ── Output schemas ─────────────────────────────────────────────────────────

describe('ScoutOutputSchema', () => {
  test('accepts full valid output', () => {
    expect(ScoutOutputSchema.safeParse(validScoutOutput).success).toBe(true);
  });

  test('rejects when why_now is missing (not just the wizard subset)', () => {
    const { why_now: _drop, ...rest } = validScoutOutput;
    expect(ScoutOutputSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects when claims is missing', () => {
    const { claims: _drop, ...rest } = validScoutOutput;
    expect(ScoutOutputSchema.safeParse(rest).success).toBe(false);
  });

  test('allows extra fields (passthrough)', () => {
    const r = ScoutOutputSchema.safeParse({ ...validScoutOutput, bonus: 'ok' });
    expect(r.success).toBe(true);
  });
});

describe('BuilderOutputSchema', () => {
  test('accepts valid output with string phases', () => {
    expect(BuilderOutputSchema.safeParse(validBuilderOutput).success).toBe(true);
  });

  test('accepts object phases', () => {
    const output = {
      ...validBuilderOutput,
      execution: {
        ...validBuilderOutput.execution,
        phases: [
          { title: 'Week 1', objective: 'build', steps: ['a'], outcome: 'x', reality_check: 'y', operator_guidance: 'z' },
        ],
      },
    };
    expect(BuilderOutputSchema.safeParse(output).success).toBe(true);
  });

  test('rejects empty phases', () => {
    const output = {
      ...validBuilderOutput,
      execution: { ...validBuilderOutput.execution, phases: [] },
    };
    expect(BuilderOutputSchema.safeParse(output).success).toBe(false);
  });

  test('rejects missing execution.objective', () => {
    const output = {
      ...validBuilderOutput,
      execution: { ...validBuilderOutput.execution, objective: undefined },
    };
    expect(BuilderOutputSchema.safeParse(output).success).toBe(false);
  });

  test('allows launchpad-specific extras via passthrough', () => {
    const r = BuilderOutputSchema.safeParse({
      ...validBuilderOutput,
      positioning: { one_liner: 'x' },
      offer: { pricing: { monthly: 99 } },
    });
    expect(r.success).toBe(true);
  });
});

describe('VerifierOutputSchema', () => {
  test('accepts valid output', () => {
    expect(VerifierOutputSchema.safeParse(validVerifierOutput).success).toBe(true);
  });

  test('rejects invalid reliability enum', () => {
    const output = {
      ...validVerifierOutput,
      evidence_assessments: [
        { ...validVerifierOutput.evidence_assessments[0], reliability: 'unknown' },
      ],
    };
    expect(VerifierOutputSchema.safeParse(output).success).toBe(false);
  });

  test('rejects score out of range', () => {
    expect(
      VerifierOutputSchema.safeParse({ ...validVerifierOutput, evidence_quality_score: 150 }).success,
    ).toBe(false);
  });

  test('allows empty red_flags', () => {
    expect(VerifierOutputSchema.safeParse({ ...validVerifierOutput, red_flags: [] }).success).toBe(true);
  });
});

describe('CriticOutputSchema', () => {
  test('accepts valid output', () => {
    expect(CriticOutputSchema.safeParse(validCriticOutput).success).toBe(true);
  });

  test('rejects invalid verdict', () => {
    expect(
      CriticOutputSchema.safeParse({ ...validCriticOutput, verdict: 'maybe' }).success,
    ).toBe(false);
  });

  test('rejects when fatal_flaw is not boolean', () => {
    expect(
      CriticOutputSchema.safeParse({ ...validCriticOutput, fatal_flaw: 'no' }).success,
    ).toBe(false);
  });

  test('allows launchpad risk fields via passthrough', () => {
    expect(
      CriticOutputSchema.safeParse({
        ...validCriticOutput,
        market_risk: 'low',
        execution_risk: 'medium',
      }).success,
    ).toBe(true);
  });

  test('accepts elimination_reason when verdict is eliminate', () => {
    expect(
      CriticOutputSchema.safeParse({
        ...validCriticOutput,
        verdict: 'eliminate',
        fatal_flaw: true,
        elimination_reason: 'fabricated evidence',
      }).success,
    ).toBe(true);
  });
});
