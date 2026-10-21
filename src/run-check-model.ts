import { z } from 'zod'

// What the host serves about a run's check (tangle-tools discovery_workspace_parts): its rows, the calibration its verdicts
// name, a held pass, and each check dispute with who ruled it.
const time = z.iso.datetime({ offset: true })

/** One check or tag-gate row as the host reads it: when, on which tag and commit, under which checker, its verdict and line. */
const checkRowSchema = z
  .object({
    at: time.nullable().optional(),
    tag: z.string().nullable().optional(),
    commit: z.string().nullable().optional(),
    checker: z.string().nullable().optional(),
    verdict: z.string().nullable().optional(),
    line: z.string().nullable().optional(),
    score: z
      .object({ stage: z.string().nullable().optional(), reached: z.number().nullable().optional(), of: z.number().nullable().optional(), workloads: z.object({ passed: z.number().nullable(), total: z.number().nullable() }).nullable().optional() })
      .catchall(z.unknown())
      .nullable()
      .optional(),
  })
  .catchall(z.unknown())
/** A check stage's calibration (discovery-lab runner/calibration.mjs): a known-good fixture passed it, none did, it gave two answers, or no record says. */
const calibrationState = z.enum(['calibrated', 'uncalibrated', 'nondeterministic', 'unknown'])
export const runCheckSchema = z
  .object({
    latest: checkRowSchema.nullable(),
    best: checkRowSchema.nullable(),
    passes: z.array(z.object({ tag: z.string().nullable(), checker: z.string().nullable(), count: z.number(), firstAt: time, lastAt: time }).catchall(z.unknown())).optional(),
    gate: checkRowSchema.nullable().optional(),
    /** The newest unbroken run of tag-gate verdicts that could not decide (a prover past its time limit). */
    gateUnknown: z.object({ count: z.number(), from: time, to: time, line: z.string().nullable(), tags: z.array(z.string()).optional() }).catchall(z.unknown()).nullable().optional(),
    headline: z.string().nullable().optional(),
    counts: z.object({ checks: z.number(), known: z.number(), solved: z.number() }).partial().catchall(z.unknown()).nullable().optional(),
    /** The play's checkers as its page labels them (v1..vN with the ruling that made each), by digest prefix. */
    checkerNames: z.array(z.object({ sha256: z.string(), label: z.string().nullable().optional(), ruling: z.string().nullable().optional(), current: z.boolean().optional() }).catchall(z.unknown())).optional(),
    /**
     * The run's pass held for stages no known-good fixture passed (tangle-tools play_checks.check_summary `held`): the check
     * passed, but the pass is not the run's. Null while a pass stands or none was held.
     */
    held: checkRowSchema.extend({ stages: z.array(z.string()) }).nullable().optional(),
    /**
     * The calibration every verdict of the run names, as its check registered it at press (tangle-tools
     * play_checks.check_calibration): a state per stage and one for the check. `unknown` says which record would state it.
     */
    calibration: z
      .object({
        state: calibrationState,
        stages: z.array(z.object({ name: z.string().nullable(), state: calibrationState }).catchall(z.unknown())),
        source: z.string().nullable().optional(),
        unknown: z.string().nullable().optional(),
      })
      .catchall(z.unknown())
      .nullable()
      .optional(),
  })
  .catchall(z.unknown())
export type RunCheck = z.infer<typeof runCheckSchema>

/** One check dispute the run committed and its ruling (discovery-lab `runner/check-dispute.mjs`, tangle-tools progress.outcome_disputes). */
export const checkDisputeSchema = z
  .object({
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
  .catchall(z.unknown())
