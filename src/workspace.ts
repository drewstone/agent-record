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

/** A fraction of a subscription seat's observed seven-day allowance, never a dollar amount. */
const seatWeeks = z.number().nonnegative().nullable()
const seatSegment = z.object({
  seat: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  startedAt: time,
  endedAt: time.nullable().optional(),
  reason: z.string().nullable().optional(),
  seatWeeks,
  seatWeeksKnown: z.boolean(),
}).catchall(z.unknown())

export const spendSchema = z
  .object({
    paidUsd: usd,
    /** Subscription model use priced at API rates; never billed as a model API charge. */
    subscriptionUsd: usd,
    /** Model API charge from the Router ledger. */
    apiUsd: usd,
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
    seatWeeks: seatWeeks.optional(),
    seatWeeksKnown: z.boolean().optional(),
    bySeat: z.array(z.object({
      seat: z.string(), provider: z.string().nullable(), model: z.string().nullable(),
      seatWeeks, known: z.boolean(),
    }).catchall(z.unknown())).optional(),
    paidKnown: z.boolean(),
    subscriptionKnown: z.boolean(),
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
            subscriptionUsd: usd,
            apiUsd: usd,
            sandboxUsd: usd,
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

/** Why a run or play is hidden by default; the host decides it (tangle-tools discovery_workspace.hidden_reason). */
export const hiddenReasons = ['failed', 'smoke', 'archived'] as const
const hiddenReason = z.enum(hiddenReasons)

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
    /** Why the run sits behind the default filter (a test or smoke run, a failure, an archived run); null shows it. */
    hidden: hiddenReason.nullable().optional(),
    /** What the run record says the run is for; null when the record states nothing the catalog read. */
    purpose: z.string().nullable().optional(),
    /** The record field the purpose came from: acceptance.purpose, task or task.objective. */
    purposeBasis: z.string().nullable().optional(),
    /** The results and claims its agents wrote, as last derived; null when not derived yet (unknown, not none). */
    findings: z.object({ results: z.number().int(), claims: z.number().int() }).catchall(z.unknown()).nullable().optional(),
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
        version: z.string().nullable(),
        /** The root's admitted canonical profile identity, when its spawn journal survived. */
        digest: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
        harness: z.string().nullable(),
        model: z.string().nullable(),
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
          /** The play groups runs whose records name no program: tests and smoke runs. */
          noProgram: z.boolean().optional(),
          state: z.string().nullable(),
          latestRun: z.object({ id: z.string(), startedAt: time.nullable(), state: runState }).nullable(),
          runCount: z.number().int().nonnegative(),
          /** Runs by why they are hidden by default; `shown` counts the rest. */
          counts: z
            .object({
              shown: z.number().int().nonnegative(),
              smoke: z.number().int().nonnegative(),
              failed: z.number().int().nonnegative(),
              archived: z.number().int().nonnegative(),
            })
            .optional(),
          /** Why the default filter hides the play: set only when it hides every run of it. */
          hidden: hiddenReason.nullable().optional(),
          spend: spendSchema,
          headline: z.record(z.string(), headlineLabel),
        })
        .catchall(z.unknown()),
    ),
    frontiers: z.array(z.object({ id: z.string(), asOf: z.string().nullable(), statement: z.string().nullable(),
      banked: z.number(), next: z.number() })).optional(),
    runs: z.array(z.object({ id: z.string(), play: z.string(), program: z.string().nullable(), state: z.string(),
      startedAt: time.nullable(), activeAt: time.nullable(), reason: z.string().nullable(), stopCause: z.string().nullable(),
      hidden: hiddenReason.nullable(), subscriptionUsd: usd, apiUsd: usd, sandboxUsd: usd })).optional(),
  })
  .catchall(z.unknown())

export const lineageEdgeKinds = ['supersedes', 'continues', 'retry', 'version'] as const

/** One outside review of one precise claim on a knowledge page. A page can carry several distinct claims. */
export const scientificReviewSchema = z.object({
  method: z.literal('scientific'),
  dimension: z.literal('claim-review'),
  status: z.enum(['decided', 'unresolved', 'stale']),
  label: z.string().nullable().optional(),
  confidence: z.union([z.number(), z.string()]).nullable().optional(),
  claim: z.string(),
  subject: z.object({ pageSha256: z.string(), claimId: z.string(), pagePath: z.string().optional() }).catchall(z.unknown()),
  rerun: z.object({ status: z.string(), command: z.string().nullable().optional(), output: z.string().nullable().optional(), description: z.string().nullable().optional() }).catchall(z.unknown()).optional(),
  priorArt: z.object({ status: z.string(), summary: z.string().nullable().optional(), references: z.array(z.object({ title: z.string(), url: z.string(), resolvesClaim: z.string().optional() }).catchall(z.unknown())) }).catchall(z.unknown()).optional(),
  rationale: z.string().nullable().optional(),
  source: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
  sourceRef: z.string().nullable().optional(),
  /** Who reviewed: a stable identity (a review lane, a judge model under a harness) and what ran it. */
  reviewer: z
    .object({
      identity: z.string().optional(),
      kind: z.string().nullable().optional(),
      lane: z.string().nullable().optional(),
      provider: z.string().nullable().optional(),
      harness: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
      servedModel: z.string().nullable().optional(),
    })
    .catchall(z.unknown())
    .nullable()
    .optional(),
}).catchall(z.unknown())

/** What cites a run's claims outside the run: a proof packet, a site entry, a public repository. A citation names a
 * page by SHA-256, and optionally a precise claim on it and the reviewer whose verdict it relies on. */
export const publicationSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    url: z.string().nullable().optional(),
    at: z.string().nullable().optional(),
    /** `draft`, `private`, `published`. */
    status: z.string().nullable().optional(),
    /** The session that wrote it, when recorded. */
    session: z.object({ harness: z.string().nullable().optional(), model: z.string().nullable().optional(), label: z.string().nullable().optional() }).catchall(z.unknown()).nullable().optional(),
    cites: z.array(z.object({ pageSha256: z.string(), claimId: z.string().nullable().optional(), reviewer: z.string().nullable().optional() }).catchall(z.unknown())),
  })
  .catchall(z.unknown())

