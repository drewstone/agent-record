import { z } from 'zod'

/**
 * Trace assessments: labels on a recorded run, each pinned to the record digest and the event ids it cites.
 * A label without a cited event is unresolved. Missing evidence is never clean.
 */
const time = z.iso.datetime({ offset: true })
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
export const polarities = ['good', 'bad', 'neutral', 'unknown'] as const
const polarity = z.enum(polarities)

export const dimensionSchema = z
  .object({
    id: z.string().regex(/^[A-Z]\d+$/),
    key: z.string(),
    group: z.string(),
    headline: z.boolean(),
    unit: z.enum(['run', 'node', 'span', 'claim']),
    question: z.string(),
    decider: z.enum(['rule', 'rule+judge', 'judge']),
    scale: z
      .array(z.object({ label: z.string(), polarity, meaning: z.string() }).catchall(z.unknown()))
      .refine((scale) => scale.some((item) => item.label === 'unresolvable'), 'Every scale includes unresolvable'),
    version: z.union([z.string(), z.number()]),
  })
  .catchall(z.unknown())

export const dimensionsDocumentSchema = z
  .object({
    schema: z.literal('agent-trace-dimensions.v1'),
    version: z.union([z.string(), z.number()]),
    groups: z.array(z.object({ id: z.string(), name: z.string() }).catchall(z.unknown())),
    dimensions: z.array(dimensionSchema),
  })
  .catchall(z.unknown())

const citation = z
  .object({
    eventId: z.string(),
    source: z
      .object({
        path: z.string(),
        sha256: z.string(),
        line: z.number().int().positive().optional(),
        pointer: z.string().optional(),
      })
      .catchall(z.unknown())
      .nullable(),
    quote: z.string().nullable(),
  })
  .catchall(z.unknown())

export const assessmentRowSchema = z
  .object({
    schema: z.literal('agent-trace-assessment.v1'),
    id: z.string(),
    runId: z.string(),
    recordDigest: sha256,
    classifierVersion: z.string(),
    dimension: z.string(),
    dimensionVersion: z.union([z.string(), z.number()]),
    unit: z.enum(['run', 'node', 'span', 'claim']),
    subject: z.object({ nodeId: z.string().nullable(), eventIds: z.array(z.string()) }),
    label: z.string(),
    /** System One only. Uncalibrated distributions never set a cell's colour. */
    probabilities: z.record(z.string(), z.number()).nullable(),
    measure: z
      .object({
        count: z.number().optional(),
        /** Null when the time was not measured (calls recorded without their results). */
        ms: z.number().nullable().optional(),
        tokens: z.number().optional(),
        listUsd: z.number().optional(),
        /** The wall-clock spans [start, end] in epoch ms the finding covers, so overlapping findings count once. */
        intervals: z.array(z.tuple([z.number(), z.number()])).optional(),
      })
      .catchall(z.unknown())
      .nullable(),
    /** The store reports a row whose recordDigest differs from the current record as stale. */
    status: z.enum(['decided', 'unresolved', 'stale']),
    reason: z.string().nullable(),
    method: z.enum(['rule', 'systemone', 'judge', 'human']),
    decider: z
      .object({
        ruleId: z.string().optional(),
        model: z.string().optional(),
        harness: z.string().optional(),
        account: z.string().optional(),
        version: z.union([z.string(), z.number()]),
        calibrated: z.boolean().nullable(),
        idempotencyKey: z.string().optional(),
        generationId: z.string().optional(),
        costUsd: z.number().nullable(),
        tokens: z.object({ input: z.number(), output: z.number() }).nullable(),
      })
      .catchall(z.unknown()),
    evidence: z.array(citation),
    at: time,
  })
  .catchall(z.unknown())
  .superRefine((row, ctx) => {
    if (row.status === 'decided' && !row.evidence.length)
      ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'A decided row cites at least one event' })
  })

export const assessmentsDocumentSchema = z
  .object({
    schema: z.literal('agent-trace-assessments.v1'),
    runId: z.string(),
    recordDigest: sha256.nullable(),
    rows: z.array(assessmentRowSchema),
  })
  .catchall(z.unknown())

export type Dimension = z.infer<typeof dimensionSchema>
export type DimensionsDocument = z.infer<typeof dimensionsDocumentSchema>
export type AssessmentRow = z.infer<typeof assessmentRowSchema>
export type AssessmentsDocument = z.infer<typeof assessmentsDocumentSchema>
export type Polarity = (typeof polarities)[number]
