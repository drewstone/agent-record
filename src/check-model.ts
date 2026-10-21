/**
 * A run's play check as the host serves it (tangle-tools discovery_workspace_parts/play_checks.py and progress.py): each
 * check row, the run's check summary with its calibration and held pass, and a dispute's referees.
 */
import { z } from 'zod'

const time = z.iso.datetime({ offset: true })

/** One check or tag-gate row as the host reads it: when, on which tag and commit, under which checker, its verdict and line. */
export const checkRowSchema = z
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
/**
 * A check's calibration as the host reads it from `run-input.json acceptance.play.calibration` (tangle-tools
 * check_calibration): a state per stage and one for the check. `unknown` carries the sentence naming the record that would
 * state it; it is never read as calibrated.
 */
export const calibrationStateSchema = z.enum(['calibrated', 'uncalibrated', 'nondeterministic', 'unknown'])
export const checkCalibrationSchema = z
  .object({
    state: calibrationStateSchema,
    stages: z.array(z.object({ name: z.string().nullable(), state: calibrationStateSchema }).catchall(z.unknown())),
    uncalibrated: z.array(z.string()).optional(),
    deterministic: z.boolean().nullable().optional(),
    at: time.nullable().optional(),
    source: z.string().nullable().optional(),
    unknown: z.string().nullable().optional(),
  })
  .catchall(z.unknown())
export type CheckCalibration = z.infer<typeof checkCalibrationSchema>
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
    /** The calibration every verdict of the run names; null for a run with no check. */
    calibration: checkCalibrationSchema.nullable().optional(),
    /** The run's pass held for its uncalibrated stages, with the host's label for it. */
    held: checkRowSchema.extend({ stages: z.array(z.string()), label: z.string() }).nullable().optional(),
  })
  .catchall(z.unknown())
export type RunCheck = z.infer<typeof runCheckSchema>

/** A check's dense score: the stage it reached of how many, its public workloads, and the Lab's 0–1 value. */
export const checkScoreSchema = z
  .object({
    stage: z.string().nullable().optional(),
    reached: z.number().nullable().optional(),
    of: z.number().nullable().optional(),
    workloads: z.object({ passed: z.number(), total: z.number() }).nullable().optional(),
    value: z.number().nullable().optional(),
  })
  .catchall(z.unknown())
/** One check or tag-gate line: when, on which tag, its first failing line, its verdict and score. */
export const checkLineSchema = z
  .object({
    at: z.string().nullable().optional(),
    tag: z.string().nullable().optional(),
    line: z.string().nullable().optional(),
    stage: z.string().nullable().optional(),
    solved: z.boolean().nullable().optional(),
    verdict: z.string().nullable().optional(),
    score: checkScoreSchema.nullable().optional(),
    /** The check passed through stages no known-good fixture has passed (discovery-lab calibration part 2): held, never SOLVED. */
    uncalibratedPass: z.boolean().optional(),
  })
  .catchall(z.unknown())

/** One referee of a check dispute: its seat, model family and verdict (null when it wrote no ruling; it can rule undecided). */
export const disputeRefereeSchema = z
  .object({ seat: z.string().nullable(), family: z.string().nullable(), verdict: z.enum(['upheld', 'rejected', 'undecided']).nullable() })
  .catchall(z.unknown())