/** One result or claim an agent wrote, as the findings feed and a play's results list it. */
export const feedItemSchema = z
  .object({
    runId: z.string(),
    play: z.string(),
    program: z.string().nullable(),
    state: z.string().nullable(),
    startedAt: z.string().nullable(),
    at: z.string().nullable(),
    agentLabel: z.string().nullable(),
    kind: z.string(),
    title: z.string().nullable(),
    text: z.string(),
    class: z.string().nullable(),
    ledger: z.boolean(),
    sha256: z.string(),
    artifacts: z.array(z.object({ path: z.string(), storePath: z.string(), href: z.string() })).optional(),
    reviews: z.array(scientificReviewSchema).optional(),
  })
  .catchall(z.unknown())

export const playDocumentSchema = z
  .object({
    schema: z.literal('agent-workspace.play.v1'),
    id: z.string(),
    title: z.string(),
    program: z.string().nullable(),
    line: z.string().nullable(),
    playBasis: z.string(),
    noProgram: z.boolean().optional(),
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
    /** The newest run that settled with a winner: the play's best result, a separate fact from its latest run. */
    best: z.string().nullable().optional(),
    /** The play's results and claims, newest run first, each run's result ledgers first. */
    findings: z.array(feedItemSchema).optional(),
  })
  .catchall(z.unknown())

const nodeSpend = spendSchema.extend({
  segments: z.array(seatSegment).optional(),
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
    /** How the viewer reads it: markdown, image, csv, json, html, code or other. Absent on documents built before it existed. */
    kind: z.string().optional(),
    /** Same-origin link to the file's bytes; null when the host cannot serve it. */
    href: z.string().nullable(),
  })
  .catchall(z.unknown())

/**
 * The latest observer brief of the run (discovery-lab `runner/readout-brief.mjs`): written every 90 minutes while it runs
 * and once when it ends, in plain English, with what each agent is doing and the risks the observer sees.
 */
export const progressBriefSchema = z
  .object({
    sequence: z.number().int(),
    phase: z.string(),
    final: z.boolean(),
    generatedAt: time.nullable(),
    headline: z.string().nullable(),
    answer: z
      .object({ text: z.string(), confidence: z.string().nullable(), why: z.string().nullable().optional(), fromSequence: z.number().int().nullable().optional() })
      .catchall(z.unknown())
      .nullable(),
    changed: z.array(z.string()),
    team: z.array(
      z
        .object({ node: z.string(), label: z.string().nullable(), state: z.string().nullable(), model: z.string().nullable(), usd: usd, lastActiveAt: time.nullable(), doing: z.string().nullable() })
        .catchall(z.unknown()),
    ),
    risks: z.array(
      z.object({ severity: z.string().nullable(), kind: z.string().nullable(), risk: z.string(), evidence: z.string().nullable(), source: z.string().nullable() }).catchall(z.unknown()),
    ),
    links: z.object({ latest: z.string().nullable(), brief: z.string().nullable(), gist: z.string().nullable() }).catchall(z.unknown()),
    spend: z
      .object({ runUsd: usd, provenance: z.string().nullable(), clause: z.string().nullable().optional(), harnessListUsd: usd.optional(), sinceLastBriefUsd: usd.optional() })
      .catchall(z.unknown())
      .optional(),
  })
  .catchall(z.unknown())

/**
 * The run's progress as data (discovery-lab `runner/run-progress.mjs`, `discovery.run-progress`): who worked when, each
 * agent's API-equivalent dollars, and the run's spend and files written over time. The briefs draw their record charts
 * from this same document, and the records watcher rewrites it every few minutes while the run runs, so the page and the
 * brief at a checkpoint show the same numbers. Unmeasured values are null, never 0.
 */
export const runProgressSchema = z
  .object({
    schema: z.literal('discovery.run-progress'),
    runId: z.string(),
    generatedAt: time,
    phase: z.string(),
    final: z.boolean(),
    startedAt: time.nullable(),
    /** API-equivalent dollars (every token at list price, whoever paid), as the brief states them, with their basis. */
    spend: z.object({ runUsd: usd, provenance: z.string().nullable() }).catchall(z.unknown()),
    files: z.number().int().nonnegative(),
    agents: z.array(
      z
        .object({
          node: z.string(),
          label: z.string(),
          status: z.string(),
          parent: z.string().nullable().optional(),
          depth: z.number().int().nullable().optional(),
          /** False for an agent only the spawn journal names; the charts draw the agents Runtime observed. */
          observed: z.boolean().optional(),
          lastActiveAt: time.nullable().optional(),
          /** Null for an agent with no record yet. */
          startedAt: time.nullable(),
          endedAt: time.nullable(),
          usd: usd,
          usdEstimated: z.boolean(),
          model: z.string().nullable(),
        })
        .catchall(z.unknown()),
    ),
    /** Each brief's figures when it was written. */
    briefs: z.array(z.object({ sequence: z.number().int(), at: time, runUsd: usd, files: z.number().int().nullable(), final: z.boolean() }).catchall(z.unknown())),
    /** The figures at each refresh, oldest first; a brief's own refresh is one of them. */
    samples: z.array(
      z.object({ at: time, runUsd: usd, files: z.number().int().nonnegative(), working: z.number().int().nonnegative(), sequence: z.number().int().optional() }).catchall(z.unknown()),
    ),
    /** When each record the document reads last changed. */
    sources: z.record(z.string(), time.nullable()).optional(),
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
    /** The charts the readout drew from the run's outputs. Absent on documents built before they were served. */
    charts: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string().nullable(),
            unit: z.string().nullable(),
            kind: z.string().nullable(),
            caption: z.string().nullable(),
            width: z.number().int().nullable(),
            height: z.number().int().nullable(),
            href: z.string(),
          })
          .catchall(z.unknown()),
      )
      .optional(),
  })
  .catchall(z.unknown())

