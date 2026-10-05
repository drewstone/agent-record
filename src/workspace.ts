import { z } from 'zod'

/**
 * Documents served by a run workspace API (`/api/discovery/*` on the Tangle wall).
 * Unknown dollars are `null`; a consumer never renders or sums them as zero.
 */
const time = z.iso.datetime({ offset: true })
const usd = z.number().nullable()
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)

export const gapSchema = z
  .object({
    runId: z.string().optional(),
    nodeId: z.string().nullable().optional(),
    /** no-record, no-transcript:<reason>, spend-unknown, predecessor-missing, archived-not-ingested,
     * record-too-large, unsupported-format, rate-limited, ingest-failed, key-without-run */
    code: z.string(),
    detail: z.string(),
  })
  .catchall(z.unknown())

/** `ms` is null when no duration was measured (a reasoning turn has tokens but no recorded time). */
const measureRow = z.object({
  ms: z.number().nonnegative().nullable(),
  tokens: z.number().nonnegative().nullable(),
  listUsd: usd,
})

export const spendSchema = z
  .object({
    paidUsd: usd,
    sandboxUsd: usd,
    routerUsd: usd,
    costBasisUsd: usd,
    /** Subscription list-price equivalent from native usage. Not paid. */
    listUsd: usd,
    tokens: z
      .object({
        input: z.number().nonnegative(),
        output: z.number().nonnegative(),
        cacheRead: z.number().nonnegative(),
        cacheWrite: z.number().nonnegative(),
      })
      .nullable(),
    sandboxHours: z.number().nonnegative().nullable(),
    paidKnown: z.boolean(),
    /** False when some agent's usage is unknown: `listUsd` then covers only the agents whose usage is known. */
    listKnown: z.boolean().optional(),
    /** "ledger:<keyId>", "keeper:sandbox-cost", "record:usage" */
    sources: z.array(z.string()),
    byCategory: z.array(measureRow.extend({ category: z.string() })).optional(),
    /** Time each waste dimension took, each moment counted once: overlapping findings go to the first in priority order. */
    waste: z.array(measureRow.extend({ dimension: z.string() })).optional(),
    /** Spend per served model: paid from the agents' sandboxes, list price from their usage. */
    byModel: z
      .array(
        z
          .object({
            model: z.string(),
            paidUsd: usd,
            listUsd: usd,
            tokens: z.number().nonnegative().nullable(),
            agents: z.number().int().nonnegative(),
          })
          .catchall(z.unknown()),
      )
      .optional(),
    gaps: z.array(gapSchema),
  })
  .catchall(z.unknown())

export const recordStatusSchema = z
  .object({
    status: z.enum(['ready', 'building', 'missing', 'failed', 'archived']),
    digest: sha256.nullable(),
    builtAt: time.nullable(),
    reason: z.string().nullable(),
    capture: z
      .object({
        complete: z.number().int().nonnegative(),
        lossy: z.number().int().nonnegative(),
        absent: z.number().int().nonnegative(),
      })
      .nullable(),
  })
  .catchall(z.unknown())

const runState = z.enum(['running', 'winner', 'no-winner', 'failed', 'driver-failed', 'no-record', 'unknown'])
const runKey = z
  .object({ id: z.string(), name: z.string(), capUsd: usd, spentUsd: usd, final: z.boolean() })
  .catchall(z.unknown())

export const runSummarySchema = z
  .object({
    id: z.string(),
    group: z.string(),
    kind: z.enum(['run', 'version', 'search']),
    play: z.string(),
    location: z.object({ kind: z.enum(['dir', 'archive', 'none']), path: z.string().nullable() }),
    format: z.string(),
    state: runState,
    reason: z.string().nullable(),
    startedAt: time.nullable(),
    settledAt: time.nullable(),
    durationMs: z.number().nonnegative().nullable(),
    nodes: z.number().int().nonnegative().nullable(),
    depth: z.number().int().nonnegative().nullable(),
    harnesses: z.array(z.string()),
    models: z.array(z.string()),
    keys: z.array(runKey),
    spend: spendSchema,
    record: recordStatusSchema,
    inputDigest: z.string().nullable(),
    predecessor: z.string().nullable(),
    supersedes: z.string().nullable(),
    versions: z
      .object({ count: z.number().int().nonnegative(), latest: z.string(), states: z.record(z.string(), z.number()) })
      .nullable(),
  })
  .catchall(z.unknown())

