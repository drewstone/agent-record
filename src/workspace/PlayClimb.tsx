import { type ChartBand, type ChartMark, type MultiplePanel, smallMultiples, type TimePoint, type TimeSeriesRow, timeSeries, type XCategory, type YTarget } from '@tangle-network/charts'
import { CHECKER_HUES, checkerColor } from '@tangle-network/charts'
import { FigureView } from '@tangle-network/charts/react'
import { type KeyboardEvent, type PointerEvent, useCallback, useMemo, useRef, useState } from 'react'
import type { PlayDocument } from '../workspace-model.js'
import { CalibrationLabels } from './Calibration.js'
import { dataStatus, statusOf } from './data.js'
import {
  checkerIndex,
  checkerLabel,
  checkerTitle,
  checksByRun,
  compactNumber,
  displayUnitFor,
  ENDING_GLYPH,
  hostWords,
  lineReason,
  markVerdict,
  metricValue,
  type PlayBarMetric,
  type PlayHead,
  shortRun,
  shortTag,
  tagsWords,
  targetWords,
  utc,
  VERDICT_WORDS,
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

/** A column's axis label: its tag, or the span of releases the gate only superseded (`rc8–12`). */
const columnLabel = (column: Climb['columns'][number]) =>
  column.tags && column.tags.length > 1 ? `${shortTag(column.tags[0]) ?? ''}–${(shortTag(column.tags.at(-1)) ?? '').replace(/^rc/, '')}` : (shortTag(column.tag) ?? (column.state === 'workspace' ? 'workspace' : '·'))

/**
 * The release axis the climb and the bar panels share: one column per checked release, in tag order, grouped by run.
 * A run group with no column (a live run with no tag, or a run whose checks found none) keeps a narrow empty column, so
 * every run with a check row is on the axis.
 */
export function releaseAxis(play: Play, climb: Climb) {
  const columns = [...climb.columns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.at ?? '').localeCompare(String(b.at ?? '')))
  const index = new Map<string, number>()
  const categories: XCategory[] = []
  const runOf: string[] = []
  const bands: ChartBand[] = []
  const groups = climb.groups
  const glyphOf = (group: Climb['groups'][number]) => (group.end ? (ENDING_GLYPH[group.end.kind] ?? group.end.glyph ?? '') : '')
  const runName = (group: Climb['groups'][number]) => shortRun(play.id, group.runId) || group.label
  // Runs with check rows but no checked release (16a-17b, 19a-19b on magnetar-rust) fold into one narrow column each
  // stretch, so the axis names every run without a bracket per run too narrow to read; the hover lists each one.
  let empty: Climb['groups'] = []
  const flush = () => {
    if (!empty.length) return
    const at = categories.length
    categories.push({ at, label: '', weight: empty.length === 1 ? 1.2 : 1.6 })
    // One run per category: the folded column stands under its first run's id.
    runOf.push(empty[0]!.runId)
    const each = empty.map((group) => [`${glyphOf(group)} ${runName(group)}`.trim(), (group.untagged ?? group.noTag) ? `${group.untagged ?? group.noTag} untagged` : null, group.note].filter(Boolean).join(' '))
    const label = empty.length === 1 ? each[0]! : `${runName(empty[0]!)}–${runName(empty.at(-1)!)} · ${empty.length} runs, no checked release: ${each.join('; ')}`
    bands.push({ from: at, to: at, label, kind: 'group' })
    empty = []
  }
  // Columns are drawn group by group, oldest group first, so a run's releases stay together.
  for (const group of groups) {
    const own = columns.filter((column) => column.runId === group.runId)
    if (!own.length) {
      empty.push(group)
      continue
    }
    flush()
    const from = categories.length
    for (const column of own) {
      index.set(column.id, categories.length)
      categories.push({ at: categories.length, label: columnLabel(column), weight: column.weight ?? 1 })
      runOf.push(group.runId)
    }
    // A run that only scored its untagged workspace has no tag counts to state.
    const tagged = Boolean(group.checked || group.published)
    const counts = [
      tagged && group.checked !== null && group.checked !== undefined ? `${group.checked} checked` : null,
      tagged && group.published !== null && group.published !== undefined ? `${group.published} published` : null,
      group.withheld ? `${group.withheld} not published` : null,
      (group.untagged ?? group.noTag) ? `${group.untagged ?? group.noTag} untagged` : null,
    ].filter(Boolean)
    const lineage = group.lineage?.kind === 'fork' && group.lineage.parentRun ? `forked from ${shortRun(play.id, group.lineage.parentRun)}${group.lineage.parentTag ? `@${shortTag(group.lineage.parentTag)}` : ''}` : group.lineage?.kind === 'wrong-base' ? `wrong base ${group.lineage.why ?? ''}` : null
    const label = [`${glyphOf(group) ? `${glyphOf(group)} ` : ''}${runName(group)}`, ...counts, lineage, group.unscored ? 'score line not recorded' : null, runSpan(group.from, group.to)].filter(Boolean).join(' · ')
    bands.push({ from, to: categories.length - 1, label, kind: 'group' })
  }
  flush()
  for (const column of columns) {
    if (index.has(column.id)) continue
    index.set(column.id, categories.length)
    categories.push({ at: categories.length, label: columnLabel(column), weight: column.weight ?? 1 })
    runOf.push(column.runId)
  }
  const domain: [number, number] = [0, Math.max(1, categories.length - 1)]
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

function climbFigure(play: Play, climb: Climb, width: number) {
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
      annotation: [`${mark.kind === 'gate' ? 'tag gate' : 'check'}: ${verdictWord(mark.verdict)}${mark.scope === 'contract' ? ' (contract stages)' : ''}`, stage, workloads ? `${workloads} workloads` : null, lineReason(mark.line), mark.calibration ? `check ${mark.calibration}` : null, mark.source].filter(Boolean).join(' · '),
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
      annotation: [
        `${item.kind === 'gate' ? 'tag gate' : 'check'}: ${verdictWord(item.verdict)}, score not recorded`,
        item.score?.workloads?.total ? `printed ${item.score.workloads.passed ?? '?'}/${item.score.workloads.total} workloads before it stopped` : null,
        lineReason(item.line),
        item.calibration ? `check ${item.calibration}` : null,
        item.source,
      ]
        .filter(Boolean)
        .join(' · '),
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
  const rulingMarks: ChartMark[] = []
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
    rulingMarks.push({ at: x, label, kind: 'ruling', ...(ruling.by ? { source: ruling.by } : {}) })
  }
  // Rulings that land on one release each keep their own rule, spread across the column in time order: v3's referee
  // ruling (19:48Z) and v4's operator amendment (20:52Z) both first scored rc14.
  for (const mark of rulingMarks) {
    const same = rulingMarks.filter((other) => other.at === mark.at)
    const k = same.indexOf(mark)
    marks.push(same.length > 1 ? { ...mark, at: mark.at + (k - (same.length - 1) / 2) * (0.6 / same.length) } : mark)
  }
  const lines = (climb.y?.gridlines ?? []).filter((item) => item.at >= 0 && item.at <= 1).map((item) => (item.at === 1 ? { ...item, label: item.label.toUpperCase() } : item))
  // A check without stages scores pass or fail: name the floor too, or the plot reads as one line of SOLVED.
  const ticks = lines.length && lines.every((item) => item.at === 1) ? [{ at: 0, label: 'NOT SOLVED' }, ...lines] : lines
  return timeSeries(series, {
    id: `climb-${play.id}`,
    x: { label: 'Release', domain: axis.domain, categories: axis.categories },
    // Headroom above SOLVED keeps ruling heads off the solved marks.
    y: { label: climb.y?.label ?? 'Check progress', unit: '', domain: [-0.05, 1.06], ...(ticks.length ? { ticks } : {}), strip: 'score not recorded' },
    formatY: stageAt(climb),
    markers: { circle: 'check', diamond: 'gate' },
    bands: axis.bands,
    marks,
    // The checker legend above the plot names every series; the verdict key under it stays.
    legend: false,
    width,
  })
}