/** A person's grade of a run or one of its outputs (`discovery.human-grade.v1`), on the readout's absolute scale. */
export const humanGradeSchema = z
  .object({
    at: time,
    by: z.string(),
    target: z.object({ kind: z.enum(['run', 'deliverable', 'file']), id: z.string() }),
    category: z.string(),
    score: z.number().int().min(0).max(100),
    comment: z.string(),
    scale: z.string(),
  })
  .catchall(z.unknown())

/** One AI persona's review of the run (discovery-lab `runner/readout-panel.mjs`): absolute 0–100 per category; advisory. */
export const panelReviewSchema = z
  .object({
    panel: z.string(),
    persona: z.string(),
    overall: z.number().nullable(),
    decision: z.string().nullable(),
    verdict: z.string().nullable(),
    scores: z.record(
      z.string(),
      z.object({ score: z.number().nullable(), band: z.string().nullable(), competence: z.string().nullable(), why: z.string().nullable() }).catchall(z.unknown()),
    ),
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
    /** The run's latest progress brief; null when it has none. */
    brief: progressBriefSchema.nullable().optional(),
    /** The readable result of a run that ended without its deliverable: its latest brief. */
    fallback: z
      .object({ source: z.string(), sequence: z.number().int(), generatedAt: time.nullable(), headline: z.string().nullable(), answer: z.string().nullable(), url: z.string().nullable() })
      .catchall(z.unknown())
      .nullable()
      .optional(),
    /** People's grades of the run and its outputs: the latest per grader, target and category, and how many were given. */
    grades: z.object({ latest: z.array(humanGradeSchema), count: z.number().int() }).optional(),
    /** The AI persona panel's reviews of the run. */
    panel: z.array(panelReviewSchema).optional(),
  })
  .catchall(z.unknown())

/** One knowledge page an agent wrote, as the run's findings list it: its last version, classified by file name. */
export const findingItemSchema = z
  .object({
    path: z.string(),
    agent: z.string().nullable(),
    agentLabel: z.string().nullable(),
    at: z.string().nullable(),
    /** result, claim, check, sources, plan, evidence or process. */
    kind: z.string(),
    title: z.string(),
    summary: z.string(),
    /** A result page's stated answer (the section under an "Answer" heading, or an `Answer:` label); absent otherwise. */
    answer: z.string().nullable().optional(),
    /** The page's own class line (NEW-INTERNAL, CONJECTURE…), when it states one. */
    class: z.string().nullable(),
    /** A check page's first verdict word (CORRECT, NO ERROR, INCORRECT…). */
    verdict: z.string().nullable(),
    versions: z.number().int(),
    /** Written after the record's capture stopped: known from the run directory only. */
    uncaptured: z.boolean(),
    bytes: z.number().int(),
    sha256: z.string(),
    /** Files declared by this exact page, with guarded same-origin download routes. */
    artifacts: z.array(z.object({ path: z.string(), storePath: z.string(), href: z.string() })).optional(),
    /** Independent reviews of precise claims on this page; empty or absent means no outside verdict yet. */
    reviews: z.array(scientificReviewSchema).optional(),
  })
  .catchall(z.unknown())

/** What a run found, from the knowledge pages its agents wrote (`agent-workspace.findings.v1`), with the sources
 * they read or cited and how the run stopped. Absent on documents built before the field existed. */
export const findingsSchema = z
  .object({
    schema: z.literal('agent-workspace.findings.v1'),
    items: z.array(findingItemSchema),
    total: z.number().int(),
    /** Which listed pages name which, by sha256: the work graph's edges. Absent before findings carried them. */
    links: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
    /** What outside the run cites its pages and verdicts; absent until a publication index serves them. */
    publications: z.array(publicationSchema).optional(),
    agents: z.array(
      z
        .object({
          agent: z.string().nullable(),
          label: z.string().nullable(),
          pages: z.number().int(),
          bytes: z.number().int(),
          kinds: z.record(z.string(), z.number()),
          lastWords: z.object({ at: z.string().nullable(), text: z.string() }).optional(),
        })
        .catchall(z.unknown()),
    ),
    sources: z
      .object({
        citations: z.array(
          z
            .object({ kind: z.string(), id: z.string(), mentions: z.number().int(), agents: z.array(z.string()), pages: z.number().int(), citedBy: z.array(z.string()).optional() })
            .catchall(z.unknown()),
        ),
        webSearches: z.array(z.object({ at: z.string().nullable(), agent: z.string().nullable(), label: z.string().nullable(), query: z.string() }).catchall(z.unknown())),
        webFetches: z.array(z.object({ at: z.string().nullable(), agent: z.string().nullable(), label: z.string().nullable(), url: z.string() }).catchall(z.unknown())),
        knowledgeReads: z.number().int(),
        knowledgeSearches: z.number().int(),
      })
      .catchall(z.unknown()),
    stop: z
      .object({
        kind: z.string().nullable(),
        reason: z.string().nullable(),
        attempts: z.number().int().nullable(),
        firstFailure: z.string().nullable(),
        lastCause: z.string().nullable(),
        limits: z.array(z.object({ at: z.string().nullable(), agent: z.string().nullable(), label: z.string().nullable(), limit: z.string(), text: z.string() }).catchall(z.unknown())),
      })
      .catchall(z.unknown()),
  })
  .catchall(z.unknown())

/** What Discovery found across runs, newest first (`agent-workspace.findings-feed.v1`, served at `findings`). */
export const findingsFeedSchema = z
  .object({
    schema: z.literal('agent-workspace.findings-feed.v1'),
    builtAt: z.string(),
    since: z.string(),
    runs: z.object({ considered: z.number().int(), withFindings: z.number().int(), results: z.number().int(), claims: z.number().int() }).catchall(z.unknown()),
    items: z.array(feedItemSchema),
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
    findings: findingsSchema.nullable().optional(),
    progress: runProgressSchema.nullable().optional(),
  })
  .catchall(z.unknown())