export const playInputSchema = z
  .object({
    runId: z.string(),
    schema: z.string().nullable(),
    digest: z.string().nullable(),
    source: z.object({ path: z.string(), sha256 }).catchall(z.unknown()),
    objective: z.string().nullable(),
    instruction: z.string().nullable(),
    completion: z.string().nullable(),
    knowledge: z.string().nullable(),
    acceptance: z.record(z.string(), z.unknown()).nullable(),
    budget: z.record(z.string(), z.unknown()).nullable(),
    continuation: z.record(z.string(), z.unknown()).nullable(),
    profile: z
      .object({
        name: z.string().nullable(),
        harness: z.string().nullable(),
        model: z.string().nullable(),
        provider: z.string().nullable(),
        reasoningEffort: z.string().nullable(),
        credentialSource: z.string().nullable(),
        tools: z.array(z.string()),
        skills: z.array(z.string()),
        systemPromptSha256: z.string().nullable(),
      })
      .catchall(z.unknown())
      .nullable(),
    /** File content is served by the source route under this sha256. */
    files: z.array(z.object({ path: z.string(), bytes: z.number().int().nonnegative(), sha256 }).catchall(z.unknown())),
  })
  .catchall(z.unknown())

const headlineLabel = z.object({ label: z.string(), polarity: z.enum(['good', 'bad', 'neutral', 'unknown']) })

export const playsDocumentSchema = z
  .object({
    schema: z.literal('agent-workspace.plays.v1'),
    builtAt: time,
    plays: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          program: z.string().nullable(),
          line: z.string().nullable(),
          playBasis: z.string(),
          state: z.string().nullable(),
          latestRun: z.object({ id: z.string(), startedAt: time.nullable(), state: runState }).nullable(),
          runCount: z.number().int().nonnegative(),
          spend: spendSchema,
          headline: z.record(z.string(), headlineLabel),
        })
        .catchall(z.unknown()),
    ),
  })
  .catchall(z.unknown())

export const lineageEdgeKinds = ['supersedes', 'continues', 'retry', 'version'] as const

export const playDocumentSchema = z
  .object({
    schema: z.literal('agent-workspace.play.v1'),
    id: z.string(),
    title: z.string(),
    program: z.string().nullable(),
    line: z.string().nullable(),
    playBasis: z.string(),
    charter: z.string().nullable(),
    frontier: z
      .object({
        statement: z.string().nullable(),
        target: z.string().nullable(),
        asOf: z.string().nullable(),
        banked: z.unknown(),
        ruledOut: z.unknown(),
        next: z.unknown(),
      })
      .catchall(z.unknown())
      .nullable(),
    /** The latest run's input. */
    input: playInputSchema.nullable(),
    /** Newest first; versions are folded into their run. */
    runs: z.array(runSummarySchema),
    lineage: z.object({
      nodes: z.array(z.object({ runId: z.string(), state: runState, record: recordStatusSchema }).catchall(z.unknown())),
      edges: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(lineageEdgeKinds) }).catchall(z.unknown())),
    }),
    spend: spendSchema,
    assessments: z.array(
      z
        .object({
          runId: z.string(),
          dimension: z.string(),
          label: z.string(),
          polarity: z.enum(['good', 'bad', 'neutral', 'unknown']),
          status: z.string(),
          method: z.string().optional(),
          calibrated: z.boolean().nullable().optional(),
        })
        .catchall(z.unknown()),
    ),
    gaps: z.array(gapSchema),
  })
  .catchall(z.unknown())

const nodeSpend = spendSchema.extend({
  sandboxes: z.array(
    z
      .object({ id: z.string(), usd, costBasisUsd: usd, hours: z.number().nonnegative().nullable() })
      .catchall(z.unknown()),
  ),
  account: z
    .object({
      kind: z.enum(['subscription', 'router', 'unknown']),
      rateLimit: z
        .object({
          window: z.string().nullable(),
          utilization: z.number().nullable(),
          status: z.string().nullable(),
          at: time.nullable(),
        })
        .nullable(),
    })
    .catchall(z.unknown()),
})