interface TimedRow {
  columnId: string | null
  runId: string | null
  kind: string
  checker: string | null | undefined
  verdict: string
  count: number | null | undefined
  calibration: string | null
  firstAt: string | null | undefined
  lastAt: string | null | undefined
  line: string | null | undefined
  progress: number | null
  workloads: { passed?: number | null; total?: number | null } | null
}

/** Every timed row of the climb in one shape: its checks and gates with a score, and the strip of verdicts without one. */
function timedRows(climb: Climb): TimedRow[] {
  const marks = climb.marks.map((mark): TimedRow => ({ columnId: mark.columnId, runId: null, kind: mark.kind, checker: mark.checker, verdict: mark.verdict, count: mark.count, firstAt: mark.firstAt, lastAt: mark.lastAt, line: mark.line, progress: mark.progress ?? null, workloads: mark.workloads ?? null, calibration: mark.calibration ?? null }))
  const strip = (climb.strip ?? []).map((item): TimedRow => ({ columnId: item.columnId ?? null, runId: item.runId, kind: item.kind, checker: item.checker, verdict: item.verdict, count: item.count, firstAt: item.firstAt, lastAt: item.lastAt, line: item.line, progress: null, workloads: item.score?.workloads ?? null, calibration: item.calibration ?? null }))
  return [...marks, ...strip].filter((row) => ms(row.firstAt) !== undefined)
}

