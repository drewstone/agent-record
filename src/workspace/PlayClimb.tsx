import { type ChartBand, type ChartMark, type MultiplePanel, smallMultiples, type TimePoint, type TimeSeriesRow, timeSeries, type XCategory, type YTarget } from '@tangle-network/charts'
import { checkerColor } from '@tangle-network/charts'
import { FigureView } from '@tangle-network/charts/react'
import { useMemo } from 'react'
import type { PlayDocument } from '../workspace.js'
import {
  checkerIndex,
  checkerLabel,
  checkerTitle,
  compactNumber,
  displayUnit,
  ENDING_GLYPH,
  markVerdict,
  metricValue,
  type PlayBarMetric,
  type PlayHead,
  rulingWords,
  shortRun,
  shortTag,
  targetWords,
  utc,
  verdictWord,
} from './play-standing.js'

type Play = PlayDocument & PlayHead
type Climb = NonNullable<PlayHead['climb']>

const ms = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}
const runSpan = (from: string | null | undefined, to: string | null | undefined) => {
  const a = utc(from)
  const b = utc(to)
  return a && b ? (a.slice(0, 5) === b.slice(0, 5) ? `${a.slice(0, 11)}–${b.slice(6)}` : `${a}–${b}`) : (a ?? '')
}

/**
 * The release axis the climb and the bar panels share: one column per checked release, in time order, grouped by run.
 * A run group with no column yet (a live run with no tag) keeps a narrow empty column, so the group is still drawn.
 */
export function releaseAxis(play: Play, climb: Climb) {
  const columns = [...climb.columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.at ?? '').localeCompare(String(b.at ?? '')))
  const index = new Map<string, number>()
  const categories: XCategory[] = []
  const runOf: string[] = []
  const groups = climb.groups
  // Columns are drawn group by group, oldest group first, so a run's releases stay together.
  for (const group of groups) {
    const own = columns.filter((column) => column.runId === group.runId)
    if (!own.length) {
      categories.push({ at: categories.length, label: '', weight: 0.3 })
      runOf.push(group.runId)
      continue
    }
    for (const column of own) {
      index.set(column.id, categories.length)
      categories.push({ at: categories.length, label: shortTag(column.tag) ?? (column.state === 'workspace' ? 'workspace' : '·'), weight: column.weight ?? 1 })
      runOf.push(group.runId)
    }
  }
  for (const column of columns) {
    if (index.has(column.id)) continue
    index.set(column.id, categories.length)
    categories.push({ at: categories.length, label: shortTag(column.tag) ?? (column.state === 'workspace' ? 'workspace' : '·'), weight: column.weight ?? 1 })
    runOf.push(column.runId)
  }
  const domain: [number, number] = [0, Math.max(1, categories.length - 1)]
  const bands: ChartBand[] = groups.flatMap((group) => {
    const at = runOf.flatMap((run, i) => (run === group.runId ? [i] : []))
    if (!at.length) return []
    const glyph = group.end?.glyph ?? (group.end ? (ENDING_GLYPH[group.end.kind] ?? '') : '')
    // A run that only scored its untagged workspace has no tag counts to state.
    const tagged = Boolean(group.checked || group.published)
    const counts = [
      tagged && group.checked !== null && group.checked !== undefined ? `${group.checked} checked` : null,
      tagged && group.published !== null && group.published !== undefined ? `${group.published} published` : null,
      group.withheld ? `${group.withheld} withheld` : null,
      group.noTag ? `${group.noTag} untagged` : null,
    ].filter(Boolean)
    const lineage = group.lineage?.kind === 'fork' && group.lineage.parentRun ? `forked from ${shortRun(play.id, group.lineage.parentRun)}${group.lineage.parentTag ? `@${shortTag(group.lineage.parentTag)}` : ''}` : group.lineage?.kind === 'wrong-base' ? `wrong base ${group.lineage.why ?? ''}` : null
    const label = [`${glyph ? `${glyph} ` : ''}${shortRun(play.id, group.runId) || group.label}`, ...counts, lineage, group.unscored ? 'no score line' : null, runSpan(group.from, group.to)].filter(Boolean).join(' · ')
    return [{ from: at[0]!, to: at.at(-1)!, label, kind: 'group' as const }]
  })
  return { index, categories, domain, bands, runOf }
}