const outputFile = z
  .object({
    path: z.string(),
    bytes: z.number().int().nonnegative().nullable(),
    sha256: sha256.nullable(),
    /** Same-origin link to the file's bytes; null when the host cannot serve it. */
    href: z.string().nullable(),
  })
  .catchall(z.unknown())

/**
 * The run's readout, written after it settles (discovery-lab `runner/readout.mjs`, `discovery.run-readout`): a summary,
 * the declared deliverables, hypothesis verdicts, judge scores, cost and the published report links. `pending` until a
 * readout finishes; a failed one keeps its error. Unmeasured numbers are null, never 0.
 */
export const readoutSchema = z
  .object({
    status: z.enum(['pending', 'complete', 'partial', 'failed']),
    generatedAt: time.nullable(),
    settle: z.object({ kind: z.string(), reason: z.string().nullable() }).catchall(z.unknown()).nullable(),
    summary: z.string().nullable(),
    deliverables: z.array(
      z
        .object({
          id: z.string(),
          kind: z.string().nullable(),
          path: z.string().nullable(),
          bar: z.string().nullable(),
          present: z.boolean().nullable(),
          bytes: z.number().int().nonnegative().nullable(),
          /** An http(s) link to the delivered copy (a secret gist file); null when none was published. */
          url: z.string().nullable(),
        })
        .catchall(z.unknown()),
    ),
    verdicts: z.array(
      z
        .object({
          id: z.string(),
          statement: z.string(),
          /** met, not-met, inconclusive or not-measured; another value is shown as written. */
          verdict: z.string(),
          evidence: z.string(),
        })
        .catchall(z.unknown()),
    ),
    judges: z.array(
      z
        .object({
          category: z.string(),
          score: z.number().nullable(),
          max: z.number().nullable(),
          calibrated: z.boolean().nullable(),
          summary: z.string(),
        })
        .catchall(z.unknown()),
    ),
    links: z.object({ report: z.string().nullable(), dossier: z.string().nullable(), gist: z.string().nullable() }).catchall(z.unknown()),
    cost: z.object({ readoutUsd: usd, runUsd: usd }).catchall(z.unknown()),
    error: z.string().nullable(),
  })
  .catchall(z.unknown())

/** What the run was asked to deliver and whether it did. Absent on documents built before the field existed. */
export const finalOutputSchema = z
  .object({
    declared: z
      .object({
        source: z.enum(['deliverable-check', 'run-input']),
        field: z.string(),
        path: z.string().nullable(),
        description: z.string().nullable(),
      })
      .catchall(z.unknown())
      .nullable(),
    status: z.enum(['none-declared', 'delivered', 'not-delivered', 'unknown']),
    checkedAt: time.nullable(),
    files: z.array(outputFile),
    /** The root agent's last output, shown when nothing was declared. */
    rootOutput: outputFile.nullable(),
    /** Absent on documents built before the readout existed. */
    readout: readoutSchema.nullable().optional(),
  })
  .catchall(z.unknown())

export const runDocumentSchema = z
  .object({
    schema: z.literal('agent-workspace.run.v1'),
    run: runSummarySchema,
    input: playInputSchema.nullable(),
    spend: spendSchema.extend({ nodes: z.record(z.string(), nodeSpend) }),
    versions: z.array(runSummarySchema),
    live: z.object({ mirrorAt: time.nullable(), polling: z.boolean() }),
    finalOutput: finalOutputSchema.nullable().optional(),
  })
  .catchall(z.unknown())

export type Gap = z.infer<typeof gapSchema>
export type Spend = z.infer<typeof spendSchema>
export type RecordStatus = z.infer<typeof recordStatusSchema>
export type RunSummary = z.infer<typeof runSummarySchema>
export type PlayInput = z.infer<typeof playInputSchema>
export type PlaysDocument = z.infer<typeof playsDocumentSchema>
export type PlayDocument = z.infer<typeof playDocumentSchema>
export type RunDocument = z.infer<typeof runDocumentSchema>
export type NodeSpend = z.infer<typeof nodeSpend>
export type FinalOutput = z.infer<typeof finalOutputSchema>
export type Readout = z.infer<typeof readoutSchema>
export type OutputFile = z.infer<typeof outputFile>
