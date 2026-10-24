import { viewSchema, viewStatusSchema } from './view.js'
import { z } from 'zod'
import { calibrationSchema, calibrationState } from '../run-check-model.js'

/**
 * The focused play page's document: what the play is trying to do, where it stands under its current check, the
 * distance to its declared bar, what blocks its live run, and the climb, ledger, findings and releases behind that.
 * The host (tangle-tools fleet/discovery_workspace.py, data contract B1) composes every sentence and verdict; the
 * renderer only draws them. Every field is optional, so a play or index group the host cannot score renders what it has.
 */

const n = z.number().nullable()
const s = z.string().nullable()

/** A check stage reached: `reached` of `of`, the stage's name, and workloads passed of total when the check prints them. */
const workloads = z.object({ passed: n, total: n }).catchall(z.unknown()).nullable()

/** Why a block began, when the Lab found it: the provider error opencode logged as a stuck turn opened (a 429). */
const blockerCause = z
  .object({ kind: s.optional(), provider: s.optional(), model: s.optional(), at: s.optional(), error: s.optional(), source: s.optional() })
  .catchall(z.unknown())
  .nullable()
  .optional()

export const playBlockerSchema = z
  .object({
    class: z.string(),
    severity: z.enum(['red', 'amber']).or(z.string()),
    since: s.optional(),
    evidence: s.optional(),
    source: s.optional(),
    owner: s.optional(),
    cause: blockerCause,
    also: z.array(z.object({ class: z.string(), since: s.optional(), evidence: s.optional(), source: s.optional(), cause: blockerCause }).catchall(z.unknown())).optional(),
  })
  .catchall(z.unknown())

/** The best row of a play under one checker: which release, its verdict and how far it got. */
export const playBestSchema = z
  .object({
    checker: s.optional(),
    tag: s.optional(),
    runId: s.optional(),
    columnId: s.optional(),
    verdict: s.optional(),
    stage: s.optional(),
    reached: n.optional(),
    of: n.optional(),
    workloads: workloads.optional(),
    progress: n.optional(),
    line: s.optional(),
    at: s.optional(),
    count: n.optional(),
    firstAt: s.optional(),
    lastAt: s.optional(),
    supersededBy: s.optional(),
    state: s.optional(),
  })
  .catchall(z.unknown())

export const playCheckerSchema = z
  .object({
    sha256: z.string(),
    label: z.string(),
    firstAt: s.optional(),
    runIds: z.array(z.string()).optional(),
    ruling: z.object({ at: s, by: s, verdict: s, label: s.optional(), reason: s }).catchall(z.unknown()).nullable().optional(),
    current: z.boolean().optional(),
    rows: n.optional(),
  })
  .catchall(z.unknown())

const barValue = z
  .object({
    value: z.number(),
    columnId: s.optional(),
    tag: s.optional(),
    runId: s.optional(),
    checker: s.optional(),
    verdict: s.optional(),
    comparable: z.boolean().nullable().optional(),
    why: s.optional(),
    /** The words the bar row prints for a value that does not count: `failing candidate (4/15)`, `not comparable: 1-bit declared`. */
    short: s.optional(),
    workloads: workloads.optional(),
  })
  .catchall(z.unknown())

export const playBarMetricSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    unit: z.string(),
    scale: z.enum(['log', 'linear']).optional(),
    direction: z.enum(['up', 'down']).optional(),
    target: z.object({ min: n.optional(), max: n.optional(), approx: n.optional() }).catchall(z.unknown()).nullable().optional(),
    stretch: z.object({ min: n.optional(), max: n.optional(), label: s.optional() }).catchall(z.unknown()).nullable().optional(),
    precondition: z.boolean().optional(),
    best: barValue.nullable().optional(),
    nearest: barValue.nullable().optional(),
    missing: z.object({ why: z.string() }).nullable().optional(),
  })
  .catchall(z.unknown())

export const playBarSchema = z
  .object({ path: s.optional(), digest: s.optional(), source: s.optional(), condition: s.optional(), checkCondition: s.optional(), metrics: z.array(playBarMetricSchema) })
  .catchall(z.unknown())

