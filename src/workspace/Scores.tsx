import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { HumanGrade, PanelReview, Readout, ReadoutChart } from '../workspace.js'
import { useDocument, when } from './data.js'
import { sameOriginHref } from './final-output.js'
import { chartPairs, scoreRows, type ScoreRow } from './scores.js'

const pageHref = (href: string | null | undefined) => (typeof window === 'undefined' ? null : sameOriginHref(href, window.location.href))

/** Who is looking and whether they may write: only the writer listener names a tailnet login. */
export function useMe(api: string) {
  const me = useDocument<{ login: string | null; writer: boolean }>(`${api}/me`)
  return me.data ?? { login: null, writer: false }
}

const scoreCell = (value: number | null | undefined) => (typeof value === 'number' ? String(value) : '—')

/**
 * Every score of one target side by side on the absolute 0–100 vs world-class scale: the readout's AI judges, the AI
 * persona panel (median, range and how many) and people's latest grades. A cell nobody scored is a dash.
 */
export function ScoresTable({
  readout,
  panel,
  grades,
  target,
}: {
  readout: Readout | null | undefined
  panel: readonly PanelReview[] | null | undefined
  grades: readonly HumanGrade[] | null | undefined
  target: { kind: HumanGrade['target']['kind']; id: string }
}) {
  const rows = scoreRows(target.kind === 'run' ? readout : null, target.kind === 'run' ? panel : null, grades, target)
  const any = rows.some((row) => row.ai || row.personas.scores.length || row.people.length)
  if (!any) return <p className="faint">Nobody has scored this yet: no AI judge on the absolute scale, no persona panel, no person.</p>
  const people = [...new Set(rows.flatMap((row) => row.people.map((grade) => grade.by)))]
  return (
    <div className="table-scroll">
      <table className="data-table scores-table" data-scores={target.kind}>
        <thead>
          <tr>
            <th>0–100 vs world class</th>
            <th className="num" title="The readout's AI judge; advisory unless calibrated">AI judge</th>
            <th className="num" title="Median of the AI persona panel, with its range">AI personas</th>
            {people.map((by) => <th key={by} className="num">{by.split('@')[0]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ScoreRowView key={row.category} row={row} people={people} />
          ))}
        </tbody>
      </table>
      <p className="faint scores-key">
        AI judges are advisory unless marked ✓ calibrated. AI personas are the persona panel: median, range and how many scored.
        {people.length ? ' A person’s column is that person’s latest grade.' : ''}
      </p>
    </div>
  )
}

function ScoreRowView({ row, people }: { row: ScoreRow; people: string[] }) {
  const personas = row.personas
  return (
    <tr data-score-row={row.category}>
      <td><b>{row.category}</b></td>
      <td className="num" title={row.ai === 'retired' ? 'Judged on the retired relative 0–4 scale; not shown' : row.ai ? (row.ai.calibrated ? 'calibrated' : 'advisory') : 'no AI judge'}>
        {row.ai === 'retired' ? <span className="faint">retired scale</span> : row.ai ? (
          <>
            {scoreCell(row.ai.score)}
            {row.ai.calibrated ? <span className="state-ok" title="calibrated"> ✓</span> : null}
          </>
        ) : '—'}
      </td>
      <td
        className="num"
        title={personas.scores.map((item) => `${item.persona}: ${item.score}${item.band ? ` (${item.band})` : ''}`).join('\n') || 'no persona scored this'}
      >
        {personas.median !== null ? (
          <>
            {scoreCell(personas.median)}
            <span className="faint">
              {' '}
              {personas.min}–{personas.max} · {personas.scores.length}
            </span>
          </>
        ) : '—'}
      </td>
      {people.map((by) => {
        const grade = row.people.find((item) => item.by === by)
        return (
          <td key={by} className="num" title={grade ? `${grade.comment || 'no comment'} · ${when(grade.at)}` : undefined}>
            {grade ? grade.score : '—'}
          </td>
        )
      })}
    </tr>
  )
}

/**
 * A one-tap grade on the absolute 0–100 vs world-class scale, with a comment, for a writer only. Tapping the track
 * picks the score; Save appends it beside the run's readout, where the Lab can calibrate its judges against it.
 */