// ---------------------------------------------------------------------------------------------------------
// Profile versions of a play: `plays/<id>/profiles`, written by discovery-lab `disco profiles index`.
// ---------------------------------------------------------------------------------------------------------
const profileDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const contentRef = z.object({ bytes: z.number().int().nonnegative(), sha256: z.string() }).catchall(z.unknown())

/** How a profile came from its parent. `authored`: written at runtime by an agent running the parent; `replaced`: a
 * worker restarted in place of the parent's worker; `revision`: a later version of the parent; `treatment`: the parent is
 * its control arm and this one adds the manipulated change. */
export const profileRelations = ['authored', 'replaced', 'revision', 'treatment'] as const
/** `recorded`: written at creation by the system that created the profile; `inferred`: reconstructed afterwards from
 * records that prove it. */
export const profileBases = ['recorded', 'inferred'] as const

/** Unknown, a readout's judges, or a version chain's judge score: both known variants share `status`, so a plain union. */
export const profileScoreSchema = z.union([
  z.object({ status: z.literal('unknown'), reason: z.string() }).catchall(z.unknown()),
  z
    .object({
      status: z.literal('known'),
      source: z.literal('readout'),
      path: z.string(),
      generatedAt: z.string().nullable(),
      judges: z.array(
        z
          .object({ category: z.string(), score: z.number().nullable(), max: z.number(), calibrated: z.boolean() })
          .catchall(z.unknown()),
      ),
      verdicts: z.array(z.object({ id: z.string(), verdict: z.string() }).catchall(z.unknown())),
    })
    .catchall(z.unknown()),
  z
    .object({
      status: z.literal('known'),
      source: z.literal('version-judge'),
      score: z.number().nullable(),
      judgeDigest: z.string().nullable(),
      ledger: z.string(),
    })
    .catchall(z.unknown()),
])

/** A split's mean score and how many units it covers. */
const splitScore = z.object({ mean: z.number(), units: z.number().int() }).catchall(z.unknown()).nullable().optional()

/** One search's view of one version (discovery-lab `disco profiles index`, from the search ledger). */
const nodeSearchSchema = z
  .object({
    searchId: z.string(),
    kind: z.string().nullable().optional(),
    runId: z.string().nullable().optional(),
    nodeId: z.string().nullable().optional(),
    registeredAt: z.string().nullable().optional(),
    scores: z.object({ train: splitScore, selection: splitScore, test: splitScore }).catchall(z.unknown()).nullable().optional(),
    cost: z.object({ usd: z.number().nullable(), cells: z.number().nullable().optional(), unknownCells: z.number().nullable().optional() }).catchall(z.unknown()).nullable().optional(),
    decisions: z
      .array(
        z
          .object({
            status: z.string(),
            reason: z.string().nullable().optional(),
            rule: z.string().nullable().optional(),
            at: z.string().nullable().optional(),
            basis: z
              .object({ against: z.string().nullable().optional(), split: z.string(), pairs: z.number(), delta: z.number(), interval: z.array(z.number()).nullable().optional(), method: z.string().nullable().optional() })
              .catchall(z.unknown())
              .nullable()
              .optional(),
          })
          .catchall(z.unknown()),
      )
      .optional(),
  })
  .catchall(z.unknown())

/** One role's scorecard in one run, as a profile version carries it (discovery-lab runner/profiles.mjs `scorecardSummary`). */
export const roleScorecardSummarySchema = z
  .object({
    runId: z.string(),
    role: z.string(),
    builtAt: z.string().nullable().optional(),
    burden: z.object({ total: z.number() }).catchall(z.unknown()),
    blockers: z.object({ total: z.number(), bySeverity: z.record(z.string(), z.number()), byClass: z.record(z.string(), z.number()) }).catchall(z.unknown()),
    regressions: z.number(),
    rework: z.number(),
    expectations: z.object({ status: z.string(), owned: z.number(), met: z.number(), partial: z.number(), missing: z.number() }).catchall(z.unknown()),
    milestones: z.object({ count: z.number(), done: z.number(), medianMs: z.number().nullable() }).catchall(z.unknown()),
    cost: z
      .object({
        acceptedPages: z.number(),
        perAcceptedPage: z.object({ usd: z.number(), outputTokens: z.number(), complete: z.boolean() }).catchall(z.unknown()).nullable(),
        unmeasuredNodes: z.number(),
      })
      .catchall(z.unknown()),
  })
  .catchall(z.unknown())

const blockerItemSchema = z
  .object({
    id: z.string(),
    severity: z.string(),
    class: z.string(),
    owners: z.array(z.string()),
    basis: z.string(),
    writers: z.array(z.string()).optional(),
    pages: z.array(z.string()).optional(),
    raisedAt: z.string().nullable().optional(),
    source: z.string(),
    summary: z.string(),
    resolves: z.string().optional(),
  })
  .catchall(z.unknown())

/** One role of one run in full (discovery-lab runner/role-scorecard.mjs). */
export const roleCardSchema = z
  .object({
    role: z.string(),
    digests: z.array(z.string()),
    harness: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    nodes: z.number(),
    milestones: z
      .object({
        count: z.number(),
        done: z.number(),
        medianMs: z.number().nullable(),
        items: z.array(z.object({ nodeId: z.string(), label: z.string().nullable(), status: z.string().nullable(), ms: z.number().nullable() }).catchall(z.unknown())),
      })
      .catchall(z.unknown()),
    expectations: z.object({ status: z.string(), owned: z.number(), met: z.number(), partial: z.number(), missing: z.number(), reason: z.string().optional(), source: z.string().optional() }).catchall(z.unknown()),
    blockers: z
      .object({
        total: z.number(),
        bySeverity: z.record(z.string(), z.number()),
        byClass: z.record(z.string(), z.object({ count: z.number(), weight: z.number(), ids: z.array(z.string()) }).catchall(z.unknown())),
        items: z.array(blockerItemSchema),
      })
      .catchall(z.unknown()),
    regressions: z.array(z.object({ tag: z.string(), from: z.string(), checks: z.array(z.string()), share: z.number() }).catchall(z.unknown())),
    rework: z.object({ cycles: z.number(), items: z.array(z.object({ id: z.string(), cycles: z.number() }).catchall(z.unknown())) }).catchall(z.unknown()),
    cost: z
      .object({
        usd: z.number().nullable(),
        measuredNodes: z.number(),
        unmeasuredNodes: z.array(z.string()),
        acceptedPages: z.number(),
        acceptedAt: z.string().nullable(),
        perAcceptedPage: z.object({ usd: z.number(), outputTokens: z.number(), complete: z.boolean() }).catchall(z.unknown()).nullable(),
      })
      .catchall(z.unknown()),
    burden: z.object({ total: z.number(), blockers: z.number(), regressions: z.number(), expectations: z.number(), rework: z.number() }).catchall(z.unknown()),
  })
  .catchall(z.unknown())