/** The play's checked span: from the first group's start (or first row) to the last group's end (or last row). */
function timeExtent(climb: Climb): [number, number] | null {
  const xs = [
    ...climb.groups.flatMap((group) => [ms(group.from), ms(group.to)]),
    ...timedRows(climb).flatMap((row) => [ms(row.firstAt), ms(row.lastAt)]),
  ].filter((x): x is number => x !== undefined)
  if (!xs.length) return null
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return hi > lo ? [lo, hi] : [lo - 3_600_000, hi + 3_600_000]
}

/**
 * The climb on wall-clock time, read in five seconds: the current check is the one saturated line, each earlier check a
 * muted dashed one for context, and every check change a labelled event. Only the first, best, level-change and last
 * releases of the current check carry a label, and an earlier check only its best, so labels never pile up. A row
 * recorded n times sits at its last time with its count.
 */
const GAP_MS = 6 * 3_600_000
function climbTimeFigure(play: Play, climb: Climb, width: number, window: [number, number], earlier: boolean) {
  const [lo, hi] = window
  const current = play.checkers?.find((checker) => checker.current)?.label ?? null
  const columns = new Map(climb.columns.map((column) => [column.id, column]))
  const byChecker = new Map<string, TimePoint[]>()
  for (const item of timedRows(climb)) {
    const x = ms(item.lastAt) ?? ms(item.firstAt)!
    if (x < lo || x > hi || item.progress === null) continue
    const isCurrent = item.checker === current
    if (!isCurrent && !earlier) continue
    const tag = shortTag((item.columnId ? columns.get(item.columnId)?.tag : null) ?? null)
    const workloads = item.workloads?.total ? `${item.workloads.passed ?? '?'}/${item.workloads.total} workloads` : null
    const points = byChecker.get(item.checker ?? '') ?? []
    points.push({
      x,
      y: Math.max(0, Math.min(1, item.progress)),
      ...(item.verdict === 'superseded' ? {} : { verdict: markVerdict(item.verdict) }),
      marker: item.kind === 'gate' ? 'diamond' : 'circle',
      ...(item.verdict === 'solved' ? { glyph: 'check' as const } : {}),
      ...(item.count && item.count > 1 ? { count: item.count } : {}),
      annotation: [`${checkerLabel(play.checkers, item.checker)} · ${tag ?? 'untagged'} · ${item.kind === 'gate' ? 'tag gate' : 'check'}: ${verdictWord(item.verdict)}`, workloads, utc(item.lastAt ?? item.firstAt), lineReason(item.line)].filter(Boolean).join(' · '),
      ...(tag ? { label: tag } : {}),
    })
    byChecker.set(item.checker ?? '', points)
  }
  // Labels: the current check's first, best, each new level and last; an earlier check's best alone.
  const labelled = (points: TimePoint[], all: boolean) => {
    const best = points.reduce((top, point) => ((point.y ?? 0) > (top.y ?? 0) ? point : top), points[0]!)
    let level = -1
    return points.map((point, i) => {
      const rises = (point.y ?? 0) > level
      level = Math.max(level, point.y ?? 0)
      const keep = point === best || (all && (i === 0 || i === points.length - 1 || rises))
      if (keep) return point
      const { label: _, ...rest } = point
      return rest
    })
  }
  // Points sharing a millisecond are spread by one each, so a series' times stay strictly increasing; a line breaks
  // across six hours without a check, so a gap between runs never reads as a climb.
  const increasing = (points: TimePoint[]) =>
    points.sort((a, b) => a.x - b.x).reduce<TimePoint[]>((out, point) => {
      const previous = out.at(-1)
      if (!previous) return [point]
      if (point.x - previous.x > GAP_MS) return [...out, { x: previous.x + 1, y: null }, point]
      return [...out, point.x <= previous.x ? { ...point, x: previous.x + 1 } : point]
    }, [])
  const series: TimeSeriesRow[] = [...byChecker.entries()]
    .map(([checker, points]) => {
      const isCurrent = checker === current
      return { id: checker || 'none', label: `${checkerLabel(play.checkers, checker)}${isCurrent ? ' (current)' : ''}`, points: labelled(increasing(points), isCurrent), colorIndex: isCurrent ? 0 : CHECKER_HUES }
    })
    .sort((a, b) => b.colorIndex - a.colorIndex)
  // Each check change at the time it took effect; the first check is the start, not a change.
  const marks: ChartMark[] = (play.checkers ?? []).slice(1).flatMap((checker) => {
    const at = ms(checker.firstAt)
    return at !== undefined && at >= lo && at <= hi ? [{ at, label: `check ${checker.label}`, kind: 'ruling' as const }] : []
  })
  const lines = (climb.y?.gridlines ?? []).filter((item) => item.at >= 0 && item.at <= 1).map((item) => (item.at === 1 ? { ...item, label: 'solved' } : item))
  const ticks = lines.length && lines.every((item) => item.at === 1) ? [{ at: 0, label: 'not solved' }, ...lines] : lines
  const span = hi - lo
  return timeSeries(series, {
    id: `climb-time-${play.id}`,
    x: { label: 'Time (UTC)', domain: [lo, hi] },
    y: { label: climb.y?.label ?? 'Check progress', unit: '', domain: [-0.05, 1.06], ...(ticks.length ? { ticks } : {}) },
    // Ticks fall at recorded times, so a multi-day axis names the hour too: two ticks on one day never read alike.
    formatX: (x) => (span < 36 * 3_600_000 ? `${new Date(x).toISOString().slice(11, 16)}Z` : `${new Date(x).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} ${new Date(x).toISOString().slice(11, 13)}h`),
    formatY: stageAt(climb),
    markers: { circle: 'check', diamond: 'tag gate' },
    marks,
    legend: false,
    width,
  })
}

