import { parseResearchReport } from './report.js'
import type { EvidenceReference, ResearchReportData } from './report.js'
import { formatUtcTime as utcTime } from '@tangle-network/charts'
import { endingStatus } from './workspace/data.js'
import { hostWords, RELEASE_STATE, verdictWord } from './workspace/play-standing.js'

/**
 * The play report the Lab host serves at `/api/discovery/plays/<id>/report` (tangle-tools `compose_play_report`).
 * Typed loosely: a field the producer leaves out or nulls renders as unknown, never as zero.
 */
export interface PlayReportFact {
  value: unknown
  unit?: string | null
  source?: string | null
  asOf?: string | null
  why?: string | null
  record?: string | null
}

interface BarMetric {
  id: string
  label: string
  unit?: string | null
  target?: { min?: number; max?: number; approx?: number } | null
  precondition?: boolean
  best?: BarPoint | null
  nearest?: BarPoint | null
  source?: string | null
  asOf?: string | null
}

interface BarPoint {
  value: number
  tag?: string | null
  runId?: string | null
  comparable?: boolean | null
  short?: string | null
  why?: string | null
  ratioToTarget?: number | null
  source?: string | null
}

interface Release {
  tag: string
  runId: string
  run?: string | null
  commit?: string | null
  state?: string | null
  gate?: { verdict?: string | null } | null
  checks?: Record<string, { verdict?: string | null }> | null
  metrics?: Record<string, { value: number | null; comparable?: boolean | null; note?: string | null; checker?: string | null }> | null
}

interface Run {
  runId: string
  run?: string | null
  href?: string | null
  wallHours?: number | null
  agentHours?: PlayReportFact | null
  hoursByOutcome?: PlayReportFact | null
  triesByOutcome?: Record<string, number> | null
  ending?: { word?: string | null; glyph?: string | null; reason?: string | null } | null
  best?: { verdict?: string | null; tag?: string | null; checker?: string | null; workloads?: { passed: number; total: number } | null } | null
  cost?: { apiUsd?: number | null; provenance?: string | null } | null
}

export interface PlayReportDocument {
  schema: 'agent-workspace.play-report.v1'
  id: string
  title: string
  asOf: string
  goal?: { text?: string | null } | null
  links?: { play?: string | null } | null
  verdict?: { sentence: string; status?: string | null; source?: string | null; asOf?: string | null } | null
  questions?: { id: string; question: string; status: string; answer?: string | null; source?: string | null; asOf?: string | null; why?: string | null; record?: string | null; gaps?: string[] | null }[]
  anomalies?: { rule: string; runId?: string | null; value?: unknown; unit?: string | null; sentence: string; source?: string | null; asOf?: string | null }[]
  rules?: { id: string; question: string; threshold?: number | null; unit?: string | null; state: string; fired?: number | null }[]
  built?: {
    release?: { tag?: string | null; runId?: string | null; commit?: string | null; basis?: string | null; builtAt?: string | null } | null
    members?: PlayReportFact | null
    crates?: PlayReportFact | null
    lockedPackages?: PlayReportFact | null
    externalCrates?: PlayReportFact | null
    externalCrateNames?: string[] | null
    commands?: PlayReportFact | null
    guests?: PlayReportFact | null
    docs?: { path: string; title?: string | null }[] | null
  } | null
  howGood?: {
    bar?: BarMetric[] | null
    releases?: Release[] | null
    counts?: { published?: number; checked?: number; withheld?: number; passingCurrent?: number; neverCheckedCurrent?: number; checker?: string | null; source?: string | null } | null
  } | null
  hardware?: {
    measuredOn?: Record<string, PlayReportFact> | null
    paperOn?: PlayReportFact | null
    checkCondition?: PlayReportFact | null
    platforms?: PlayReportFact | null
  } | null
  limit?: { bound?: PlayReportFact | null; published?: { metric: string; stretch?: { min?: number; max?: number; label?: string } | null; source?: string | null }[] | null } | null
  pipelines?: {
    lab?: { runId: string; run?: string | null; checks?: number | null; gateRows?: number | null; gateVerdicts?: Record<string, number> | null; contractFeedback?: number | null; firstAt?: string | null; lastAt?: string | null; source?: string | null }[] | null
    play?: { scripts?: { path: string; purpose?: string | null }[] | null; benches?: { dir: string; tag?: string | null; table?: boolean | null }[] | null; coverage?: PlayReportFact | null } | null
  } | null
  runs?: Run[] | null
  unknowns?: { field: string; why: string; record: string }[] | null
}

