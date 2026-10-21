import { z } from 'zod'

/**
 * Fields the host composes for the decision pages' answers (change 1 of the wall redesign: tangle-tools
 * fleet/discovery_workspace.py). Each is absent on a host that predates it, and every reader here returns null then, so
 * the pages fall back to the fields served before it. The documents carry them through their schemas' catchall; these
 * schemas only type them where they are read.
 */

const time = z.string()
const s = z.string().nullable().optional()
const n = z.number().nullable().optional()

/** A run's output as data (`progress.output`): code commits per 30 minutes, release tags, and its newest output of any kind. */
const outputSchema = z
  .object({
    asOf: s,
    codeCommits: n,
    newestCodeCommitAt: s,
    codeCommitsBy30Min: z.array(z.object({ at: time, n: z.number() }).catchall(z.unknown())).nullable().optional(),
    pageVersions: n,
    pageCommits: n,
    lastOutputAt: s,
    /** `commit`, `agent-event` or `page-write`: which kind of output was newest. */
    lastOutputKind: s,
    forkCommit: s,
    releaseTags: z
      .array(z.object({ tag: z.string(), at: s, published: z.boolean().nullable().optional(), inherited: z.boolean().optional(), withheld: z.boolean().optional() }).catchall(z.unknown()))
      .nullable()
      .optional(),
  })
  .catchall(z.unknown())

/** One answer the host words for a page (`standing.answer.<slot>`): a headline, its sentence, and the time it is as of. */
const hostAnswerSchema = z.object({ headline: s, text: s, asOf: s }).catchall(z.unknown())

/** What a release contains (`play_head.built`, the report's `built`): crates, guest programs and the commands it ships. */
const builtSchema = z
  .object({
    release: z.object({ tag: s, runId: s, commit: s, builtAt: s }).catchall(z.unknown()).nullable().optional(),
    crates: z.object({ value: z.array(z.string()).nullable().optional() }).catchall(z.unknown()).nullable().optional(),
    guests: z.object({ value: z.number().nullable().optional() }).catchall(z.unknown()).nullable().optional(),
    externalCrates: z.object({ value: z.number().nullable().optional() }).catchall(z.unknown()).nullable().optional(),
    commands: z.object({ value: z.record(z.string(), z.unknown()).nullable().optional() }).catchall(z.unknown()).nullable().optional(),
  })
  .catchall(z.unknown())

/** How far one unchanged commit's score moves across reruns of the check (`rulers[].rerunSpread`). */
const spreadSchema = z
  .object({ min: z.number(), max: z.number(), of: n, commit: s, reruns: n, undecided: n, capS: n, owner: s })
  .catchall(z.unknown())

export type RunOutput = z.infer<typeof outputSchema>
export type HostAnswer = z.infer<typeof hostAnswerSchema>
export type Built = z.infer<typeof builtSchema>
export type RerunSpread = z.infer<typeof spreadSchema>

const read = <T>(schema: z.ZodType<T>, value: unknown): T | null => {
  if (value === null || value === undefined) return null
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : null
}
const field = (value: unknown, key: string): unknown => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined)

export const outputOf = (progress: unknown) => read(outputSchema, field(progress, 'output'))
export const hostAnswer = (standing: unknown, slot: 'solved' | 'producing' | 'built' | 'needs') => read(hostAnswerSchema, field(field(standing, 'answer'), slot))
export const builtOf = (value: unknown) => read(builtSchema, value)
export const spreadOf = (ruler: unknown) => read(spreadSchema, field(ruler, 'rerunSpread'))
/** Whether the host marked a tag gate as read on the commit the run started from (`run.check.gate.inherited`). */
export const inheritedOf = (gate: unknown) => field(gate, 'inherited') === true
/** When the overview read its running runs (`runningAt`), which can be newer than its composition. */
export const runningAtOf = (overview: unknown) => {
  const value = field(overview, 'runningAt')
  return typeof value === 'string' ? value : null
}
/** When an attention item was raised (`raisedAt`), or null when the host serves no raise time. */
export const raisedAtOf = (item: unknown) => {
  const value = field(item, 'raisedAt') ?? field(item, 'since')
  return typeof value === 'string' ? value : null
}