/** A run's role scorecard: every role, the blocker classes, regressions between tags, and the role versions delivered to it. */
export const runRoleCardSchema = z
  .object({
    available: z.boolean(),
    reason: z.string().optional(),
    runId: z.string().optional(),
    builtAt: z.string().optional(),
    best: z.object({ tag: z.string() }).catchall(z.unknown()).nullable().optional(),
    classes: z.record(z.string(), z.number()).optional(),
    regressions: z
      .array(z.object({ tag: z.string(), from: z.string(), checks: z.array(z.string()), infrastructure: z.boolean(), shares: z.record(z.string(), z.number()) }).catchall(z.unknown()))
      .optional(),
    edits: z
      .array(
        z
          .object({
            operationId: z.string(),
            role: z.string(),
            digest: z.string().nullable(),
            markers: z.array(z.string()),
            deliveredAt: z.string().nullable(),
            effect: z.string(),
            adopted: z.object({ nodeId: z.string(), label: z.string().nullable(), at: z.string().nullable() }).catchall(z.unknown()).nullable(),
            /** Weak evidence: the role's blockers of the edit's classes per critique, before and after adoption. */
            measured: z
              .object({
                label: z.string(),
                before: z.object({ critiques: z.number(), blockers: z.number(), perCritique: z.number().nullable() }),
                after: z.object({ critiques: z.number(), blockers: z.number(), perCritique: z.number().nullable() }),
              })
              .catchall(z.unknown())
              .nullable()
              .optional(),
          })
          .catchall(z.unknown()),
      )
      .optional(),
    roles: z.array(roleCardSchema).optional(),
  })
  .catchall(z.unknown())

/** A role version's edit: each rule with the referee blockers it cites, the size budget, and its replay decision. */
export const roleEditSchema = z
  .object({
    role: z.string(),
    target: z.string().nullable().optional(),
    rules: z.array(
      z
        .object({
          id: z.string(),
          label: z.string().optional(),
          text: z.string(),
          check: z.string().optional(),
          weight: z.number().optional(),
          evidence: z.array(
            z.object({ source: z.string(), blocker: z.string().optional(), severity: z.string().optional(), raisedAt: z.string().nullable().optional(), note: z.string().optional() }).catchall(z.unknown()),
          ),
        })
        .catchall(z.unknown()),
    ),
    budget: z.object({ before: z.number(), after: z.number(), limit: z.number() }).catchall(z.unknown()).nullable().optional(),
    evidenceLabel: z.string().nullable().optional(),
    replay: z
      .object({
        decision: z.string(),
        reason: z.string().nullable().optional(),
        lift: z.number().nullable().optional(),
        liftInterval: z.object({ low: z.number(), high: z.number() }).catchall(z.unknown()).nullable().optional(),
        checksFell: z.array(z.string()).optional(),
        library: z.string().optional(),
        tieBreak: z.string().nullable().optional(),
        source: z.string().optional(),
      })
      .catchall(z.unknown())
      .nullable()
      .optional(),
    source: z.string().optional(),
  })
  .catchall(z.unknown())

/** One record behind a parent edge (discovery-lab docs/profiles.md `Event`). */
const profileEdgeEventSchema = z
  .object({
    kind: z.string(),
    at: z.string().nullable().optional(),
    runId: z.string().nullable().optional(),
    nodeId: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
    /** A spawned or restarted agent's settlement; `metered` false means Runtime recorded no cost, so it is unknown. */
    outcome: z
      .object({ status: z.string().nullable().optional(), usd: z.number().nullable().optional(), metered: z.boolean().optional() })
      .catchall(z.unknown())
      .nullable()
      .optional(),
  })
  .catchall(z.unknown())