const SECTIONS = [
  { id: 'how-good', title: 'How good, against the bar' },
  { id: 'built', title: 'What was built' },
  { id: 'hardware', title: 'Hardware and platforms' },
  { id: 'limit', title: 'The limit' },
  { id: 'pipelines', title: 'Pipelines' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 })
const shortRun = (play: string, run: string) => (run.startsWith(play + '-') ? run.slice(play.length + 1) : run)
const runHref = (runId: string) => `/run/${encodeURIComponent(runId)}`

/** A value as words; null and undefined stay null so the renderer says unknown. */
function words(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return number(value)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.map((item) => words(item) ?? 'unknown').join(', ')
  return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${words(item) ?? 'unknown'}`).join('; ')
}

function evidence(source: string | null | undefined, asOf?: string | null): EvidenceReference[] {
  return source ? [{ path: source, ...(asOf ? { asOf } : {}) }] : []
}

const range = (bound: { min?: number; max?: number; approx?: number } | null | undefined) =>
  !bound ? null : bound.approx !== undefined ? `≈${number(bound.approx)}` : bound.min !== undefined && bound.max !== undefined ? `${number(bound.min)}–${number(bound.max)}` : bound.min !== undefined ? `≥${number(bound.min)}` : bound.max !== undefined ? `≤${number(bound.max)}` : null

/**
 * Maps the served play report onto `agent-research-report.v1` with one play, so `ResearchReport` renders it and the
 * LaTeX, print and JSON exports keep working. Sections follow the report's reading order: verdict, questions, how good,
 * what was built, hardware, the limit, pipelines, runs, anomalies and unknowns.
 */
export function playReportToResearchReport(doc: PlayReportDocument): ResearchReportData {
  if (doc.schema !== 'agent-workspace.play-report.v1') throw new Error(`Expected agent-workspace.play-report.v1, got ${String(doc.schema)}`)
  const metrics: Record<string, unknown>[] = []
  const tables: Record<string, unknown>[] = []
  const summaries: Partial<Record<SectionId, string>> = {}
  const fact = (section: SectionId, id: string, label: string, value: PlayReportFact | null | undefined, extra: Record<string, unknown> = {}) => {
    const text = words(value?.value)
    metrics.push({
      id: `${section}.${id}`,
      section,
      label,
      value: text,
      ...(text !== null && value?.unit ? { unit: value.unit } : {}),
      ...(value?.source ? { source: evidence(value.source, value.asOf)[0] } : {}),
      ...(text === null ? { why: value?.why ? hostWords(value.why) : 'not recorded', ...(value?.record ? { record: value.record } : {}) } : {}),
      ...extra,
    })
  }

  // How good: the release counts, then each bar metric's best (or nearest) value with its comparability.
  const how = doc.howGood ?? null
  const counts = how?.counts ?? null
  if (counts) {
    const at = { source: counts.source ?? null, asOf: doc.asOf }
    const checker = counts.checker ?? 'the current checker'
    summaries['how-good'] = `${words(counts.published) ?? 'unknown'} releases published, ${words(counts.checked) ?? 'unknown'} checked, ${words(counts.passingCurrent) ?? 'unknown'} passing under ${checker}.`
    fact('how-good', 'published', 'Releases published', { value: counts.published ?? null, unit: 'releases', ...at })
    fact('how-good', 'checked', 'Releases checked', { value: counts.checked ?? null, unit: 'releases', ...at })
    fact('how-good', 'withheld', 'Not published (held by the gate)', { value: counts.withheld ?? null, unit: 'releases', ...at })
    fact('how-good', 'passing', `Passing under ${checker}`, { value: counts.passingCurrent ?? null, unit: 'releases', ...at })
    fact('how-good', 'never-checked', `Never checked under ${checker}`, { value: counts.neverCheckedCurrent ?? null, unit: 'releases', ...at })
  }
  const bar = how?.bar ?? []
  for (const metric of bar) {
    const point = metric.best ?? metric.nearest ?? null
    const target = range(metric.target)
    const where = point ? [point.tag, point.runId ? shortRun(doc.id, point.runId) : null].filter(Boolean).join(' · ') : ''
    fact('how-good', `bar.${metric.id}`, `${metric.label}${metric.best ? ' (best)' : point ? ' (nearest)' : ''}`,
      point ? { value: point.value, unit: metric.unit, source: point.source ?? metric.source, asOf: metric.asOf } : { value: null, source: metric.source, asOf: metric.asOf, why: metric.precondition ? 'a precondition the check enforces; no checked release recorded a value' : 'no checked release measured it', record: 'a play-check row with this metric' },
      {
        coverage: [target ? `bar ${target}${metric.unit ? ` ${metric.unit}` : ''}` : null, point?.ratioToTarget !== null && point?.ratioToTarget !== undefined ? `${number(point.ratioToTarget)}× the target` : null, where || null].filter(Boolean).join(' · ') || undefined,
        ...(point ? { comparable: point.comparable ?? null, ...(point.short || point.why ? { note: hostWords((point.short ?? point.why)!) } : {}) } : {}),
      })
  }
  const measured = (how?.releases ?? []).filter((release) => release.metrics && Object.keys(release.metrics).length)
  const ids = bar.map((metric) => metric.id).filter((id) => measured.some((release) => release.metrics?.[id]))
  if (measured.length && ids.length)
    tables.push({
      id: 'releases',
      section: 'how-good',
      title: 'Each measured release against the bar',
      columns: ['Release', 'Run', 'State', 'Verdict', ...ids.map((id) => { const metric = bar.find((item) => item.id === id)!; return `${metric.label}${metric.unit ? ` (${metric.unit})` : ''}` })],
      rows: measured.map((release) => {
        const verdict = release.gate?.verdict ?? Object.values(release.checks ?? {}).map((check) => check.verdict).find(Boolean) ?? null
        return [
          { text: release.tag },
          { text: release.run ?? shortRun(doc.id, release.runId), href: runHref(release.runId) },
          { text: release.state ? (RELEASE_STATE[release.state] ?? release.state) : null },
          { text: verdict ? verdictWord(verdict) : null },
          ...ids.map((id) => {
            const value = release.metrics?.[id]
            return value ? { text: words(value.value), comparable: value.comparable ?? null, ...(value.note || value.checker ? { note: hostWords([value.note, value.checker].filter(Boolean).join(' · ')) } : {}) } : { text: null, note: 'not measured' }
          }),
        ]
      }),
      source: { path: 'play-checks.jsonl and tag-gate.jsonl of each run' },
    })

  // What was built: the inventory at the release the report reads.
  const built = doc.built ?? null
  if (built) {
    const release = built.release ?? null
    if (release?.tag) summaries.built = `At ${release.tag}${release.commit ? ` (${release.commit})` : ''}${release.runId ? ` of ${shortRun(doc.id, release.runId)}` : ''}${release.basis ? `, ${release.basis}` : ''}.`
    const count = (value: PlayReportFact | null | undefined) => (Array.isArray(value?.value) ? { ...value, value: value.value.length } : value)
    const names = (value: PlayReportFact | null | undefined) => (Array.isArray(value?.value) && value.value.length ? { note: value.value.join(', ') } : {})
    fact('built', 'crates', 'Crates', count(built.crates), names(built.crates))
    fact('built', 'members', 'Workspace members', count(built.members), names(built.members))
    fact('built', 'guests', 'Guests', built.guests)
    fact('built', 'external-crates', 'External crates', built.externalCrates, built.externalCrateNames?.length ? { note: built.externalCrateNames.join(', ') } : {})
    fact('built', 'locked-packages', 'Locked packages', built.lockedPackages)
    const commands = built.commands?.value
    if (commands && typeof commands === 'object' && !Array.isArray(commands))
      for (const [name, argv] of Object.entries(commands as Record<string, unknown>))
        fact('built', `command.${name}`, `Command: ${name}`, { ...built.commands, value: Array.isArray(argv) ? argv.join(' ') : argv })
    else fact('built', 'commands', 'Commands', built.commands)
    if (built.docs?.length)
      tables.push({ id: 'docs', section: 'built', title: 'Documents at the release', columns: ['Path', 'Title'], rows: built.docs.map((item) => [{ text: item.path }, { text: item.title ?? null }]) })
  }

  // Hardware and platforms: where the check measured, against the paper's machine.
  const hardware = doc.hardware ?? null
  if (hardware) {
    const LABELS: Record<string, string> = { containerCpus: 'Container CPUs', containerMemoryMb: 'Container memory', cpuModel: 'CPU model', logicalCpus: 'Logical CPUs', checkCpuSet: 'Check CPU set', concurrentLoad: 'Concurrent load' }
    for (const [key, value] of Object.entries(hardware.measuredOn ?? {})) fact('hardware', key, LABELS[key] ?? key, value)
    fact('hardware', 'paper-on', 'The paper measured on', hardware.paperOn)
    fact('hardware', 'check-condition', 'The check measures', hardware.checkCondition)
    fact('hardware', 'platforms', 'Platforms', hardware.platforms)
  }

  // The limit: empty until a role or a limits benchmark fills the slot; the paper's published bounds beside it.
  const limit = doc.limit ?? null
  if (limit) {
    const empty = words(limit.bound?.value) === null
    summaries.limit = empty ? 'Empty: no role or limits benchmark has filled this slot yet.' : 'A record states the bound below.'
    fact('limit', 'bound', 'Measured bound', limit.bound)
    for (const row of limit.published ?? []) {
      const metric = bar.find((item) => item.id === row.metric)
      fact('limit', `published.${row.metric}`, `Published: ${metric?.label ?? row.metric}`, { value: range(row.stretch), unit: metric?.unit, source: row.source }, row.stretch?.label ? { note: row.stretch.label } : {})
    }
  }

  // Pipelines: the play's own benchmark scripts and their coverage, then the Lab's checks per run.
  const pipelines = doc.pipelines ?? null
  if (pipelines) {
    const coverage = pipelines.play?.coverage ?? null
    const covered = coverage?.value as { benchmarked?: number; published?: number } | null | undefined
    fact('pipelines', 'coverage', 'Tags benchmarked', covered && typeof covered === 'object' && covered.benchmarked !== undefined ? { ...coverage, value: `${number(covered.benchmarked)} of ${covered.published !== undefined ? number(covered.published) : 'unknown'} published` } : coverage)
    for (const script of pipelines.play?.scripts ?? []) fact('pipelines', `script.${script.path}`, script.path, { value: script.purpose ?? null, source: coverage?.source, asOf: coverage?.asOf, why: 'the script states no purpose' })
    if (pipelines.play?.benches?.length)
      tables.push({ id: 'benches', section: 'pipelines', title: 'Benchmark directories', columns: ['Directory', 'Release', 'Table'], rows: pipelines.play.benches.map((bench) => [{ text: bench.dir }, { text: bench.tag ?? null, ...(bench.tag ? {} : { note: 'no release tag in its name' }) }, { text: words(bench.table ?? null) }]), ...(coverage?.source ? { source: { path: coverage.source } } : {}) })
    if (pipelines.lab?.length)
      tables.push({
        id: 'lab',
        section: 'pipelines',
        title: 'The Lab’s checks, per run',
        columns: ['Run', 'Checks', 'Gate rows', 'Gate verdicts', 'Contract feedback', 'First', 'Last'],
        rows: pipelines.lab.map((row) => [
          { text: row.run ?? shortRun(doc.id, row.runId), href: runHref(row.runId) },
          { text: words(row.checks) },
          { text: words(row.gateRows) },
          { text: row.gateVerdicts && Object.keys(row.gateVerdicts).length ? words(row.gateVerdicts) : row.gateRows === 0 ? 'none' : null },
          { text: words(row.contractFeedback) },
          { text: row.firstAt ? utcTime(row.firstAt, true) : null },
          { text: row.lastAt ? utcTime(row.lastAt, true) : null },
        ]),
        source: { path: 'play-checks.jsonl, tag-gate.jsonl and contract-feedback.jsonl of each run' },
      })
  }

  // Anomalies, grouped under the rule that found them; an instance whose rule is not listed keeps its own entry.
  const anomalies = doc.anomalies ?? []
  const rules = (doc.rules ?? []).map((rule) => ({ id: rule.id, question: rule.question, state: rule.state, threshold: rule.threshold }))
  for (const anomaly of anomalies) if (!rules.some((rule) => rule.id === anomaly.rule)) rules.push({ id: anomaly.rule, question: anomaly.rule, state: 'unlisted', threshold: undefined })
  const unitOf = (rule: string) => doc.rules?.find((item) => item.id === rule)?.unit ?? null

  const verdict = doc.verdict ?? null
  const sentence = verdict ? hostWords(verdict.sentence) : null
  const report = {
    schema: 'agent-research-report.v1',
    id: `${doc.id}-report`,
    title: doc.title,
    generatedAt: doc.asOf,
    summary: sentence ?? doc.goal?.text ?? '',
    plays: [
      {
        id: doc.id,
        title: doc.title,
        summary: sentence ?? 'No verdict recorded.',
        updatedAt: verdict?.asOf ?? doc.asOf,
        status: verdict?.status ?? null,
        claims: [],
        ...(doc.links?.play ? { href: doc.links.play } : {}),
        ...(verdict ? { verdict: { sentence: hostWords(verdict.sentence), status: verdict.status ?? null, evidence: evidence(verdict.source, verdict.asOf) } } : {}),
        questionCoverage: (doc.questions ?? []).map((question) => {
          const sources = evidence(question.source, question.asOf)
          // An answer with no source is not observed: it reads unknown and says so.
          const observed = question.status === 'observed' && sources.length > 0
          const gaps = question.gaps?.length ? `not recorded: ${question.gaps.join(', ')}` : null
          return {
            id: question.id,
            question: question.question,
            status: observed ? 'observed' : question.status === 'not_applicable' ? 'not_applicable' : 'unavailable',
            ...(observed && question.answer ? { answer: hostWords(question.answer) } : {}),
            evidence: sources,
            ...(question.asOf ? { asOf: question.asOf } : {}),
            ...(observed ? (gaps ? { why: gaps } : {}) : { why: question.why ? hostWords(question.why) : (question.status === 'observed' ? 'the answer names no source' : 'not recorded') }),
            ...(question.record ? { record: question.record } : {}),
          }
        }),
        metrics,
        sections: SECTIONS.filter((section) => metrics.some((metric) => metric.section === section.id) || tables.some((table) => table.section === section.id)).map((section) => ({ ...section, ...(summaries[section.id] ? { summary: summaries[section.id] } : {}) })),
        tables,
        runs: (doc.runs ?? []).map((run) => {
          const hours = run.hoursByOutcome?.value
          const best = run.best ?? null
          return {
            id: run.runId,
            label: run.run ?? shortRun(doc.id, run.runId),
            href: run.href ?? runHref(run.runId),
            ending: run.ending?.word ? `${endingStatus(run.ending.word).shape} ${endingStatus(run.ending.word).word}` : null,
            reason: run.ending?.reason ? hostWords(run.ending.reason) : null,
            wallHours: run.wallHours ?? null,
            agentHours: {
              id: `${run.runId}.agentHours`,
              label: 'Agent-hours',
              value: words(run.agentHours?.value),
              ...(words(run.agentHours?.value) !== null ? { unit: run.agentHours?.unit ?? 'h' } : { why: run.agentHours?.why ?? 'not recorded', ...(run.agentHours?.record ? { record: run.agentHours.record } : {}) }),
              ...(run.agentHours?.source ? { source: evidence(run.agentHours.source, run.agentHours.asOf)[0] } : {}),
            },
            hoursByOutcome: hours && typeof hours === 'object' ? (hours as Record<string, number>) : null,
            triesByOutcome: run.triesByOutcome ?? null,
            best: best ? [best.verdict ? verdictWord(best.verdict) : null, best.tag, best.workloads ? `${best.workloads.passed}/${best.workloads.total}` : null, best.checker].filter(Boolean).join(' · ') : null,
            cost: run.cost?.apiUsd !== null && run.cost?.apiUsd !== undefined ? `$${number(run.cost.apiUsd)}${run.cost.provenance ? ` ${run.cost.provenance}` : ''}` : (run.cost?.provenance ?? null),
          }
        }),
        rules: rules.map((rule) => {
          const unit = unitOf(rule.id)
          return {
            id: rule.id,
            question: rule.question,
            state: rule.state,
            ...(rule.threshold !== null && rule.threshold !== undefined ? { threshold: `${number(rule.threshold)}${unit ? ` ${unit}` : ''}` } : {}),
            instances: anomalies.filter((anomaly) => anomaly.rule === rule.id).map((anomaly) => ({
              sentence: anomaly.sentence,
              // A quoted claim is already in the sentence; only a measured value adds to it.
              value: words(anomaly.value) === null || anomaly.sentence.includes(words(anomaly.value)!) ? null : `${words(anomaly.value)}${anomaly.unit ? ` ${anomaly.unit}` : ''}`,
              evidence: evidence(anomaly.source, anomaly.asOf),
            })),
          }
        }),
        unknowns: (doc.unknowns ?? []).map((item) => ({ ...item, why: hostWords(item.why) })),
      },
    ],
  }
  return parseResearchReport(report)
}