export function GradeControl({
  api,
  runId,
  target,
  label,
  current,
  onSaved,
}: {
  api: string
  runId: string
  target: { kind: HumanGrade['target']['kind']; id: string }
  label: string
  current?: HumanGrade | null
  onSaved?: (grade: HumanGrade) => void
}) {
  const me = useMe(api)
  const [score, setScore] = useState<number | null>(current?.score ?? null)
  const [comment, setComment] = useState('')
  const [state, setState] = useState<{ saving?: boolean; saved?: HumanGrade; error?: string }>({})
  if (!me.writer) return null
  const pick = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    if ('key' in event) {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'PageUp' ? 10 : event.key === 'PageDown' ? -10 : 0
      if (!step) return
      event.preventDefault()
      setScore((value) => Math.max(0, Math.min(100, (value ?? 50) + step)))
      return
    }
    const box = event.currentTarget.getBoundingClientRect()
    setScore(Math.max(0, Math.min(100, Math.round(((event.clientX - box.left) / box.width) * 100))))
  }
  const save = async () => {
    if (score === null) return
    setState({ saving: true })
    try {
      const response = await fetch(`${api}/runs/${encodeURIComponent(runId)}/grades`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, score, comment, category: 'overall' }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
      setState({ saved: body as HumanGrade })
      setComment('')
      onSaved?.(body as HumanGrade)
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : 'Not saved' })
    }
  }
  const id = `grade-${target.kind}-${target.id}`.replace(/[^A-Za-z0-9_-]/g, '-')
  return (
    <div className="grade-control" data-grade={target.kind}>
      <div className="grade-head">
        <span className="answer-label">{label}</span>
        <b className="grade-value">{score === null ? 'tap the scale' : `${score} of 100`}</b>
        {current && !state.saved && <span className="faint">your last: {current.score} · {when(current.at)}</span>}
      </div>
      <div
        className="grade-track"
        role="slider"
        tabIndex={0}
        aria-label={`${label}, 0 to 100 against world class`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score ?? undefined}
        onClick={pick}
        onKeyDown={pick}
      >
        <span className="grade-band" title="World class" />
        {score !== null && <i style={{ left: `${score}%` }} />}
      </div>
      <div className="grade-ticks faint"><span>0</span><span>50</span><span>world class</span><span>100</span></div>
      <label className="grade-comment" htmlFor={id}>
        <span className="faint">What would make it world class? (optional)</span>
        <textarea id={id} rows={2} maxLength={4000} value={comment} onChange={(event) => setComment(event.target.value)} />
      </label>
      <div className="grade-actions">
        <button type="button" className="ui-button" disabled={score === null || state.saving} onClick={save}>
          {state.saving ? 'Saving…' : 'Save grade'}
        </button>
        {state.saved && <span className="faint" role="status">Saved {state.saved.score} of 100 as {state.saved.by} · {when(state.saved.at)}</span>}
        {state.error && <span className="grade-error" role="alert">Not saved: {state.error}</span>}
        <span className="faint">as {me.login}</span>
      </div>
    </div>
  )
}

/** The charts the readout drew from the run's outputs, each with its title, unit and caption. */
export function ChartGallery({ charts }: { charts: readonly ReadoutChart[] | null | undefined }) {
  if (!charts?.length) return null
  return (
    <div className="chart-gallery" data-charts={charts.length}>
      {charts.map((chart) => <ChartFigure key={chart.id} chart={chart} />)}
    </div>
  )
}

function ChartFigure({ chart, label }: { chart: ReadoutChart | null; label?: string }) {
  if (!chart) return <figure className="chart-figure chart-none"><p className="faint">{label ? `${label}: ` : ''}no such chart</p></figure>
  const href = pageHref(chart.href)
  return (
    <figure className="chart-figure" data-chart={chart.id}>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          <img src={href} alt={chart.title ?? chart.id} loading="lazy" width={chart.width ?? undefined} height={chart.height ?? undefined} />
        </a>
      ) : (
        <p className="faint">not served</p>
      )}
      <figcaption>
        {label && <span className="faint">{label} · </span>}
        <b>{chart.title ?? chart.id}</b>
        {chart.unit && <span className="faint"> · {chart.unit}</span>}
        {chart.caption && <span className="faint chart-caption"> {chart.caption}</span>}
      </figcaption>
    </figure>
  )
}

/** Two versions' readout charts, before and after: the same chart where both drew it, else charts of the same unit. */
export function ChartPairsView({ before, after, beforeLabel, afterLabel }: { before: readonly ReadoutChart[] | null | undefined; after: readonly ReadoutChart[] | null | undefined; beforeLabel: string; afterLabel: string }) {
  const pairs = chartPairs(before, after)
  if (!pairs.length) return <p className="faint">Neither version's readout drew a chart.</p>
  return (
    <div className="chart-pairs" data-chart-pairs={pairs.length}>
      <p className="faint">
        The charts each readout drew from its run's outputs. Paired by the same chart, else by unit; a unit pair can plot a
        different breakdown, so read both titles.
      </p>
      {pairs.map((pair, i) => (
        <div key={i} className="chart-pair" data-chart-pair={pair.match ?? 'single'}>
          <ChartFigure chart={pair.before} label={beforeLabel} />
          <ChartFigure chart={pair.after} label={afterLabel} />
        </div>
      ))}
    </div>
  )
}