export const profileNodeSchema = z
  .object({
    digest: profileDigest,
    short: z.string(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    version: z.string().nullable(),
    play: z.string().nullable(),
    /** `root`: a run's registered profile; `spawned`: written at runtime by an agent; `proposed`: an optimizer search proposed it;
     * `proposal`: a readout or the role loop proposed it as a revision. */
    kind: z.enum(['root', 'spawned', 'proposed', 'proposal']),
    model: z.object({ id: z.string().nullable(), provider: z.string().nullable(), reasoningEffort: z.string().nullable() }),
    harness: z.string().nullable(),
    tools: z.array(z.string()),
    systemPrompt: z.string().nullable(),
    instructions: z.array(z.string()),
    files: z.array(contentRef.extend({ path: z.string() })),
    skills: z.array(contentRef.extend({ name: z.string() })),
    author: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('operator'), registration: z.string().nullable() }).catchall(z.unknown()),
      z
        .object({ kind: z.literal('node'), runId: z.string(), nodeId: z.string(), profileDigest: z.string().nullable() })
        .catchall(z.unknown()),
      /** A pursuit-version chain's proposer wrote it. */
      z.object({ kind: z.literal('proposer'), name: z.string(), source: z.string().nullable() }).catchall(z.unknown()),
      /** A run's readout proposed it. */
      z.object({ kind: z.literal('readout'), runId: z.string(), readout: z.string().nullable(), source: z.string() }).catchall(z.unknown()),
    ]),
    createdIn: z.string().nullable(),
    createdAt: z.string().nullable(),
    label: z.string().nullable(),
    budget: z.record(z.string(), z.number()).nullable(),
    parents: z.array(
      z
        .object({
          digest: profileDigest,
          relation: z.enum(profileRelations),
          basis: z.enum(profileBases),
          primary: z.boolean(),
          evidence: z.array(z.object({ source: z.string(), note: z.string() }).catchall(z.unknown())),
          /** `within-run` for `authored` and `replaced`, `across-run` for `revision` and `treatment`. */
          level: z.enum(['within-run', 'across-run']).optional(),
          /** The records that made the edge: a spawn or restart in a run (with that agent's outcome and cost), or the
           * run that registered, proposed or searched the version. */
          events: z.array(profileEdgeEventSchema).optional(),
        })
        .catchall(z.unknown()),
    ),
    runs: z.array(
      z
        .object({
          runId: z.string(),
          nodeIds: z.array(z.string()),
          outcome: z.string().nullable(),
          run: z.object({ state: z.string().nullable(), reason: z.string().nullable() }).catchall(z.unknown()),
          score: profileScoreSchema,
        })
        .catchall(z.unknown()),
    ),
    /** The optimizer searches that evaluated this version: its scores per split, its evaluation cost and the decisions. */
    searches: z.array(nodeSearchSchema).optional(),
    /** Each run a role ran this version in, with that role's scorecard there. */
    scorecards: z.array(roleScorecardSummarySchema).optional(),
    /** A role version's rules, the evidence each cites, and its replay decision. */
    edit: roleEditSchema.nullable().optional(),
  })
  .catchall(z.unknown())

/** One optimizer search over a play's profile (`searches` in the profile index): its policy, its claim and its curve. */
export const profileSearchSchema = z
  .object({
    searchId: z.string(),
    kind: z.string().nullable().optional(),
    runId: z.string().nullable().optional(),
    policy: z.record(z.string(), z.unknown()).nullable().optional(),
    ranking: z.string().nullable().optional(),
    openedAt: z.string().nullable().optional(),
    closedAt: z.string().nullable().optional(),
    closeReason: z.string().nullable().optional(),
    claim: z
      .object({
        decision: z.string(),
        reason: z.string().nullable().optional(),
        selected: z.string().nullable().optional(),
        finalists: z
          .array(
            z
              .object({
                digest: z.string(),
                promote: z.boolean().nullable().optional(),
                test: z.object({ pairs: z.number(), delta: z.number(), low: z.number(), high: z.number() }).catchall(z.unknown()).nullable().optional(),
              })
              .catchall(z.unknown()),
          )
          .optional(),
      })
      .catchall(z.unknown())
      .nullable()
      .optional(),
    /** The best version so far against cumulative evaluation cost, one point per change of best. */
    curve: z
      .array(
        z
          .object({
            at: z.string(),
            usd: z.number(),
            unknownCost: z.number().nullable().optional(),
            versions: z.number().int(),
            best: z.object({ digest: z.string(), score: z.number() }).catchall(z.unknown()).nullable(),
          })
          .catchall(z.unknown()),
      )
      .optional(),
  })
  .catchall(z.unknown())

/** For one version, each line of its prompt and the version that introduced it. */
export const profileBlameSchema = z
  .object({
    digest: z.string(),
    complete: z.boolean().optional(),
    versions: z.array(z.string()).optional(),
    rows: z.array(z.object({ field: z.string(), text: z.string(), introducedBy: z.string().nullable() }).catchall(z.unknown())),
  })
  .catchall(z.unknown())

const diffLine = z.object({ op: z.enum([' ', '+', '-', '@']), text: z.string() })
const fileRef = z.object({ path: z.string(), bytes: z.number().int().nonnegative(), sha256: z.string() }).catchall(z.unknown())

export const profileDiffFieldSchema = z.discriminatedUnion('kind', [
  z.object({ field: z.string(), kind: z.literal('value'), from: z.string().nullable(), to: z.string().nullable() }),
  z.object({ field: z.string(), kind: z.literal('set'), added: z.array(z.string()), removed: z.array(z.string()), kept: z.number().int().nonnegative() }),
  z.object({ field: z.string(), kind: z.literal('text'), added: z.number().int().nonnegative(), removed: z.number().int().nonnegative(), lines: z.array(diffLine) }),
  z.object({
    field: z.string(),
    kind: z.literal('files'),
    added: z.array(fileRef),
    removed: z.array(fileRef),
    changed: z.array(
      z.object({
        path: z.string(),
        from: z.string(),
        to: z.string(),
        added: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
        lines: z.array(diffLine),
      }),
    ),
  }),
])

export const profileDiffSchema = z
  .object({
    from: profileDigest,
    to: profileDigest,
    relation: z.enum(profileRelations),
    basis: z.enum(profileBases),
    identical: z.boolean(),
    fields: z.array(profileDiffFieldSchema),
    scoreDelta: z.discriminatedUnion('status', [
      z.object({ status: z.literal('unknown'), reason: z.string() }).catchall(z.unknown()),
      z
        .object({
          status: z.literal('known'),
          source: z.enum(['readout', 'version-judge']),
          categories: z.array(
            z.object({
              category: z.string(),
              from: z.number().nullable(),
              to: z.number().nullable(),
              delta: z.number().nullable(),
              calibrated: z.boolean(),
            }),
          ),
          note: z.string(),
        })
        .catchall(z.unknown()),
    ]),
  })
  .catchall(z.unknown())

/** Every profile version used or registered in a play, with its parents, runs, scores and diffs. */
export const profileGraphDocumentSchema = z
  .object({
    schema: z.literal('discovery-lab.profile-graph'),
    play: z.string(),
    builtAt: z.string(),
    nodes: z.array(profileNodeSchema),
    /** Keyed `${parentDigest}..${childDigest}`, one per parent edge whose relation is not `authored`. */
    diffs: z.record(z.string(), profileDiffSchema),
    /** Optimizer searches over this play's profiles. */
    searches: z.array(profileSearchSchema).optional(),
    /** Keyed by version digest. */
    blame: z.record(z.string(), profileBlameSchema).optional(),
    /** Keyed by run id: the whole role scorecard of each run whose roles ran a version of this play. */
    scorecards: z.record(z.string(), runRoleCardSchema).optional(),
  })
  .catchall(z.unknown())