/** Each `T+Nh` clause of a run's prediction: when it fell due and what was measured by then (null while due). */
const killCheckpointsSchema = z.array(
  z
    .object({
      label: z.string(),
      at: s.optional(),
      clause: s.optional(),
      due: z.boolean().optional(),
      measured: z
        .object({
          publishedTags: n.optional(),
          bestStage: z.union([z.string(), z.object({ reached: n.optional(), of: n.optional(), stage: s.optional(), tag: s.optional() }).catchall(z.unknown())]).nullable().optional(),
          checksOnCommit: n.optional(),
        })
        .catchall(z.unknown())
        .nullable()
        .optional(),
    })
    .catchall(z.unknown()),
)

export const playStandingSchema = z
  .object({
    status: z.string(),
    sentence: z.string(),
    current: playBestSchema.nullable().optional(),
    bestCurrent: playBestSchema.nullable().optional(),
    bestEver: playBestSchema.nullable().optional(),
    /**
     * Published releases and, under the current checker, how many it checked, how many pass and how many it never
     * checked (`checkedCurrent`, `passingCurrent`, `neverCheckedCurrent`), with the source of the counts.
     */
    releases: z
      .object({
        published: n,
        checked: n,
        withheld: n,
        superseded: n,
        passingCurrent: n,
        neverChecked: n,
        checker: s,
        checkedCurrent: n,
        checkedCurrentTags: z.array(z.string()),
        neverCheckedCurrent: n,
        source: s,
      })
      .partial()
      .catchall(z.unknown())
      .nullable()
      .optional(),
    lastEnding: z
      .object({
        runId: z.string(),
        run: s.optional(),
        word: z.string(),
        glyph: s.optional(),
        at: s.optional(),
        reason: s.optional(),
        startedAt: s.optional(),
        wallHours: n.optional(),
        /** The run's status as its run page shows it (views.row_status). */
        status: viewStatusSchema.optional(),
        // What blocked the last run when it ended, and its prediction's kill checkpoints with what was measured by each.
        blocker: playBlockerSchema.nullable().optional(),
        killCheckpoints: killCheckpointsSchema.optional(),
      })
      .catchall(z.unknown())
      .nullable()
      .optional(),
    cost: z
      .object({
        apiEquivalentUsd: n.optional(),
        provenance: s.optional(),
        priced: n.optional(),
        started: n.optional(),
        unpriced: z.array(z.string()).optional(),
        unmetered: z.array(z.string()).optional(),
        neverStarted: z.array(z.string()).optional(),
        seatNow: z.object({ seat: s, kind: s }).catchall(z.unknown()).nullable().optional(),
        billed: z.union([z.string(), z.number()]).nullable().optional(),
      })
      .catchall(z.unknown())
      .nullable()
      .optional(),
  })
  .catchall(z.unknown())

export const playLiveSchema = z
  .object({
    runId: z.string(),
    run: s.optional(),
    startedAt: s.optional(),
    elapsedMs: n.optional(),
    word: s.optional(),
    blocker: playBlockerSchema.nullable().optional(),
    killCheckpoints: killCheckpointsSchema.optional(),
  })
  .catchall(z.unknown())

const lineage = z
  .object({ kind: z.string(), parentRun: s.optional(), parentTag: s.optional(), commit: s.optional(), basis: s.optional(), why: s.optional() })
  .catchall(z.unknown())
  .nullable()

