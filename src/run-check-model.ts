import { z } from 'zod'

// What the host serves about a run's check (tangle-tools discovery_workspace_parts): its rows, the calibration its verdicts
// name, a held pass, and each check dispute with who ruled it.
const time = z.iso.datetime({ offset: true })
const explicitReference = z.string().regex(/\S/)
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const contentDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const exactCommit = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/)
const evidencePath = z.string().max(512).regex(/^(?!.*(?:^|\/)(?:\.{1,2}|\.git|\.sidecar)(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

/**
 * Public projection of a native check's bindings (discovery-lab `checkRunFields`). These references attribute an
 * evaluation; they do not establish correctness, timing quality, or a successful result. Missing fields stay null.
 * Only digests, bounded identities and declared output metadata are public. Input manifests, replay seeds, output
 * contents, artifact locators and custody locations never belong in this block.
 */
export const checkEvidenceSchema = z.strictObject({
    contentHash: contentDigest.nullable(),
    checkerSha256: sha256.nullable(),
    /** The Lab's recorded input snapshot (which may be the candidate tree), not an inferred dataset identity. */
    inputs: z.strictObject({ sha256: sha256.nullable(), count: count.nullable() }).nullable(),
    execution: z.strictObject({
      backend: z.literal('sandbox').nullable(),
      repositoryCommit: exactCommit.nullable(),
      inputDigest: contentDigest.nullable(),
    }).nullable(),
    outputs: z.strictObject({
      executionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/).nullable(),
      inputDigest: contentDigest.nullable(),
      /** Runtime's retention status, independent of the check verdict. */
      status: z.enum(['retained', 'incomplete']).nullable(),
      files: z.array(z.strictObject({
        path: evidencePath.nullable(),
        /** The existing AgentCandidateArtifactRef's content identity; private locators are omitted. */
        artifact: z.strictObject({ sha256: contentDigest.nullable(), byteLength: count.nullable() }).nullable(),
        /** Only an already-listed same-run source has a link; private CAS references have none. */
        href: z.string().regex(/^\/api\/discovery\/runs\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}\/source\/[0-9a-f]{64}$/).nullable(),
      })).max(16).nullable(),
      missing: z.array(z.strictObject({
        path: evidencePath.nullable(),
        reason: z.enum(['missing', 'unsafe-path', 'size-limit', 'capture-failed', 'store-failed', 'timeout']).nullable(),
      })).max(16).nullable(),
      /** Entries omitted by the bounded projection; null if either native list is absent or malformed. */
      omitted: count.nullable(),
    }).nullable(),
  })
export type CheckEvidence = z.infer<typeof checkEvidenceSchema>

/** One check or tag-gate row as the host reads it: when, on which tag and commit, under which checker, its verdict and line. */
const checkRowSchema = z.looseObject({
    at: time.nullable().optional(),
    tag: z.string().nullable().optional(),
    commit: z.string().nullable().optional(),
    checker: z.string().nullable().optional(),
    verdict: z.string().nullable().optional(),
    line: z.string().nullable().optional(),
    evidence: checkEvidenceSchema.nullable().optional(),
    score: z.looseObject({ stage: z.string().nullable().optional(), reached: z.number().nullable().optional(), of: z.number().nullable().optional(), workloads: z.object({ passed: z.number().nullable(), total: z.number().nullable() }).nullish() }).nullish(),
  })
/** A check stage's calibration (discovery-lab runner/calibration.mjs): a known-good fixture passed it, none did, it gave two answers, or no record says. */
export const calibrationState = z.enum(['calibrated', 'uncalibrated', 'nondeterministic', 'unknown'])
/**
 * The calibration a check registered at press, a state per stage and one for the check (tangle-tools
 * play_checks.check_calibration). `unknown` says which record would state it. The run page and the play page's run groups
 * serve the same shape.
 */
export const calibrationSchema = z.looseObject({
    state: calibrationState,
    stages: z.array(z.object({ name: z.string().nullable(), state: calibrationState }).catchall(z.unknown())),
    source: z.string().nullable().optional(),
    unknown: z.string().nullable().optional(),
    at: z.string().nullish(),
    check: z.string().nullish(),
    fixtures: z.string().nullish(),
    authorFamily: z.string().nullish(),
  })
export type Calibration = z.infer<typeof calibrationSchema>
/** Native definition/amendment references; writers bind identity and allowlist metadata. */
const checkProvenanceSchema = z.looseObject({
      source: z.object({ repository: z.string().min(1), commit: z.string().min(1), path: z.string().min(1) }).catchall(z.unknown()).nullish(),
      checkSource: z.string().nullish(),
      definedBy: z.object({ id: explicitReference, evidence: explicitReference }).catchall(z.unknown()).nullish(),
      anchors: z.object({
        digest: z.string().nullish(),
        anchors: z.array(z.object({ id: z.string(), kind: z.string(), stages: z.array(z.string()).nullish() }).catchall(z.unknown())).nullish(),
        hidden: z.array(z.string()).nullish(),
      }).catchall(z.unknown()).nullish(),
      tagGate: z.string().nullish(),
      evidence: z.string().nullish(),
    })
export const runCheckSchema = z.looseObject({
    latest: checkRowSchema.nullable(),
    best: checkRowSchema.nullable(),
    passes: z.array(z.object({ tag: z.string().nullable(), checker: z.string().nullable(), count: z.number(), firstAt: time, lastAt: time }).catchall(z.unknown())).optional(),
    gate: checkRowSchema.nullable().optional(),
    /** The newest unbroken run of tag-gate verdicts that could not decide (a prover past its time limit). */
    gateUnknown: z.object({ count: z.number(), from: time, to: time, line: z.string().nullable(), tags: z.array(z.string()).optional() }).catchall(z.unknown()).nullable().optional(),
    headline: z.string().nullable().optional(),
    counts: z.object({ checks: z.number(), known: z.number(), solved: z.number() }).partial().catchall(z.unknown()).nullable().optional(),
    /** The play's checkers as its page labels them (v1..vN with the ruling that made each), by digest prefix. */
    checkerNames: z.array(z.object({ sha256: z.string(), label: z.string().nullable().optional(), ruling: z.string().nullable().optional(), current: z.boolean().optional(), provenance: checkProvenanceSchema.nullish(), calibration: calibrationSchema.partial().nullish() }).catchall(z.unknown())).optional(),
    /**
     * The run's pass held for stages no known-good fixture passed (tangle-tools play_checks.check_summary `held`): the check
     * passed, but the pass is not the run's. Null while a pass stands or none was held.
     */
    held: checkRowSchema.extend({ stages: z.array(z.string()) }).nullable().optional(),
    /** The calibration every verdict of the run names, as its check registered it at press. */
    calibration: calibrationSchema.nullable().optional(),
    provenance: checkProvenanceSchema.nullish(),
  })
export type RunCheck = z.infer<typeof runCheckSchema>

/** One check dispute the run committed and its ruling (discovery-lab `runner/check-dispute.mjs`, tangle-tools progress.outcome_disputes). */
export const checkDisputeSchema = z.looseObject({
    id: z.string().nullable(),
    at: time.nullable(),
    line: z.string().nullable(),
    /** `undecided` (discovery-lab #2224): the referees disagree, the check stays as pinned and an operator rules. */
    state: z.enum(['open', 'operator', 'upheld', 'rejected', 'undecided']).nullable(),
    ruledAt: time.nullable(),
    by: z.enum(['referee', 'operator']).nullable(),
    attempts: z.number().int().nonnegative().nullable(),
    /** Who ruled: each referee of the ruling or newest panel in recorded order; a dispute written before #2224 has none. */
    referees: z
      .array(z.object({ seat: z.string().nullable(), family: z.string().nullable(), verdict: z.enum(['upheld', 'rejected', 'undecided']).nullable() }).catchall(z.unknown()))
      .optional(),
  })