/**
 * The time climb's brush: the play's whole checked span as one strip, each run a segment and each check a tick. Drag
 * across it to zoom the climb to that window; click a run to zoom to it; arrow keys step the window, + and − zoom, 0
 * shows everything.
 */
function ClimbBrush({ play, climb, extent, window, onWindow }: { play: Play; climb: Climb; extent: [number, number]; window: [number, number] | null; onWindow: (next: [number, number] | null) => void }) {
  const bar = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const [lo, hi] = extent
  const at = (x: number) => `${(((x - lo) / (hi - lo)) * 100).toFixed(3)}%`
  const fraction = (event: PointerEvent<HTMLDivElement>) => {
    const box = bar.current!.getBoundingClientRect()
    return lo + Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * (hi - lo)
  }
  const shown = drag ? [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] : window
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const [a, b] = window ?? extent
    const w = b - a
    const clamp = (x: number, y: number): [number, number] => (x < lo ? [lo, lo + (y - x)] : y > hi ? [hi - (y - x), hi] : [x, y])
    if (event.key === 'ArrowLeft') onWindow(clamp(a - w / 4, b - w / 4))
    else if (event.key === 'ArrowRight') onWindow(clamp(a + w / 4, b + w / 4))
    else if (event.key === '+' || event.key === '=') onWindow([a + w / 4, b - w / 4])
    else if (event.key === '-') { const next = clamp(a - w / 2, b + w / 2); onWindow(next[1] - next[0] >= hi - lo ? null : next) }
    else if (event.key === '0' || event.key === 'Escape') onWindow(null)
    else return
    event.preventDefault()
  }
  const ticks = useMemo(() => timedRows(climb).map((row) => ({ x: ms(row.firstAt)!, verdict: row.verdict })), [climb])
  // A run that starts within 4% of the strip after the last labelled one keeps its band and hover but no label:
  // 16a, 16b and 16d started minutes apart and their names printed over each other.
  const labelled = useMemo(() => {
    let last = -Infinity
    return climb.groups
      .filter((group) => ms(group.from) !== undefined)
      .map((group) => {
        const x = (ms(group.from)! - lo) / (hi - lo)
        const show = x - last >= 0.04
        if (show) last = x
        return { group, label: show ? shortRun(play.id, group.runId) || group.label : null }
      })
  }, [climb, lo, hi, play.id])
  return (
    <div className="climb-brush-wrap">
      <div className="climb-brush-runs" role="group" aria-label="Zoom to a run">
        <button type="button" className={`run-chip${window ? '' : ' on'}`} onClick={() => onWindow(null)} aria-pressed={!window}>All</button>
        {climb.groups.filter((group) => ms(group.from) !== undefined).map((group) => {
          const from = ms(group.from)!
          const to = ms(group.to) ?? hi
          const on = !!window && Math.abs(window[0] - from) < 60_000 && Math.abs(window[1] - to) < 60_000
          return (
            <button key={group.runId} type="button" className={`run-chip${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onWindow([from, to])} title={runSpan(group.from, group.to)}>
              {shortRun(play.id, group.runId) || group.label}
            </button>
          )
        })}
      </div>
      <div
        ref={bar}
        className="climb-brush"
        role="slider"
        tabIndex={0}
        aria-label="Climb time window"
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={(window ?? extent)[0]}
        aria-valuetext={window ? `${utc(new Date(window[0]).toISOString())} to ${utc(new Date(window[1]).toISOString())}` : 'the whole span'}
        onKeyDown={step}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          const x = fraction(event)
          setDrag({ a: x, b: x })
        }}
        onPointerMove={(event) => {
          if (drag) setDrag({ ...drag, b: fraction(event) })
        }}
        onPointerUp={(event) => {
          if (!drag) return
          const a = Math.min(drag.a, fraction(event))
          const b = Math.max(drag.a, fraction(event))
          setDrag(null)
          if (b - a > (hi - lo) * 0.01) onWindow([a, b])
          else {
            // A click picks the run under it.
            const group = climb.groups.find((item) => (ms(item.from) ?? Infinity) <= a && a <= (ms(item.to) ?? hi))
            if (group) onWindow([ms(group.from)!, ms(group.to) ?? hi])
          }
        }}
      >
        {labelled.map(({ group, label }) => (
          <span key={group.runId} className="climb-brush-run" style={{ left: at(ms(group.from)!), width: `calc(${at(ms(group.to) ?? hi)} - ${at(ms(group.from)!)})` }} title={`${shortRun(play.id, group.runId) || group.label} · ${runSpan(group.from, group.to)}`}>
            {label && <b>{label}</b>}
          </span>
        ))}
        {ticks.map((tick, i) => (
          // Ticks are history in neutral ink: a pass is filled, every other verdict an outline.
          <i key={i} className={`climb-brush-tick${markVerdict(tick.verdict) === 'pass' ? ' is-pass' : ''}`} style={{ left: at(tick.x) }} />
        ))}
        {shown && <span className="climb-brush-window" style={{ left: at(shown[0]), width: `calc(${at(shown[1])} - ${at(shown[0])})` }} />}
      </div>
    </div>
  )
}

/** The climb (chart a): check progress per checked release, grouped by run, one colour per checker. */
/**
 * A check that grades only pass or fail (no partial progress on any row) has no climb to draw: its releases read as one
 * verdict strip per run, each release's verdict under each checker with its count, the line on hover.
 */
function VerdictStrip({ play, climb }: { play: Play; climb: Climb }) {
  const rows = [...climb.marks, ...(climb.strip ?? [])]
  return (
    <ol className="verdict-strip" data-verdict-strip>
      {climb.groups.map((group) => {
        const columns = climb.columns.filter((column) => column.runId === group.runId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        const glyph = (group.end ? (ENDING_GLYPH[group.end.kind] ?? group.end.glyph ?? '') : '')
        return (
          <li key={group.runId}>
            <a className="mono verdict-strip-run" href={`/run/${encodeURIComponent(group.runId)}`} title={runSpan(group.from, group.to)}>
              {glyph} {shortRun(play.id, group.runId)}
            </a>
            <span className="verdict-strip-chips">
              {columns.length === 0 && <span className="faint">no release checked</span>}
              {columns.flatMap((column) =>
                rows
                  .filter((row) => row.columnId === column.id)
                  .map((row, i) => {
                    const status = statusOf({ axis: 'result', verdict: row.verdict, current: play.checkers?.find((item) => item.sha256 === row.checker || item.label === row.checker)?.current ?? true, held: group.held?.stages ?? null })
                    return (
                    <span
                      key={`${column.id}:${i}`}
                      className="verdict-chip"
                      data-status={dataStatus(status)}
                      data-calibration={row.calibration ?? undefined}
                      style={{ ['--checker' as string]: checkerColor(checkerIndex(play.checkers, row.checker) ?? 9) }}
                      title={[`${row.kind === 'gate' ? 'tag gate' : 'check'} under ${checkerLabel(play.checkers, row.checker)}: ${verdictWord(row.verdict)}`, row.calibration ? `check ${row.calibration}` : null, row.line, utc(row.lastAt ?? row.firstAt)].filter(Boolean).join('\n')}
                    >
                      {status.shape} {shortTag(column.tag) ?? 'workspace'}
                      {row.count && row.count > 1 ? ` ×${row.count}` : ''}
                    </span>
                    )
                  }),
              )}
            </span>
            {/* Every verdict of a run names the calibration its check registered at press: the stages, once per run. */}
            {group.calibration && <CalibrationLabels calibration={group.calibration} field={`climb.groups.${group.runId}.calibration`} />}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * What each run's checks said, newest run first: its rows, the checkers that ran, and its lines grouped by reason with
 * their counts and the releases they were said of. A check without a SCORE line has no height on the climb; this is
 * where its record still reads, such as 17c moving from "magnetar.json is missing" to the prover failing on keccak.
 */
function ChecksSaid({ play, climb }: { play: Play; climb: Climb }) {
  const byRun = useMemo(() => checksByRun(climb), [climb])
  const runs = [...climb.groups].reverse().map((group) => byRun.get(group.runId)).filter((run): run is NonNullable<typeof run> => !!run && run.rows > 0)
  if (!runs.length) return null
  // One line per run, its most frequent reason and how often it was said; the rest open on click (lead 05:45Z).
  return (
    <div className="checks-said" data-checks-said>
      <h4>What the checks said</h4>
      <ol>
        {runs.map((run) => {
          const lines = [...run.lines].sort((a, b) => String(a.firstAt).localeCompare(String(b.firstAt)))
          const top = [...lines].sort((a, b) => b.count - a.count)[0]
          return (
            <li key={run.runId} data-run={run.runId}>
              <details>
                <summary className="checks-said-run" title={`${run.rows} rows under ${run.checkers.map((checker) => checkerLabel(play.checkers, checker)).join(', ')}${run.solved ? `, ${run.solved} solved` : ''}`}>
                  <a className="mono" href={`/run/${encodeURIComponent(run.runId)}`}>{shortRun(play.id, run.runId)}</a>
                  {top && <> <b className="num">{top.count}×</b> <span className="checks-said-reason">{top.reason}</span></>}
                  {lines.length > 1 && <span className="faint"> +{lines.length - 1}</span>}
                </summary>
                <ul>
                  {lines.map((line) => (
                    <li key={line.reason} title={[line.line, line.firstAt ? `${utc(line.firstAt)} to ${utc(line.lastAt)}` : null, line.verdicts.map(verdictWord).join(', ')].filter(Boolean).join('\n')}>
                      <b className="num">{line.count}×</b>
                      <span className="checks-said-reason">{line.reason}</span>
                      <span className="faint mono">{tagsWords(line.tags) ?? ''}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * @tangle-network/charts 0.12 names an unknown verdict "undecided" in its key, data table and hover (plan item D6); the
 * pages say "unverified" (design-system section 1). A figure is plain strings, so the word is replaced outside class names.
 */
const inGrammar = <T,>(figure: T): T => JSON.parse(JSON.stringify(figure).replace(/(?<![-\w])undecided\b/g, VERDICT_WORDS.undecided!)) as T

const initialMode = (): 'release' | 'time' => (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('climb') === 'release' ? 'release' : 'time')

export function PlayClimb({ play }: { play: Play }) {
  const climb = play.climb ?? null
  // Partial progress on any row makes a climb; a check that only passes or fails is a verdict strip.
  const graded = !!climb && climb.marks.some((mark) => mark.progress !== null && mark.progress > 0.001 && mark.progress < 0.999)
  const [mode, setMode] = useState<'release' | 'time'>(initialMode)
  const extent = useMemo(() => (climb ? timeExtent(climb) : null), [climb])
  // A phone opens on the current check alone, from its first check: every check and release at 358 px would collide.
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  const since = ms(play.checkers?.find((checker) => checker.current)?.firstAt)
  const [range, setRange] = useState<[number, number] | null>(() => (narrow && extent && since !== undefined && since > extent[0] ? [since - 3_600_000, extent[1]] : null))
  const [earlier, setEarlier] = useState(!narrow)
  const timed = mode === 'time' && !!extent
  // Drawn at the section's measured width, so the climb's labels and marks keep their set size on a wide page.
  const figure = useCallback((width: number) => inGrammar(timed ? climbTimeFigure(play, climb!, width, range ?? extent!, earlier) : climbFigure(play, climb!, width)), [play, climb, timed, range, extent, earlier])
  const choose = (next: 'release' | 'time') => {
    setMode(next)
    const url = new URL(window.location.href)
    if (next === 'release') url.searchParams.set('climb', 'release')
    else url.searchParams.delete('climb')
    window.history.replaceState(null, '', url)
  }
  if (!climb || (!graded && !climb.marks.length && !(climb.strip ?? []).length)) return null
  const counted = new Map<string, number>()
  for (const mark of [...climb.marks, ...(climb.strip ?? [])]) counted.set(mark.checker ?? '', (counted.get(mark.checker ?? '') ?? 0) + (mark.count ?? 1))
  return (
    <section className="ws-section play-climb" data-play-climb aria-label="Climb">
      <header className="section-head">
        <h3>Climb</h3>
        <p className="climb-key faint" aria-label="Marks">● pass ○ fail ◆ gate</p>
        {graded && extent && (
          <div className="seg climb-mode" role="group" aria-label="Climb axis">
            <button type="button" aria-pressed={!timed} onClick={() => choose('release')}>By release</button>
            <button type="button" aria-pressed={timed} onClick={() => choose('time')}>Over time</button>
          </div>
        )}
      </header>
      {play.checkers && play.checkers.length > 0 && (
        <p className="checker-legend" aria-label="Checkers">
          {play.checkers.filter((checker) => checker.current).map((checker) => (
            <span key={checker.sha256} title={checkerTitle(checker)} style={{ ['--checker' as string]: checkerColor(0) }} data-current="yes">
              <i aria-hidden="true" />
              <b>{checker.label}</b> current check · {checker.rows ?? counted.get(checker.label) ?? 0} rows
            </span>
          ))}
          {timed && play.checkers.length > 1 && (
            <label className="checker-earlier">
              <input type="checkbox" checked={earlier} onChange={(event) => setEarlier(event.target.checked)} />
              {` earlier checks ${play.checkers.filter((checker) => !checker.current).map((checker) => checker.label).join(', ')}`}
            </label>
          )}
        </p>
      )}
      {graded && timed && <ClimbBrush play={play} climb={climb} extent={extent!} window={range} onWindow={setRange} />}
      {graded ? <FigureView figure={figure} /> : <VerdictStrip play={play} climb={climb} />}
      <ChecksSaid play={play} climb={climb} />
    </section>
  )
}

/** A metric's y domain from its points and targets, padded; log domains stay positive. */
function domainOf(metric: PlayBarMetric, values: number[]): [number, number] {
  const { factor } = displayUnitFor(metric)
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
  const { factor } = displayUnitFor(metric)
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
    return (width: number) => inGrammar(barFigure(play, climb, bar, width))
  }, [play, climb, bar])
  if (!figure || !barPanels(play).length) return null
  return (
    <section className="ws-section play-bar" data-play-bar aria-label="Against the bar">
      <header className="section-head">
        <h3 title={[bar?.source, bar?.condition ? `Bar: ${bar.condition}` : null, bar?.checkCondition ? `Ours: ${bar.checkCondition}` : null].filter(Boolean).join('\n') || undefined}>Against the bar</h3>
      </header>
      <FigureView figure={figure} />
    </section>
  )
}

/** The bar metrics that have a series to draw (precondition metrics are the check's job, not a panel). */
const barPanels = (play: Play) => (play.bar?.metrics ?? []).filter((metric) => !metric.precondition && play.barSeries?.some((item) => item.metric === metric.id))

function barFigure(play: Play, climb: Climb, bar: NonNullable<Play['bar']>, width: number) {
  const axis = releaseAxis(play, climb)
  const metrics = bar.metrics.filter((metric) => !metric.precondition)
  const panels = metrics.flatMap((metric): MultiplePanel[] => {
    const series = play.barSeries!.find((item) => item.metric === metric.id)
    if (!series) return []
    const shown = displayUnitFor(metric)
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
          annotation: [metricValue(point.value, metric.unit), verdictWord(point.verdict), point.note ? hostWords(point.note) : null, point.basis ? `from ${point.basis}` : null].filter(Boolean).join(' · '),
        }
      })
    const domain = domainOf(metric, points.map((point) => point.y!).filter((value) => value !== null))
    const label = `${metric.label}${metric.direction ? (metric.direction === 'up' ? ' ↑' : ' ↓') : ''}`
    if (!points.length) return [{ id: metric.id, label, unit: shown.unit, domain, missing: { why: series.missing?.why ?? 'not measured on any checked release' } }]
    return [{ id: metric.id, label, unit: shown.unit, domain, points, scale: metric.scale ?? 'linear', targets: targetsOf(metric), format: compactNumber }]
  })
  if (!panels.length) return { id: `bar-${play.id}`, refused: 'No bar metric was measured on a checked release.' }
  // Four panels a row once each has about 280 px for its release labels; two below that.
  return smallMultiples(panels, {
    id: `bar-${play.id}`,
    x: { label: 'Release', domain: axis.domain, categories: axis.categories },
    y: { label: 'Measured value', unit: panels[0]!.unit ?? '', domain: [0, 1] },
    shared: 'x',
    noun: 'metric',
    columns: Math.min(width >= 1120 ? 4 : 2, panels.length),
    connect: false,
    markers: { circle: 'check', diamond: 'gate' },
    width,
  })
}