export const playClimbSchema = z
  .object({
    groups: z.array(
      z
        .object({
          runId: z.string(),
          label: z.string(),
          from: s.optional(),
          to: s.optional(),
          end: z.object({ kind: z.string(), glyph: s.optional(), label: s.optional() }).catchall(z.unknown()).nullable().optional(),
          checked: n.optional(),
          published: n.optional(),
          withheld: n.optional(),
          superseded: n.optional(),
          noTag: n.optional(),
          unscored: z.boolean().optional(),
          lineage: lineage.optional(),
          summary: s.optional(),
          /** Check rows of this run on no release tag, and the newest one's reason when the run has no checked tag. */
          untagged: n.optional(),
          note: s.optional(),
          /** Each stage's calibration as the run's check registered it, and a pass held for its uncalibrated stages. */
          calibration: calibrationSchema.nullable().optional(),
          held: z.object({ stages: z.array(z.string()), label: s.optional() }).catchall(z.unknown()).nullable().optional(),
        })
        .catchall(z.unknown()),
    ),
    columns: z.array(
      z
        .object({
          id: z.string(),
          runId: z.string(),
          tag: s.optional(),
          commit: s.optional(),
          order: z.number().optional(),
          at: s.optional(),
          state: s.optional(),
          weight: n.optional(),
          /** Releases the gate only superseded, folded into this one column (`rc8–rc12 superseded`). */
          tags: z.array(z.string()).optional(),
          label: s.optional(),
        })
        .catchall(z.unknown()),
    ),
    gaps: z.array(z.object({ afterColumnId: z.string(), hours: z.number() }).catchall(z.unknown())).optional(),
    y: z.object({ label: s.optional(), gridlines: z.array(z.object({ at: z.number(), label: z.string() })).optional() }).catchall(z.unknown()).nullable().optional(),
    marks: z.array(
      z
        .object({
          id: z.string(),
          columnId: z.string(),
          kind: z.string(),
          scope: s.optional(),
          checker: s.optional(),
          verdict: z.string(),
          progress: n,
          count: n.optional(),
          firstAt: s.optional(),
          lastAt: s.optional(),
          stage: s.optional(),
          reached: n.optional(),
          of: n.optional(),
          workloads: workloads.optional(),
          line: s.optional(),
          source: s.optional(),
          /** The calibration state the verdict's check registered (its run group carries each stage's). */
          calibration: calibrationState.nullable().optional(),
        })
        .catchall(z.unknown()),
    ),
    strip: z
      .array(
        z
          .object({
            columnId: s.optional(),
            runId: z.string(),
            kind: z.string(),
            checker: s.optional(),
            verdict: z.string(),
            count: n.optional(),
            firstAt: s.optional(),
            lastAt: s.optional(),
            line: s.optional(),
            source: s.optional(),
            calibration: calibrationState.nullable().optional(),
            // The score an undecided gate printed before it timed out: drawn in the hover, never on the axis.
            score: z.object({ stage: s.optional(), reached: n.optional(), of: n.optional(), workloads: z.object({ passed: n.optional(), total: n.optional() }).nullable().optional() }).catchall(z.unknown()).nullable().optional(),
          })
          .catchall(z.unknown()),
      )
      .optional(),
    rulings: z
      .array(
        z
          .object({ at: z.string(), dispute: s.optional(), verdict: z.string(), by: s.optional(), line: s.optional(), reason: s.optional(), newDigest: s.optional(), checkerFrom: s.optional(), checkerTo: s.optional() })
          .catchall(z.unknown()),
      )
      .optional(),
    best: s.optional(),
    bestEver: s.optional(),
  })
  .catchall(z.unknown())

export const playBarSeriesSchema = z.array(
  z
    .object({
      metric: z.string(),
      points: z.array(z.object({ columnId: z.string(), value: z.number(), verdict: s.optional(), comparable: z.boolean().nullable().optional(), note: s.optional(), basis: s.optional() }).catchall(z.unknown())),
      missing: z.object({ why: z.string() }).nullable().optional(),
    })
    .catchall(z.unknown()),
)

export const playLedgerRowSchema = z
  .object({
    runId: z.string(),
    label: s.optional(),
    lineage: lineage.optional(),
    ending: z.object({ word: z.string(), glyph: s.optional(), reason: s.optional(), status: viewStatusSchema.optional() }).catchall(z.unknown()).nullable().optional(),
    startedAt: s.optional(),
    settledAt: s.optional(),
    wallHours: n.optional(),
    idleHours: n.optional(),
    agentHours: n.optional(),
    hoursByOutcome: z.record(z.string(), z.number()).nullable().optional(),
    triesByOutcome: z.record(z.string(), z.number()).nullable().optional(),
    outcomeBasis: s.optional(),
    outcomeNotes: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.string())]).nullable().optional(),
    open: z.object({ agent: s.optional(), since: s.optional(), hours: n.optional() }).catchall(z.unknown()).nullable().optional(),
    completedShare: n.optional(),
    contractBlockedShare: n.optional(),
    best: playBestSchema.nullable().optional(),
    cost: z.object({ apiUsd: n.optional(), provenance: s.optional(), billedUsd: n.optional() }).catchall(z.unknown()).nullable().optional(),
    seat: s.optional(),
    seatKind: s.optional(),
    tokens: z.object({ in: n.optional(), out: n.optional(), cacheRead: n.optional(), known: n.optional() }).catchall(z.unknown()).nullable().optional(),
    agents: n.optional(),
    depth: n.optional(),
    model: s.optional(),
    harness: s.optional(),
    inputDiffers: s.optional(),
  })
  .catchall(z.unknown())