/** The stage name a progress value sits in, for hovers: never a bare decimal. */
const stageAt = (climb: Climb) => {
  const lines = [...(climb.y?.gridlines ?? [])].sort((a, b) => a.at - b.at)
  return (value: number) => {
    if (value >= 1) return 'solved'
    const line = lines.filter((item) => item.at <= value + 1e-9).at(-1)
    return line ? line.label : `${Math.round(value * 100)}%`
  }
}

function climbFigure(play: Play, climb: Climb) {
  const axis = releaseAxis(play, climb)
  const rows = new Map<string, TimeSeriesRow & { order: number }>()
  const row = (checker: string | null | undefined, runId: string) => {
    const key = `${checker ?? 'none'}:${runId}`
    let found = rows.get(key)
    if (!found) {
      const label = `${checkerLabel(play.checkers, checker)} · ${shortRun(play.id, runId)}`
      found = { id: key, label, points: [], colorIndex: checkerIndex(play.checkers, checker), order: rows.size }
      rows.set(key, found)
    }
    return found
  }
  const timeOf = (item: { firstAt?: string | null; lastAt?: string | null }) => ({ firstAt: ms(item.firstAt), lastAt: ms(item.lastAt) ?? ms(item.firstAt) })
  for (const mark of climb.marks) {
    const x = axis.index.get(mark.columnId)
    if (x === undefined) continue
    const workloads = mark.workloads?.total ? `${mark.workloads.passed ?? '?'}/${mark.workloads.total}` : null
    const stage = mark.reached !== null && mark.reached !== undefined && mark.of ? `stage ${mark.reached} of ${mark.of}${mark.stage ? ` (${mark.stage})` : ''}` : null
    const point: TimePoint = {
      x,
      y: mark.progress === null ? null : Math.max(0, Math.min(1, mark.progress)),
      verdict: markVerdict(mark.verdict),
      ...(mark.count && mark.count > 1 ? { count: mark.count } : {}),
      ...timeOf(mark),
      marker: mark.kind === 'gate' ? 'diamond' : 'circle',
      ...(mark.verdict === 'solved' ? { glyph: 'check' as const } : {}),
      ...(workloads && mark.progress !== null ? { label: workloads } : {}),
      annotation: [`${mark.kind === 'gate' ? 'tag gate' : 'check'}: ${verdictWord(mark.verdict)}${mark.scope === 'contract' ? ' (contract stages)' : ''}`, stage, workloads ? `${workloads} workloads` : null, mark.line, mark.source].filter(Boolean).join(' · '),
    }
    row(mark.checker, climb.columns.find((column) => column.id === mark.columnId)?.runId ?? '').points.push(point)
  }
  for (const item of climb.strip ?? []) {
    const x = item.columnId ? axis.index.get(item.columnId) : undefined
    if (x === undefined) continue
    // A superseded gate carries no verdict: the table lists it as not measured and the strip leaves it out.
    row(item.checker, item.runId).points.push({
      x,
      y: null,
      ...(item.verdict === 'superseded' ? {} : { verdict: markVerdict(item.verdict) }),
      ...(item.count && item.count > 1 ? { count: item.count } : {}),
      ...timeOf(item),
      marker: item.kind === 'gate' ? 'diamond' : 'circle',
      annotation: [`${item.kind === 'gate' ? 'tag gate' : 'check'}: ${verdictWord(item.verdict)}, no score`, item.line, item.source].filter(Boolean).join(' · '),
    })
  }
  const series = [...rows.values()]
    .filter((item) => item.points.length)
    .map((item) => ({ ...item, points: item.points.sort((a, b) => a.x - b.x || (a.y ?? -1) - (b.y ?? -1)) }))
    .sort((a, b) => (a.colorIndex ?? 9) - (b.colorIndex ?? 9) || a.order - b.order)
  const marks: ChartMark[] = []
  for (const gap of climb.gaps ?? []) {
    const x = axis.index.get(gap.afterColumnId)
    if (x === undefined || x >= axis.categories.length - 1) continue
    marks.push({ at: x + 0.5, label: `${gap.hours >= 10 ? Math.round(gap.hours) : gap.hours.toFixed(1)} h`, kind: 'event', source: 'gap' })
  }
  for (const ruling of climb.rulings ?? []) {
    // A ruling sits at the first column its new checker scored; a rejected ruling at the column checked just before it.
    const to = ruling.checkerTo
    const first = to ? climb.marks.filter((mark) => mark.checker === to).map((mark) => axis.index.get(mark.columnId)).filter((x): x is number => x !== undefined) : []
    const before = climb.marks
      .filter((mark) => mark.firstAt && mark.firstAt <= ruling.at)
      .sort((a, b) => String(b.firstAt).localeCompare(String(a.firstAt)))
      .map((mark) => axis.index.get(mark.columnId))
      .find((x): x is number => x !== undefined)
    const x = first.length ? Math.min(...first) : before
    if (x === undefined) continue
    const clock = utc(ruling.at)?.slice(6) ?? ''
    // The mark's source names who ruled; the label says what changed and when.
    const label = ruling.verdict === 'rejected' ? `check stands ${clock}` : `${to ? checkerLabel(play.checkers, to) : 'new check'} ${clock}`
    marks.push({ at: x, label, kind: 'ruling', ...(ruling.by ? { source: ruling.by } : {}) })
  }
  const lines = (climb.y?.gridlines ?? []).filter((item) => item.at >= 0 && item.at <= 1).map((item) => (item.at === 1 ? { ...item, label: item.label.toUpperCase() } : item))
  // A check without stages scores pass or fail: name the floor too, or the plot reads as one line of SOLVED.
  const ticks = lines.length && lines.every((item) => item.at === 1) ? [{ at: 0, label: 'NOT SOLVED' }, ...lines] : lines
  return timeSeries(series, {
    id: `climb-${play.id}`,
    x: { label: 'Release', domain: axis.domain, categories: axis.categories },
    // Headroom above SOLVED keeps ruling heads off the solved marks.
    y: { label: climb.y?.label ?? 'Check progress', unit: '', domain: [-0.05, 1.06], ...(ticks.length ? { ticks } : {}), strip: 'no score' },
    formatY: stageAt(climb),
    markers: { circle: 'check', diamond: 'gate' },
    bands: axis.bands,
    marks,
  })
}

