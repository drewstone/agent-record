import { z } from 'zod'
const nullableNumber = z.number().nullable()
const nullableText = z.string().nullable()
const behaviorVerdict = z.enum(['met', 'violated', 'unknown'])
const behaviorExpectationsSchema = z.object({
  schema: z.literal('disco.behavior-expectations.v1'), advisory: z.literal(true), verdict: behaviorVerdict,
  basis: z.string(),
  profiles: z.array(z.object({
    name: nullableText, digest: nullableText, verdict: behaviorVerdict,
    nodes: z.array(z.object({
      nodeId: z.string(), verdict: behaviorVerdict, reason: nullableText.optional(),
      dimensions: z.array(z.object({
        dimension: z.string(), expected: z.union([z.string(), z.object({ min: z.number(), max: z.number() })]),
        count: nullableNumber, observed: z.number(), verdict: behaviorVerdict, reason: nullableText,
        interpretation: z.string().optional(),
        evidence: z.array(z.object({
          eventId: nullableText.optional(), at: nullableText.optional(),
          source: z.object({ path: z.string(), offset: z.number(), bytes: z.number(), lineSha256: z.string() }).catchall(z.unknown()).nullable().optional(),
        }).catchall(z.unknown())),
      }).catchall(z.unknown())),
    }).catchall(z.unknown())),
  }).catchall(z.unknown())),
}).catchall(z.unknown())
export const runReceiptSchema = z.object({
  schema: z.literal('discovery-lab.run-receipt'), runId: z.string(), tag: z.string(), title: z.string(), brief: nullableText,
  outcome: z.object({ status: z.enum(['running', 'passed', 'not-passed', 'unmeasured', 'cancelled']), sentence: z.string(), at: nullableText, reason: nullableText, class: nullableText }),
  chosen: z.object({ tag: z.string(), commit: nullableText, why: z.string() }),
  behaviorExpectations: behaviorExpectationsSchema.nullable().optional(),
  check: z.object({ passed: z.boolean().nullable(), known: z.boolean(), output: nullableText, commit: nullableText, tag: nullableText, at: nullableText, checker: z.object({ path: nullableText, sha256: nullableText }), inputs: z.object({ source: nullableText, sha256: nullableText, count: nullableNumber }), rerun: nullableText }).catchall(z.unknown()).nullable(),
  files: z.array(z.object({ file: z.string(), label: z.string(), size: z.number().optional() }).catchall(z.unknown())),
  decisions: z.array(z.object({ id: z.string(), label: z.string(), consequence: z.string(), command: nullableText, enabled: z.boolean(), reason: nullableText })),
  work: z.object({ wallHours: nullableNumber, recordedHours: nullableNumber, agentHours: nullableNumber, idleHours: nullableNumber, untracedHours: nullableNumber, toolCalls: nullableNumber, tokens: z.object({ fresh: nullableNumber, cached: nullableNumber, total: nullableNumber }).catchall(z.unknown()), tries: nullableNumber }),
  waste: z.object({ afterPass: z.object({ hours: nullableNumber, tokens: nullableNumber, usd: nullableNumber }), verdictDelay: z.object({ minutes: nullableNumber, refusedChecks: nullableNumber }) }),
  timeline: z.object({ start: nullableText, end: nullableText, deadline: nullableText, lanes: z.array(z.object({ id: z.string(), label: z.string(), spans: z.array(z.object({ start: z.string(), end: nullableText, state: z.string(), note: nullableText.optional() })) })), marks: z.array(z.object({ t: z.string(), label: z.string(), kind: z.enum(['pass', 'deadline', 'died', 'event']) })) }),
  versions: z.object({ rows: z.array(z.object({ tag: z.string(), commit: nullableText, at: nullableText, exactPassed: nullableNumber, exactTotal: nullableNumber, checks: z.array(z.object({ id: z.string(), label: z.string().optional(), result: z.string() }).catchall(z.unknown())) })), line: z.object({ x: z.tuple([z.number(), z.number()]).nullable(), y: z.tuple([z.number(), z.number()]), marks: z.array(z.object({ t: z.string(), label: z.string(), kind: z.enum(['pass', 'deadline', 'died', 'event']) })) }) }).optional(),
  lineage: z.object({ chain: z.array(z.string()), ancestors: z.array(z.unknown()) }).catchall(z.unknown()).nullable().optional(),
  sources: z.record(z.string(), nullableText),
  cost: z.object({ billedUsd: z.object({ total: z.object({ usd: nullableNumber }).catchall(z.unknown()) }).catchall(z.unknown()) }).catchall(z.unknown()),
  scores: z.object({ checks: z.array(z.object({ id: z.string(), label: z.string().optional(), result: z.string() }).catchall(z.unknown())) }).catchall(z.unknown()).nullable(),
  system: z.object({ behaviorExpectations: behaviorExpectationsSchema.nullable().optional(), errors: z.object({ top: z.array(z.object({ count: z.number(), tool: z.string(), message: z.string() })) }).nullable().optional() }).catchall(z.unknown()).nullable().optional(),
}).catchall(z.unknown())
export type RunReceipt = z.infer<typeof runReceiptSchema>
export const hoursText = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)} h`
export const tokensText = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
export const utcClock = (value: string) => `${value.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`