export const playLedgerSchema = z
  .object({
    rows: z.array(playLedgerRowSchema),
    runsShown: n.optional(),
    runsTotal: n.optional(),
    page: n.optional(),
    olderSummary: z.object({ runs: z.number(), endings: z.record(z.string(), z.number()) }).catchall(z.unknown()).nullable().optional(),
  })
  .catchall(z.unknown())

export const playReleaseSchema = z
  .object({
    tag: z.string(),
    runId: z.string(),
    run: s.optional(),
    columnId: s.optional(),
    commit: s.optional(),
    taggedAt: s.optional(),
    firstCheckedAt: s.optional(),
    state: s.optional(),
    gate: z.object({ verdict: s, count: n.optional(), line: s.optional() }).catchall(z.unknown()).nullable().optional(),
    checks: z.record(z.string(), z.object({ verdict: s, count: n.optional(), progress: n.optional(), stage: s.optional(), of: n.optional(), workloads: workloads.optional() }).catchall(z.unknown())).optional(),
    metrics: z.record(z.string(), z.unknown()).nullable().optional(),
    findings: z.array(z.string()).optional(),
    take: z.object({ enabled: z.boolean(), why: s.optional() }).catchall(z.unknown()).nullable().optional(),
  })
  .catchall(z.unknown())

/**
 * What the play page adds to a finding (B1): what the current check says of the commits it cites (`group`), the writer
 * and time from the commit that wrote the page, the cited commits with their verdicts, and the duplicates folded into it.
 */
export const playFindingFields = {
  id: s.optional(),
  group: z.enum(['verified', 'contradicted', 'mixed', 'undecided', 'unchecked']).or(z.string()).optional(),
  writer: s.optional(),
  writtenAt: s.optional(),
  commits: z
    .array(
      z
        .object({ sha: z.string(), tag: s.optional(), run: s.optional(), verdict: s.optional(), checker: s.optional(), kind: s.optional(), line: s.optional(), at: s.optional(), workloads: workloads.optional(), reached: n.optional(), of: n.optional() })
        .catchall(z.unknown()),
    )
    .optional(),
  duplicates: z.array(z.string()).optional(),
  href: s.optional(),
}

/** The fields of data contract B1 the play page reads; each is absent on a host that predates it. */
export const playPageFields = {
  goal: z.object({ text: z.string(), full: s.optional(), source: s.optional(), runId: s.optional() }).catchall(z.unknown()).nullable().optional(),
  checkers: z.array(playCheckerSchema).optional(),
  bar: playBarSchema.nullable().optional(),
  standing: playStandingSchema.nullable().optional(),
  live: playLiveSchema.nullable().optional(),
  climb: playClimbSchema.nullable().optional(),
  barSeries: playBarSeriesSchema.nullable().optional(),
  ledger: playLedgerSchema.nullable().optional(),
  releases: z.array(playReleaseSchema).nullable().optional(),
  /** The host's one view of the play (views.play_view): status, sentence, blocker, progress, needs-you, as-of. */
  view: viewSchema.optional(),
}

export type PlayBlocker = z.infer<typeof playBlockerSchema>
export type PlayBest = z.infer<typeof playBestSchema>
export type PlayChecker = z.infer<typeof playCheckerSchema>
export type PlayBar = z.infer<typeof playBarSchema>
export type PlayBarMetric = z.infer<typeof playBarMetricSchema>
export type PlayStanding = z.infer<typeof playStandingSchema>
export type PlayLive = z.infer<typeof playLiveSchema>
export type PlayClimb = z.infer<typeof playClimbSchema>
export type PlayBarSeries = z.infer<typeof playBarSeriesSchema>
export type PlayLedger = z.infer<typeof playLedgerSchema>
export type PlayLedgerRow = z.infer<typeof playLedgerRowSchema>
export type PlayRelease = z.infer<typeof playReleaseSchema>
export type PlayHead = { [K in keyof typeof playPageFields]?: z.infer<(typeof playPageFields)[K]> }