/** One check a release evaluator ran on a tagged candidate. */
const releaseResultSchema = z
  .object({
    id: z.string(),
    tier: z.string(),
    pass: z.boolean(),
    value: z.unknown().optional(),
    evidence: z.string().optional(),
    error: z.string().optional(),
  })
  .catchall(z.unknown())

/** A run's versioned artifacts (`runs/<id>/versions`, discovery-lab `runner/version-graph.mjs`): every commit of its
 * `deliverables.git` with the lane (branch) that made it and the worker and trace that wrote it, deliverable writes and
 * spawned profiles in one graph, and every release tag with its latest score, rank and flags. */
export const versionGraphDocumentSchema = z
  .object({
    kind: z.literal('agent-workspace.version-graph'),
    runId: z.string(),
    available: z.boolean(),
    reason: z.string().optional(),
    refsDigest: z.string().nullable().optional(),
    builtAt: z.string().optional(),
    /** The run's role scorecard (discovery-lab runner/role-scorecard.mjs). */
    roles: runRoleCardSchema.optional(),
    rule: z.string().optional(),
    lanes: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            kind: z.string(),
            head: z.string(),
            director: z.string().nullable(),
            commits: z.number(),
          })
          .catchall(z.unknown()),
      )
      .default([]),
    commits: z
      .array(
        z
          .object({
            id: z.string(),
            parents: z.array(z.string()),
            at: z.string(),
            subject: z.string(),
            lane: z.string(),
            kind: z.string(),
            files: z.array(z.object({ status: z.string(), path: z.string() })),
            author: z.object({ id: z.string().nullable(), label: z.string(), name: z.string() }).catchall(z.unknown()),
            director: z.string().nullable(),
            model: z.string().nullable(),
            spendUsd: z.number().nullable(),
            trace: z.object({ node: z.string().nullable(), trace: z.string().nullable(), session: z.string().nullable() }).nullable(),
            spawned: z.string().optional(),
            profileDigest: z.string().optional(),
            body: z.string(),
          })
          .catchall(z.unknown()),
      )
      .default([]),
    tags: z
      .array(
        z
          .object({
            name: z.string(),
            commit: z.string(),
            at: z.string().nullable(),
            by: z.string().nullable(),
            message: z.string(),
            attempts: z.number(),
            score: z
              .object({
                complete: z.boolean(),
                scoredAt: z.string().nullable(),
                set: z.object({ source: z.string().nullable(), digest: z.string().nullable() }).catchall(z.unknown()).nullable(),
                vector: z.object({
                  exact: z.tuple([z.number(), z.number()]),
                  heldOut: z.tuple([z.number(), z.number()]),
                  blockers: z.number().nullable(),
                  judge: z.number().nullable(),
                }),
                results: z.array(releaseResultSchema),
              })
              .nullable(),
            best: z.boolean(),
            flags: z.array(z.object({ kind: z.string(), tag: z.string(), from: z.string(), checks: z.array(z.string()) }).catchall(z.unknown())),
          })
          .catchall(z.unknown()),
      )
      .default([]),
    best: z.string().nullable().optional(),
    flags: z.array(z.object({ kind: z.string(), tag: z.string(), from: z.string(), checks: z.array(z.string()) }).catchall(z.unknown())).default([]),
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
export type Findings = z.infer<typeof findingsSchema>
export type ScientificReview = z.infer<typeof scientificReviewSchema>
export type Publication = z.infer<typeof publicationSchema>
export type FindingsFeedDocument = z.infer<typeof findingsFeedSchema>
export type FeedItem = z.infer<typeof feedItemSchema>

type Bin = { lo: number; hi: number; n: number }
/** The Discovery overview (`agent-workspace.overview.v1`, served at `overview`): runs, findings, tokens, money, the
 * sandbox fleet, storage and subscription seats over its `days`. Every series is aligned to `days`. */
/** A run's lead finding on the overview: its result ledger, else its newest result, else its newest claim. */
export interface OverviewLead { title: string | null; kind: 'result' | 'claim'; agentLabel?: string | null; at?: string | null; text?: string; sha256?: string | null; runId?: string }
export interface OverviewRun {
  runId: string; state: string; startedAt: string | null; activeAt: string | null; agents: number | null; depth: number | null
  results: number; claims: number; findingsPending?: boolean; lead: OverviewLead | null; lostHours: number; listUsd: number; paidUsd: number
  /** Subscription use priced at API list (not billed), model API billed through Router, sandbox compute billed. */
  subscriptionUsd?: number; apiUsd?: number | null; sandboxUsd?: number | null
  play: string; title: string; purpose: string | null; supersedes?: string | null
}
export interface OverviewPlayWeek {
  play: string; title: string; running: number; runs: { runId: string; state: string; startedAt: string | null; lostHours: number }[]; runCount: number
  results: number; claims: number; findingsPending?: number; lead: OverviewLead | null; lostHours: number; listUsd: number; paidUsd: number; lastStartedAt: string | null; lastActiveAt: string | null
  subscriptionUsd?: number; apiUsd?: number | null; sandboxUsd?: number | null; costUnknownRuns?: number
  apiKnownRuns?: number; sandboxKnownRuns?: number
}
export interface OverviewAttention { tone: 'crit' | 'warn' | 'info'; text: string; detail?: string | null; href?: string; owner?: string; next?: string }

