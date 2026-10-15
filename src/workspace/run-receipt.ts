import { z } from 'zod'
const nullableNumber = z.number().nullable()
const nullableText = z.string().nullable()
export const runReceiptSchema = z.object({
  schema: z.literal('discovery-lab.run-receipt'), runId: z.string(), tag: z.string(), title: z.string(), brief: nullableText,
  outcome: z.object({ status: z.enum(['running', 'passed', 'not-passed', 'unmeasured', 'cancelled']), sentence: z.string(), at: nullableText, reason: nullableText, class: nullableText }),
  chosen: z.object({ tag: z.string(), commit: nullableText, why: z.string() }),
  check: z.object({ passed: z.boolean().nullable(), known: z.boolean(), output: nullableText, commit: nullableText, tag: nullableText, at: nullableText, checker: z.object({ path: nullableText, sha256: nullableText }), inputs: z.object({ source: nullableText, sha256: nullableText, count: nullableNumber }), rerun: nullableText }).catchall(z.unknown()),
  files: z.array(z.object({ file: z.string(), label: z.string(), size: z.number().optional() }).catchall(z.unknown())),
  decisions: z.array(z.object({ id: z.string(), label: z.string(), consequence: z.string(), command: nullableText, enabled: z.boolean(), reason: nullableText })),
  work: z.object({ wallHours: nullableNumber, recordedHours: nullableNumber, agentHours: nullableNumber, idleHours: nullableNumber, untracedHours: nullableNumber, toolCalls: nullableNumber, tokens: z.object({ fresh: nullableNumber, cached: nullableNumber, total: nullableNumber }).catchall(z.unknown()), tries: nullableNumber }),
  waste: z.object({ afterPass: z.object({ hours: nullableNumber, tokens: nullableNumber, usd: nullableNumber }), verdictDelay: z.object({ minutes: nullableNumber, refusedChecks: nullableNumber }) }),
  timeline: z.object({ start: nullableText, end: nullableText, deadline: nullableText, lanes: z.array(z.object({ id: z.string(), label: z.string(), spans: z.array(z.object({ start: z.string(), end: nullableText, state: z.string(), note: nullableText.optional() })) })), marks: z.array(z.object({ t: z.string(), label: z.string(), kind: z.enum(['pass', 'deadline', 'died', 'event']) })) }),
  sources: z.record(z.string(), nullableText),
  cost: z.object({ billedUsd: z.object({ total: z.object({ usd: nullableNumber }).catchall(z.unknown()) }).catchall(z.unknown()) }).catchall(z.unknown()),
  scores: z.object({ checks: z.array(z.object({ id: z.string(), label: z.string().optional(), result: z.string() }).catchall(z.unknown())) }).catchall(z.unknown()).nullable(),
  system: z.object({ errors: z.object({ top: z.array(z.object({ count: z.number(), tool: z.string(), message: z.string() })) }).nullable().optional() }).catchall(z.unknown()).nullable().optional(),
}).catchall(z.unknown())
export type RunReceipt = z.infer<typeof runReceiptSchema>
export const hoursText = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)} h`
export const tokensText = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
export const utcClock = (value: string) => `${value.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`