/** The play head the host inlines in the page shell (B3), so the first screen paints before any API round trip. */
export function inlinedPlayHead(id: string): PlayHead | null {
  if (typeof document === 'undefined') return null
  const node = document.getElementById('discovery-play-head')
  if (!node?.textContent) return null
  try {
    const head = JSON.parse(node.textContent) as PlayHead & { id?: string }
    return !head.id || head.id === id ? head : null
  } catch {
    return null
  }
}

// ----- the shared vocabulary -----

/** Short UTC time: `10-18 20:52Z`. */
export const utc = (value: string | null | undefined) => {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.valueOf())) return null
  const iso = date.toISOString()
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z`
}

/** A span of hours or minutes: `2 h 42 min`, `35 min`. */
export const span = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
}

export const hours = (value: number | null | undefined, digits = 1) => (value === null || value === undefined || !Number.isFinite(value) ? null : `${value.toFixed(digits)} h`)

/** A run id without its play prefix: `20261018b`; a dated run reads as its day and letter, `18b`, as the pages say it. */
export const shortRun = (play: string, run: string | null | undefined) => {
  if (!run) return ''
  const rest = run.startsWith(play + '-') ? run.slice(play.length + 1) : run
  return /^\d{6}(\d{2}[a-z])$/.exec(rest)?.[1] ?? rest
}
/** A seat by its model, without the provider path: `glm-5.3-flash-free` for `opencode/glm-5.3-flash-free`. */
export const seatWords = (seat: string | null | undefined) => (seat ? (seat.split('/').pop() ?? seat) : null)

/** A tag without its run prefix: `rc14`. */
export const shortTag = (tag: string | null | undefined) => tag?.split('/').pop() ?? null

/**
 * Verdict words, as every page writes them, in the result grammar `statusOf` uses (design-system section 1): a miss is
 * "no pass yet", an undecided check "unverified", a missing tag "not checked". SOLVED never appears without its checker.
 */
export const VERDICT_WORDS: Record<string, string> = {
  solved: 'passed',
  'not-solved': 'no pass yet',
  'contract-held': 'contract held',
  'contract-failed': 'fails the contract',
  undecided: 'unverified',
  held: 'check passed; held',
  superseded: 'superseded',
  'no-tag': 'not checked',
}
export const verdictWord = (verdict: string | null | undefined) => (verdict ? (VERDICT_WORDS[verdict] ?? verdict.replaceAll('-', ' ')) : 'no verdict')
/** pass: solved or contract held (filled); fail: not solved or contract failed (a ring); unknown: undecided (hatched). */
export const markVerdict = (verdict: string | null | undefined): 'pass' | 'fail' | 'unknown' =>
  verdict === 'solved' || verdict === 'contract-held' ? 'pass' : verdict === 'not-solved' || verdict === 'contract-failed' ? 'fail' : 'unknown'

/**
 * Status shapes, one per meaning (design-system section 1): ✓ solved, ⊘ stopped by the operator, ⏸ stopped by the Lab,
 * ▶ running, · never started, ○ ended or no pass yet, □ a past crash, ▲ attention, ◌ (a dashed ring) unknown or
 * unverified, ■ act now. A past crash ("died") is □, never a red ✕.
 */
export const ENDING_GLYPH: Record<string, string> = {
  solved: '✓',
  died: '□',
  crashed: '□',
  cancelled: '⊘',
  stalled: '⏸',
  live: '▶',
  'never started': '·',
  ended: '○',
  attention: '▲',
  lost: '△',
  unknown: '◌',
  fail: '■',
}

/** Release states, in the four words the pages use. */
export const RELEASE_STATE: Record<string, string> = { published: 'published', withheld: 'not published', superseded: 'superseded', unknown: 'state unknown' }

/**
 * Host prose and quoted checker lines in the status grammar (design-system section 1): the words tangle-tools composes
 * (`withheld by the gate`, `cancelled after stall`, `died`) read as the pages' own (`not published`, `stopped by Lab
 * (stall)`, `crashed`), so a page uses one word per meaning whoever wrote the sentence. The host keeps its words until
 * tangle-tools changes them; this mapping is where they meet the grammar, longest phrase first.
 */
const HOST_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwithheld by the gate\b/gi, RELEASE_STATE.withheld!],
  [/\bwithheld\b/gi, RELEASE_STATE.withheld!],
  [/\bnot solved\b/gi, VERDICT_WORDS['not-solved']!],
  [/\bcancelled after (?:a )?stall\b/gi, 'stopped by Lab (stall)'],
  [/\bcancelled\b/gi, 'stopped by operator'],
  [/\bstalled\b/gi, 'stopped by Lab (stall)'],
  [/\bdriver[- ]failed\b/gi, 'crashed (driver)'],
  [/\bdied\b/gi, 'crashed'],
  [/\bnever[- ]started\b/gi, 'not started'],
  [/\bstuck\b/gi, 'hung'],
  [/\bfailed\b/gi, 'did not pass'],
  [/\bundecided\b/gi, VERDICT_WORDS.undecided!],
  [/\babsent\b/gi, 'missing'],
  // The host's "no record states a bound" is prose; "No record" is the run status for a run with nothing to read.
  [/\bno record\b/gi, 'nothing on record'],
]
const keepCase = (match: string, word: string) => (match[0] === match[0]!.toUpperCase() && match[0] !== match[0]!.toLowerCase() ? word[0]!.toUpperCase() + word.slice(1) : word)
export const hostWords = (text: string) => HOST_WORDS.reduce((out, [pattern, word]) => out.replace(pattern, (match) => keepCase(match, word)), text)

/** A checker's display label, found by digest or by label; null digests read "checker unrecorded". */
export function checkerLabel(checkers: readonly PlayChecker[] | undefined, id: string | null | undefined): string {
  if (!id) return 'checker unrecorded'
  const found = checkers?.find((item) => item.sha256 === id || item.label === id || item.sha256.startsWith(id))
  return found?.label ?? `checker ${id.slice(0, 8)}`
}

/** A checker's palette index: 0 is the current checker, then the others by first appearance. */
export function checkerIndex(checkers: readonly PlayChecker[] | undefined, id: string | null | undefined): number | undefined {
  if (!checkers?.length || !id) return undefined
  const current = checkers.find((item) => item.current)
  const found = checkers.find((item) => item.sha256 === id || item.label === id || item.sha256.startsWith(id))
  if (!found) return undefined
  if (found === current) return 0
  return checkers.filter((item) => item !== current).indexOf(found) + 1
}

/** A ruling as one phrase: its label (else reason, else who ruled) and its time, never the time twice. */
export function rulingWords(ruling: { label?: string | null; reason?: string | null; by?: string | null; at?: string | null } | null | undefined): string | null {
  if (!ruling) return null
  const text = ruling.label ?? ruling.reason ?? (ruling.by ? `${ruling.by} ruling` : 'ruling')
  const at = utc(ruling.at)
  return at && !text.includes(at) && !text.includes(at.slice(6)) ? `${text} ${at}` : text
}

/** The hover text of a checker: its label, ruling and digest. */
export function checkerTitle(checker: PlayChecker): string {
  const ruling = checker.ruling
  return [
    `${checker.label}${checker.current ? ' (current)' : ''}`,
    ruling ? `${ruling.verdict ?? 'ruling'} by ${ruling.by ?? 'unrecorded'} ${utc(ruling.at) ?? ''}${ruling.reason ? `: ${ruling.reason}` : ''}` : 'as pressed',
    `sha256 ${checker.sha256}`,
  ].join('\n')
}

/** Stage words: `stage 5 of 6 (workloads)`, `4 of 15 workloads`. */
export const stageWords = (best: { stage?: string | null; reached?: number | null; of?: number | null } | null | undefined) =>
  best?.reached !== null && best?.reached !== undefined && best.of ? `stage ${best.reached} of ${best.of}${best.stage ? ` (${best.stage})` : ''}` : null
export const workloadWords = (value: { passed: number | null; total: number | null } | null | undefined) =>
  value && value.passed !== null && value.total ? `${value.passed} of ${value.total} workloads` : null

/** Compact SI numbers for a metric's unit: 202k, 7.2M, 385,792 B → 377 KiB, 319 ms. */
export function metricValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not measured'
  const u = unit.toLowerCase()
  if (u === 'bytes' || u === 'b') {
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
    if (value >= 1024) return `${Math.round(value / 1024)} KiB`
    return `${Math.round(value)} B`
  }
  if (u === 'kib') {
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} GiB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)} MiB`
    return `${Math.round(value)} KiB`
  }
  return `${compactNumber(value)} ${unit}`.trim()
}