export interface OverviewDocument {
  schema: 'agent-workspace.overview.v1'
  now?: OverviewRun[]
  week?: OverviewPlayWeek[]
  weekDays?: number
  attention?: OverviewAttention[]
  composedAt: string
  days: string[]
  state: { standdown: { reason?: string; by?: string; at?: string } | null; lastRunStart: string | null; running: number; queued: number; sandboxesRunning: number | null; sandboxesByKind: Record<string, number>; boxesUnreleased: number | null; censusAt: string | null }
  runs: { byDay: Record<string, number[]>; total: number; causes: [string, number][]; depth: [string, number][]; agentsHistogram: Bin[]; lostHoursHistogram: Bin[]; lostHours: number; lostByDay?: Record<string, number[]>; scope?: string }
  findings: { byDay: Record<string, number[]>; runsByDay?: number[]; runsWithFindings: number; claims: number; pending?: number; pendingByDay?: number[] }
  tokens: {
    byDay: { input: number[]; output: number[]; cacheRead: number[]; cacheWrite: number[] }
    harness: { harness: string; agents: number; measured: number; output: number; list: number }[]
    agentOutputHistogram: Bin[]
    topPlays: { play: string; output: number; input: number; cacheRead: number; list: number; paid: number; subscription?: number; api?: number | null; sandbox?: number | null; apiKnown?: number; sandboxKnown?: number; runs: number; claims: number }[]
  }
  money: {
    costByDay?: { subscription: (number | null)[]; otherList: (number | null)[]; api: (number | null)[]; sandbox: (number | null)[] }
    costTotals?: { subscription: number; otherList: number; api: number; sandbox: number }
    costRuns?: { counted: number; snapshots: number; subscription: number; otherList: number; api: number; sandbox: number }
    infra?: {
      schema: 'discovery-infra-cost.v1'; generatedAt: string; window: { from: string | null; to: string; basis?: string }
      totals: { hostUsd: number | null; volumeUsd: number | null; snapshotUsd: number | null; r2Usd: number | null; r2ListUsd?: number | null; r2StorageListUsd?: number | null; r2OperationsListUsd?: number | null; r2EgressUsd?: number | null; egressBytes: number | null; egressUsd: number | null; r2DownloadBytesLowerBound?: number | null }
      byDay: { date: string; hostUsd: number | null; volumeUsd: number | null; snapshotUsd: number | null; r2Usd: number | null; r2ListUsd?: number | null; r2StorageListUsd?: number | null; r2OperationsListUsd?: number | null; r2ClassARequests?: number | null; r2ClassBRequests?: number | null; r2EgressUsd?: number | null; egressBytes: number | null; egressUsd: number | null; r2DownloadBytesLowerBound?: number | null }[]
      hosts: { id: number | string; name: string | null; monthlyUsd: number | null; discoverySidecars?: number; discoveryShare: number | null; discoveryUsd: number | null; outgoingBytes: number | null; includedTrafficBytes?: number | null; egressUsd: number | null }[]
      storage: { volumes: unknown[]; hetznerSnapshots: unknown[]; r2Buckets: unknown[]; traces: { path: string; usedBytes: number | null; usd: number | null } | null }
      runs: { runId: string; hostUsd: number | null; storageUsd: number | null; egressBytes: number | null; egressUsd: number | null }[]
      gaps: { code: string; detail: string }[]
      reconciliation?: { status: string; period: string; billedUsd: number | null; estimatedUsd: number | null; reason: string; priorBillEvidence: { vendor: string; item: string; monthlyUsd: number; asOf: string }[] }
      sources?: Record<string, unknown>
    }
    listByDay: number[]; paidByDay: number[]; listTotal: number; paidTotal: number; runListHistogram: Bin[]; runPaidHistogram: Bin[]; fleetKey: { cap: number | null; spent: number | null; debits48h: number | null; history?: [number, number][] } }
  fleet: {
    hosts: { name: string; type: string; active: number; parked: number; capacity: number; cpu: number | null; memory: number | null; monthlyUsd: number | null; autoScaled: boolean; draining: boolean }[]
    utilization: Record<string, number>
    totals: Record<string, number | null>
    waste: { label: string; boxes: number; hours: number | null; waste: boolean }[]
    reaper: Record<string, number>
    history: [number, number, number, number, number][]
  }
  storage: { volume: { path: string; total: number; used: number; free: number } | null; recordsBytes: number | null; byProgram: [string, number][]; runSizeHistogram: Bin[] }
  seats: { now: { tool: string; email: string; status: string; h5: number | null; d7: number | null }[]; history: Record<string, [number, number][]> }
}
export type FindingItem = z.infer<typeof findingItemSchema>
export type Readout = z.infer<typeof readoutSchema>
export type OutputFile = z.infer<typeof outputFile>
export type ProgressBrief = z.infer<typeof progressBriefSchema>
export type RunProgress = z.infer<typeof runProgressSchema>
export type HumanGrade = z.infer<typeof humanGradeSchema>
export type PanelReview = z.infer<typeof panelReviewSchema>
export type ReadoutChart = NonNullable<Readout['charts']>[number]
export type VersionGraphDocument = z.infer<typeof versionGraphDocumentSchema>
export type VersionCommit = VersionGraphDocument['commits'][number]
export type VersionTag = VersionGraphDocument['tags'][number]
export type ProfileGraphDocument = z.infer<typeof profileGraphDocumentSchema>
export type ProfileNode = z.infer<typeof profileNodeSchema>
export type ProfileParent = ProfileNode['parents'][number]
export type ProfileRun = ProfileNode['runs'][number]
export type ProfileEdgeEvent = z.infer<typeof profileEdgeEventSchema>
export type ProfileScore = z.infer<typeof profileScoreSchema>
export type ProfileDiff = z.infer<typeof profileDiffSchema>
export type ProfileDiffField = z.infer<typeof profileDiffFieldSchema>
export type RoleScorecardSummary = z.infer<typeof roleScorecardSummarySchema>
export type RoleCard = z.infer<typeof roleCardSchema>
export type RunRoleCard = z.infer<typeof runRoleCardSchema>
export type RoleEdit = z.infer<typeof roleEditSchema>
export type ProfileSearch = z.infer<typeof profileSearchSchema>
export type ProfileBlame = z.infer<typeof profileBlameSchema>
