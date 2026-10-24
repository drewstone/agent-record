import { z } from 'zod'
import type { AsOf } from './answers.js'
import type { Status, StatusAxis } from './data.js'

/**
 * The host's one view of a run or a play (`agent-workspace.view.v1`, tangle-tools fleet/discovery_workspace_parts/views.py).
 * Status word, blocker, progress, what needs Drew and the page's one as-of are decided there; pages print them as served
 * and never recompute them, so two pages that show the same run cannot disagree.
 */
const tone = z.enum(['pass', 'attention', 'fail', 'neutral'])

export const viewStatusSchema = z.object({ key: z.string(), label: z.string(), tone, icon: z.string(), at: z.string().nullable().optional(), reason: z.string().nullable().optional() })

export const viewStepSchema = z.object({ name: z.string().nullable(), label: z.string(), state: z.enum(['pass', 'fail', 'undecided', 'unrun']), line: z.string().nullable().optional(), runs: z.number().optional() })

export const viewProgressSchema = z.object({
  release: z.string().nullable(),
  at: z.string().nullable().optional(),
  passed: z.number(),
  total: z.number(),
  steps: z.array(viewStepSchema),
  workloads: z.object({ passed: z.number().nullable().optional(), total: z.number().nullable().optional() }).nullable().optional(),
  solved: z.boolean(),
  checker: z.string().nullable().optional(),
  /** On a play's view, the run whose release this is. */
  runId: z.string().optional(),
  sentence: z.string(),
})

export const viewBlockerSchema = z.object({ kind: z.string(), text: z.string(), owner: z.string().nullable().optional(), since: z.string().nullable().optional(), action: z.string().nullable().optional(), dispute: z.string().nullable().optional(), why: z.string().nullable().optional() })

/** Is the play moving (views.play_trend): its best steps passed at the end of each of the last 7 days, and the word for it. */
export const viewTrendSchema = z.object({
  days: z.array(z.string()),
  passed: z.array(z.number().nullable()),
  total: z.number(),
  best: z.number(),
  movement: z.enum(['moving', 'stuck', 'regressed', 'solved']),
  since: z.string().nullable(),
  newest: z.object({ release: z.string(), passed: z.number(), at: z.string().nullable() }),
  series: z.array(z.object({ release: z.string(), runId: z.string().nullable().optional(), at: z.string(), passed: z.number() })).optional(),
})
export type ViewTrend = z.infer<typeof viewTrendSchema>

export const viewNeedSchema = z.object({
  runId: z.string().nullable().optional(),
  text: z.string(),
  owner: z.string().nullable().optional(),
  since: z.string().nullable().optional(),
  href: z.string().nullable().optional(),
})

export const viewSchema = z
  .object({
    schema: z.literal('agent-workspace.view.v1'),
    asOf: z.string(),
    status: viewStatusSchema,
    sentence: z.string(),
    blocker: viewBlockerSchema.nullable(),
    progress: viewProgressSchema.nullable(),
    needsYou: z.array(viewNeedSchema),
    trend: viewTrendSchema.nullable().optional(),
  })
  .catchall(z.unknown())

/** A play's view as the Plays list carries it (tangle-tools play_standing_brief): status, sentence, best release, and each read run's status. */
export const viewBriefSchema = z
  .object({ status: viewStatusSchema, sentence: z.string(), progress: viewProgressSchema.nullable(), runs: z.record(z.string(), viewStatusSchema).nullable().optional(), blocker: viewBlockerSchema.nullable().optional(), needsYou: z.array(viewNeedSchema).optional(), asOf: z.string().optional() })
  .catchall(z.unknown())

export type HostView = z.infer<typeof viewSchema>
export type ViewStatus = z.infer<typeof viewStatusSchema>

/** A served status as the page's chip: the host's word, tone and icon. */
export const viewChip = (status: ViewStatus, axis: StatusAxis = 'run'): Status => ({ axis, word: status.label, tone: status.tone, shape: status.icon })

/** The page's one as-of: when the host composed this view. */
export const viewAsOf = (view: HostView): AsOf => ({ at: view.asOf, meaning: 'when the host last composed this page', source: 'the view the host serves' })