/** Three significant digits, compact above ten thousand: 202K, 7.2M, 319, 14.9. */
export const compactNumber = (value: number) =>
  Math.abs(value) >= 10_000
    ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 }).format(value)
    : new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3 }).format(value)

/** The unit a metric's figure reads in, and the factor from its recorded unit: bytes as KiB, KiB as MiB. */
export function displayUnit(unit: string): { unit: string; factor: number } {
  const u = unit.toLowerCase()
  if (u === 'bytes' || u === 'b') return { unit: 'KiB', factor: 1 / 1024 }
  if (u === 'kib') return { unit: 'MiB', factor: 1 / 1024 }
  return { unit, factor: 1 }
}

/**
 * A metric's display unit sized to its bar: a peak-memory bar of about 6 GiB reads in GiB (ticks 0.01, 0.1, 1, 10 GiB),
 * not as "6.0K MiB"; a bar under a gibibyte keeps `displayUnit`.
 */
export function displayUnitFor(metric: PlayBarMetric): { unit: string; factor: number } {
  const u = metric.unit.toLowerCase()
  const bounds = [metric.target?.min, metric.target?.max, metric.target?.approx, metric.stretch?.min, metric.stretch?.max].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const big = bounds.length ? Math.max(...bounds) : 0
  if (u === 'kib' && big >= 1024 * 1024) return { unit: 'GiB', factor: 1 / 1024 / 1024 }
  if ((u === 'bytes' || u === 'b') && big >= 1024 * 1024 * 1024) return { unit: 'GiB', factor: 1 / 1024 / 1024 / 1024 }
  if ((u === 'bytes' || u === 'b') && big >= 1024 * 1024) return { unit: 'MiB', factor: 1 / 1024 / 1024 }
  return displayUnit(metric.unit)
}