/** The climb (chart a): check progress per checked release, grouped by run, one colour per checker. */
export function PlayClimb({ play }: { play: Play }) {
  const climb = play.climb ?? null
  const figure = useMemo(() => (climb ? climbFigure(play, climb) : null), [play, climb])
  if (!climb || !figure) return null
  const counted = new Map<string, number>()
  for (const mark of [...climb.marks, ...(climb.strip ?? [])]) counted.set(mark.checker ?? '', (counted.get(mark.checker ?? '') ?? 0) + (mark.count ?? 1))
  return (
    <section className="ws-section play-climb" data-play-climb aria-label="Climb">
      <header className="section-head">
        <h3>Climb</h3>
        <p className="faint">Check progress of each checked release, grouped by run. Filled marks pass, rings fail, hatched squares under the axis are undecided; ◆ is a tag gate.</p>
      </header>
      {play.checkers && play.checkers.length > 0 && (
        <ul className="checker-legend" aria-label="Checkers">
          {play.checkers.map((checker) => (
            <li key={checker.sha256} title={checkerTitle(checker)} style={{ ['--checker' as string]: checkerColor(checkerIndex(play.checkers, checker.sha256) ?? 9) }} data-current={checker.current ? 'yes' : 'no'}>
              <i aria-hidden="true" />
              <b>{checker.label}</b>
              <span className="faint">
                {checker.ruling ? ` ${rulingWords(checker.ruling)}` : ' as pressed'}
                {` · ${checker.rows ?? counted.get(checker.label) ?? counted.get(checker.sha256) ?? 0} rows`}
                {checker.current ? ' · current' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <FigureView figure={figure} />
    </section>
  )
}

/** A metric's y domain from its points and targets, padded; log domains stay positive. */
function domainOf(metric: PlayBarMetric, values: number[]): [number, number] {
  const { factor } = displayUnit(metric.unit)
  const bounds = [...values, ...[metric.target?.min, metric.target?.max, metric.target?.approx, metric.stretch?.min, metric.stretch?.max].map((value) => (typeof value === 'number' ? value * factor : value))].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && (metric.scale !== 'log' || value > 0))
  if (!bounds.length) return metric.scale === 'log' ? [1, 10] : [0, 1]
  const lo = Math.min(...bounds)
  const hi = Math.max(...bounds)
  if (metric.scale === 'log') return [10 ** Math.floor(Math.log10(lo / 1.5)), 10 ** Math.ceil(Math.log10(hi * 1.5))]
  return [Math.min(0, lo), hi === lo ? hi + 1 : hi * 1.1]
}

function targetsOf(metric: PlayBarMetric): YTarget[] {
  const out: YTarget[] = []
  const t = metric.target
  const word = targetWords(metric)
  const { factor } = displayUnit(metric.unit)
  if (t) {
    const from = t.min ?? t.approx ?? t.max
    const to = t.max ?? t.approx ?? t.min
    if (typeof from === 'number' && typeof to === 'number') out.push({ from: from * factor, to: to * factor, label: word ? `bar ${word}` : 'bar', kind: 'target' })
  }
  const st = metric.stretch
  if (st && (typeof st.min === 'number' || typeof st.max === 'number')) out.push({ from: (st.min ?? st.max)! * factor, to: (st.max ?? st.min)! * factor, label: 'stretch', kind: 'stretch' })
  return out
}

/** Against the bar (chart b): one panel per declared metric on the climb's release axis, the bar's target as a band. */
export function PlayAgainstBar({ play }: { play: Play }) {
  const climb = play.climb ?? null
  const bar = play.bar ?? null
  const figure = useMemo(() => {
    if (!climb || !bar || !play.barSeries?.length) return null
    const axis = releaseAxis(play, climb)
    const metrics = bar.metrics.filter((metric) => !metric.precondition)
    const panels = metrics.flatMap((metric): MultiplePanel[] => {
      const series = play.barSeries!.find((item) => item.metric === metric.id)
      if (!series) return []
      const shown = displayUnit(metric.unit)
      const points: TimePoint[] = series.points
        .map((point) => ({ point, x: axis.index.get(point.columnId) }))
        .filter((item): item is { point: (typeof series.points)[number]; x: number } => item.x !== undefined && (metric.scale !== 'log' || item.point.value > 0))
        .sort((a, b) => a.x - b.x)
        .map(({ point, x }) => {
          const failing = /fail|not-solved/.test(point.verdict ?? '')
          return {
            x,
            y: point.value * shown.factor,
            verdict: markVerdict(point.verdict),
            comparable: point.comparable === undefined ? null : point.comparable,
            ...(failing && point.comparable !== false ? { glyph: 'cross' as const } : {}),
            annotation: [metricValue(point.value, metric.unit), verdictWord(point.verdict), point.note, point.basis ? `from ${point.basis}` : null].filter(Boolean).join(' · '),
          }
        })
      const domain = domainOf(metric, points.map((point) => point.y!).filter((value) => value !== null))
      const label = `${metric.label}${metric.direction ? (metric.direction === 'up' ? ' ↑' : ' ↓') : ''}`
      if (!points.length) return [{ id: metric.id, label, unit: shown.unit, domain, missing: { why: series.missing?.why ?? 'not measured on any checked release' } }]
      return [{ id: metric.id, label, unit: shown.unit, domain, points, scale: metric.scale ?? 'linear', targets: targetsOf(metric), format: compactNumber }]
    })
    if (!panels.length) return null
    // Two panels a row: the wide render is 720 px, and four in a row leave each about 168 px for its release labels.
    return smallMultiples(panels, {
      id: `bar-${play.id}`,
      x: { label: 'Release', domain: axis.domain, categories: axis.categories },
      y: { label: 'Measured value', unit: panels[0]!.unit ?? '', domain: [0, 1] },
      shared: 'x',
      noun: 'metric',
      columns: Math.min(2, panels.length),
      connect: false,
      markers: { circle: 'check', diamond: 'gate' },
    })
  }, [play, climb, bar])
  if (!figure) return null
  return (
    <section className="ws-section play-bar" data-play-bar aria-label="Against the bar">
      <header className="section-head">
        <h3>Against the bar</h3>
        <p className="faint">
          Each release’s measurements on the climb’s axis, the bar as a shaded band{bar?.source ? ` (${bar.source})` : ''}. Filled: comparable and passing; ✕ a failing candidate; * not comparable; ? comparability unknown.
          {bar?.condition && bar.checkCondition ? ` Bar: ${bar.condition}. Ours: ${bar.checkCondition}.` : ''}
        </p>
      </header>
      <FigureView figure={figure} />
    </section>
  )
}