/** A target as written: `7.2M–8.7M c/s`, `≈ 599 KiB`, `≥ 120 bits`. */
export function targetWords(metric: PlayBarMetric): string | null {
  const t = metric.target
  if (!t) return null
  if (t.approx !== null && t.approx !== undefined) return `≈ ${metricValue(t.approx, metric.unit)}`
  if (t.min !== null && t.min !== undefined && t.max !== null && t.max !== undefined) return `${metricValue(t.min, metric.unit).replace(` ${metric.unit}`, '')}–${metricValue(t.max, metric.unit)}`
  if (t.min !== null && t.min !== undefined) return `≥ ${metricValue(t.min, metric.unit)}`
  if (t.max !== null && t.max !== undefined) return `≤ ${metricValue(t.max, metric.unit)}`
  return null
}

/** Where a value sits against a metric's target: within it, past it in the metric's better direction, or short of it. */
export function barSide(metric: PlayBarMetric, value: number | null | undefined): 'within' | 'past' | 'short' | null {
  const t = metric.target
  if (!t || value === null || value === undefined || !(value > 0)) return null
  const low = t.min ?? t.approx ?? t.max ?? null
  const high = t.max ?? t.approx ?? t.min ?? null
  if (low === null || high === null) return null
  if (value >= low && value <= high) return 'within'
  return (metric.direction === 'up' && value > high) || (metric.direction === 'down' && value < low) ? 'past' : 'short'
}

/** How far a value is from a metric's target, as text: "36× below the bar", "within the bar", "0.6× of the bar". */
export function gapWords(metric: PlayBarMetric, value: number | null | undefined): string | null {
  const t = metric.target
  if (!t || value === null || value === undefined || !(value > 0)) return null
  const low = t.min ?? t.approx ?? t.max ?? null
  const high = t.max ?? t.approx ?? t.min ?? null
  if (low === null || high === null) return null
  if (value >= low && value <= high) return 'within the bar'
  const ratio = value < low ? low / value : value / high
  const times = ratio >= 10 ? Math.round(ratio).toString() : ratio.toFixed(1)
  const better = (metric.direction === 'up' && value > high) || (metric.direction === 'down' && value < low)
  return better ? `${times}× past the bar` : `${times}× ${value < low ? 'below' : 'above'} the bar`
}

/** A check line without its verdict word, digests or the tail after ` | `: the words that say why, for grouping. */
export const lineReason = (line: string | null | undefined) =>
  hostWords(
    (line ?? '')
      .replace(/^(NOT SOLVED|SOLVED|UNKNOWN|UNDECIDED)\s*:\s*/i, '')
      .replace(/\b[0-9a-f]{7,64}\b/g, '…')
      .split(/\s\|\s/)[0]!
      .trim(),
  )

export interface RunCheckLine {
  reason: string
  line: string
  count: number
  verdicts: string[]
  checkers: string[]
  tags: string[]
  firstAt: string | null
  lastAt: string | null
}
export interface RunChecks {
  runId: string
  rows: number
  solved: number
  scored: number
  checkers: string[]
  lines: RunCheckLine[]
}

/**
 * Every check and gate row of each run, from the climb's marks and strip, with its lines grouped by reason (most rows
 * first). A run whose check prints no SCORE line still says what it failed on; nothing here is a score.
 */
export function checksByRun(climb: PlayClimb | null | undefined): Map<string, RunChecks> {
  const out = new Map<string, RunChecks>()
  if (!climb) return out
  const runOf = new Map(climb.columns.map((column) => [column.id, column.runId]))
  const tagOf = new Map(climb.columns.map((column) => [column.id, shortTag(column.tag)]))
  const rows = [
    ...climb.marks.map((mark) => ({ ...mark, runId: runOf.get(mark.columnId) ?? null, scored: mark.progress !== null })),
    ...(climb.strip ?? []).map((item) => ({ ...item, scored: false })),
  ]
  for (const row of rows) {
    if (!row.runId || row.verdict === 'superseded') continue
    let run = out.get(row.runId)
    if (!run) out.set(row.runId, (run = { runId: row.runId, rows: 0, solved: 0, scored: 0, checkers: [], lines: [] }))
    const count = row.count ?? 1
    run.rows += count
    if (row.verdict === 'solved') run.solved += count
    if (row.scored) run.scored += count
    if (row.checker && !run.checkers.includes(row.checker)) run.checkers.push(row.checker)
    const reason = lineReason(row.line) || verdictWord(row.verdict)
    let line = run.lines.find((item) => item.reason === reason)
    if (!line) run.lines.push((line = { reason, line: row.line ?? reason, count: 0, verdicts: [], checkers: [], tags: [], firstAt: null, lastAt: null }))
    line.count += count
    if (!line.verdicts.includes(row.verdict)) line.verdicts.push(row.verdict)
    if (row.checker && !line.checkers.includes(row.checker)) line.checkers.push(row.checker)
    const tag = row.columnId ? tagOf.get(row.columnId) : null
    if (tag && !line.tags.includes(tag)) line.tags.push(tag)
    const first = row.firstAt ?? null
    const last = row.lastAt ?? row.firstAt ?? null
    if (first && (!line.firstAt || first < line.firstAt)) line.firstAt = first
    if (last && (!line.lastAt || last > line.lastAt)) line.lastAt = last
  }
  for (const run of out.values()) run.lines.sort((a, b) => b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt)))
  return out
}

/** A run of release tags as a range when they are rcN: `rc3–rc12 (8)`; else the first two and a count. */
export function tagsWords(tags: string[]): string | null {
  if (!tags.length) return null
  const numbered = tags.map((tag) => /^rc(\d+)$/.exec(tag)).filter((match): match is RegExpExecArray => match !== null).map((match) => Number(match[1]))
  if (numbered.length === tags.length) {
    const lo = Math.min(...numbered)
    const hi = Math.max(...numbered)
    return lo === hi ? `rc${lo}` : `rc${lo}–rc${hi}${tags.length > 2 ? ` (${tags.length})` : ''}`
  }
  return tags.length <= 2 ? tags.join(', ') : `${tags.slice(0, 2).join(', ')} +${tags.length - 2}`
}
