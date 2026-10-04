import { useMemo, useState } from 'react'
import type { AssessmentRow, AssessmentsDocument, Dimension, DimensionsDocument } from '../assessment.js'
import type { EventFlag } from '../viewer/Conversation.js'
import type { RecordIndex } from '../viewer/model.js'
import { utcTime } from '../viewer/model.js'
import type { PlayDocument } from '../workspace.js'
import { duration, money, when } from './data.js'

/** A System One distribution without calibration never colours a cell. */
export const shownPolarity = (row: Pick<AssessmentRow, 'method' | 'decider' | 'status'>, polarity: string) =>
  row.status !== 'decided' ? 'unknown' : row.method === 'systemone' && row.decider.calibrated !== true ? 'uncalibrated' : polarity

export function polarityOf(dimensions: Map<string, Dimension>, dimension: string, label: string) {
  return dimensions.get(dimension)?.scale.find((item) => item.label === label)?.polarity ?? 'unknown'
}

export function dimensionMap(doc: DimensionsDocument | undefined) {
  return new Map((doc?.dimensions ?? []).map((dimension) => [dimension.id, dimension]))
}

export function flagsFrom(rows: readonly AssessmentRow[], dimensions: Map<string, Dimension>) {
  const flags = new Map<string, EventFlag[]>()
  for (const row of rows) {
    if (row.status !== 'decided') continue
    // Only a decided adverse label marks the trace; uncalibrated distributions never do.
    const polarity = shownPolarity(row, polarityOf(dimensions, row.dimension, row.label))
    if (polarity !== 'bad') continue
    const dimension = dimensions.get(row.dimension)
    const title = `${row.dimension} ${dimension?.key.replaceAll('_', ' ') ?? ''}: ${row.label}`
    for (const id of new Set([...row.subject.eventIds, ...row.evidence.map((item) => item.eventId)])) {
      const list = flags.get(id) ?? []
      if (!list.some((flag) => flag.dimension === row.dimension)) list.push({ dimension: row.dimension, label: row.label, polarity, title })
      flags.set(id, list)
    }
  }
  return flags
}

const RANK: Record<string, number> = { bad: 4, uncalibrated: 3, unknown: 2, neutral: 1, good: 0 }

export function AssessmentMatrix({
  play,
  dimensions,
  onOpen,
}: {
  play: PlayDocument
  dimensions: DimensionsDocument | undefined
  onOpen: (runId: string, dimension?: string) => void
}) {
  const headline = (dimensions?.dimensions ?? []).filter((dimension) => dimension.headline)
  // One cell per run and dimension: the most adverse decided label; uncalibrated distributions do not colour.
  const cells = new Map<string, PlayDocument['assessments'][number] & { shown: string; subjects: number }>()
  for (const row of play.assessments) {
    const uncalibrated = row.method === 'systemone' && row.calibrated !== true
    const shown = row.status !== 'decided' ? 'unknown' : uncalibrated ? 'uncalibrated' : row.polarity
    const key = `${row.runId}\0${row.dimension}`
    const current = cells.get(key)
    if (!current || (RANK[shown] ?? 0) > (RANK[current.shown] ?? 0)) cells.set(key, { ...row, shown, subjects: (current?.subjects ?? 0) + 1 })
    else current.subjects++
  }
  const runs = play.runs.filter((run) => run.kind !== 'search')
  if (!headline.length) return <p className="chat-empty">The dimension catalogue is unavailable.</p>
  return (
    <div className="matrix-scroll" data-assessment-matrix>
      <table className="matrix">
        <thead>
          <tr>
            <th className="matrix-run">Run</th>
            {headline.map((dimension) => (
              <th key={dimension.id} title={dimension.question}>
                <span className="dim-id">{dimension.id}</span>
                <span className="dim-key">{dimension.key.replaceAll('_', ' ')}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <th className="matrix-run">
                <a href={`/run/${encodeURIComponent(run.id)}`} onClick={(event) => { event.preventDefault(); onOpen(run.id) }}>
                  {run.id.startsWith(play.id + '-') ? run.id.slice(play.id.length + 1) : run.id}
                </a>
              </th>
              {headline.map((dimension) => {
                const cell = cells.get(`${run.id}\0${dimension.id}`)
                const polarity = cell ? cell.shown : 'none'
                return (
                  <td key={dimension.id}>
                    {cell ? (
                      <button
                        type="button"
                        className={`matrix-cell polarity-${polarity}`}
                        title={`${dimension.id} ${dimension.key}: ${cell.label} (${cell.status})`}
                        onClick={() => onOpen(run.id, dimension.id)}
                      >
                        {cell.label.replaceAll('_', ' ')}
                      </button>
                    ) : (
                      <span className="matrix-cell polarity-none" title="Not assessed">·</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Decider({ row }: { row: AssessmentRow }) {
  const decider = row.decider
  if (row.method === 'rule') return <span>rule {decider.ruleId ?? 'unnamed'}</span>
  if (row.method === 'human') return <span>human label</span>
  if (row.method === 'judge')
    return (
      <span>
        judge {decider.model ?? 'model unknown'}
        {decider.harness ? ` · ${decider.harness}` : ''}
        {decider.account ? ` · ${decider.account}` : ''}
      </span>
    )
  return (
    <span>
      System One {decider.model ?? ''} · {decider.calibrated ? 'calibrated' : 'uncalibrated'}
    </span>
  )
}

/** Every dimension of the catalogue as one scorecard, then the selected dimension's rows and citations. */
export function RunAssessments({
  doc,
  dimensions,
  index,
  node,
  focus,
  onFocus,
  onCite,
}: {
  doc: AssessmentsDocument | undefined
  dimensions: DimensionsDocument | undefined
  index: RecordIndex | null
  node?: string
  focus?: string | null
  onFocus: (dimension: string) => void
  onCite: (eventId: string) => void
}) {
  const [scope, setScope] = useState<'run' | 'agent'>('run')
  const [allCitations, setAllCitations] = useState(false)
  const catalogue = useMemo(() => dimensionMap(dimensions), [dimensions])
  const rows = doc?.rows ?? []
  const visible = rows.filter((row) => scope === 'run' || !node || row.subject.nodeId === node)
  const byDimension = useMemo(() => {
    const map = new Map<string, AssessmentRow[]>()
    for (const row of visible) map.set(row.dimension, [...(map.get(row.dimension) ?? []), row])
    return map
  }, [visible])
  if (!dimensions) return <p className="chat-empty">The dimension catalogue is unavailable.</p>
  const summary = (dimension: Dimension) => {
    const list = byDimension.get(dimension.id) ?? []
    if (!list.length) return null
    const ranked = list
      .map((row) => ({ row, polarity: shownPolarity(row, polarityOf(catalogue, row.dimension, row.label)) }))
      .sort((a, b) => (RANK[b.polarity] ?? 0) - (RANK[a.polarity] ?? 0))
    const worst = ranked[0]!
    const labels = new Set(list.map((row) => row.label))
    return { label: worst.row.label, polarity: worst.polarity, subjects: list.length, mixed: labels.size > 1, stale: list.some((row) => row.status === 'stale') }
  }
  const firstAdverse = (dimensions.dimensions ?? []).find((dimension) => summary(dimension)?.polarity === 'bad')?.id
  const selected = (focus && catalogue.has(focus) ? focus : null) ?? firstAdverse ?? (dimensions.dimensions ?? []).find((dimension) => byDimension.has(dimension.id))?.id
  const dimension = selected ? catalogue.get(selected) : undefined
  const list = selected ? (byDimension.get(selected) ?? []) : []
  return (
    <div className="run-assessments" data-run-assessments>
      <div className="assessment-toolbar">
        <div className="segmented" role="group" aria-label="Assessment scope">
          <button type="button" aria-pressed={scope === 'run'} onClick={() => setScope('run')}>Whole run</button>
          <button type="button" aria-pressed={scope === 'agent'} disabled={!node} onClick={() => setScope('agent')}>Selected agent</button>
        </div>
        {doc?.recordDigest && <span className="mono faint">record {doc.recordDigest.slice(0, 12)}</span>}
      </div>
      <div className="scorecard" data-scorecard>
        {dimensions.groups.map((group) => (
          <div key={group.id} className="scorecard-group">
            <span className="scorecard-name"><span className="dim-id">{group.id}</span>{group.name}</span>
            <span className="scorecard-cells">
              {dimensions.dimensions
                .filter((item) => item.group === group.id)
                .map((item) => {
                  const cell = summary(item)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`score-cell polarity-${cell?.polarity ?? 'none'} ${selected === item.id ? 'selected' : ''} ${item.headline ? 'headline' : ''} ${cell?.stale ? 'stale' : ''}`}
                      data-dim={item.id}
                      title={`${item.id} ${item.key.replaceAll('_', ' ')}: ${cell ? `${cell.label}${cell.mixed ? ' and others' : ''}` : 'not assessed'}\n${item.question}`}
                      onClick={() => onFocus(item.id)}
                    >
                      <span className="score-id">{item.id}</span>
                      <span className="score-label">{cell ? cell.label.replaceAll('_', ' ') : item.key.replaceAll('_', ' ')}</span>
                      {cell && cell.subjects > 1 && <span className="score-count">{cell.subjects}</span>}
                    </button>
                  )
                })}
            </span>
          </div>
        ))}
      </div>
      {dimension && (
        <section className="assessment-dimension focused" data-dimension={dimension.id} id={`dim-${dimension.id}`}>
          <div className="dimension-head">
            <span className="dim-id">{dimension.id}</span>
            <strong>{dimension.key.replaceAll('_', ' ')}</strong>
            <span className="faint">{dimension.unit} · {dimension.decider}</span>
            <span className="dim-question">{dimension.question}</span>
          </div>
          <div className="scale">
            {dimension.scale.map((item) => (
              <span key={item.label} className={`label-chip polarity-${item.polarity}`} title={item.meaning}>{item.label.replaceAll('_', ' ')}</span>
            ))}
          </div>
          {!list.length && <p className="assessment-empty">Not assessed for this run.</p>}
          {list.map((row) => {
            const polarity = shownPolarity(row, polarityOf(catalogue, row.dimension, row.label))
            const subject = row.subject.nodeId ? index?.nodes.get(row.subject.nodeId)?.label ?? row.subject.nodeId : 'whole run'
            const citations = allCitations ? row.evidence : row.evidence.slice(0, 12)
            return (
              <div key={row.id} className="assessment-row" data-assessment={row.id}>
                <div className="assessment-line">
                  <span className={`label-chip polarity-${polarity}`}>{row.label.replaceAll('_', ' ')}</span>
                  <span className="mono">{subject}</span>
                  {row.status !== 'decided' && <span className="status-chip">{row.status}{row.reason ? `: ${row.reason}` : ''}</span>}
                  <span className="decider"><Decider row={row} /></span>
                  <span className="faint">{row.decider.costUsd === null ? 'cost unknown' : money(row.decider.costUsd)}</span>
                  <time className="faint">{when(row.at)}</time>
                </div>
                {row.measure && row.status === 'decided' && (
                  <p className="assessment-measure">
                    {[
                      row.measure.count !== undefined ? `${row.measure.count} events` : null,
                      row.measure.ms === null ? 'time not measured' : row.measure.ms !== undefined ? duration(row.measure.ms) : null,
                      row.measure.tokens !== undefined ? `${row.measure.tokens} tokens` : null,
                      row.measure.listUsd !== undefined ? `${money(row.measure.listUsd)} list` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
                {row.probabilities && (
                  <div className="distribution" title="System One distribution; uncalibrated rows do not set a colour">
                    {Object.entries(row.probabilities)
                      .sort((a, b) => b[1] - a[1])
                      .map(([label, p]) => (
                        <span key={label} className="distribution-bar">
                          <i style={{ width: `${Math.round(p * 100)}%` }} />
                          <span>{label} {Math.round(p * 100)}%</span>
                        </span>
                      ))}
                  </div>
                )}
                {row.evidence.length > 0 && (
                  <ul className="citations">
                    {citations.map((cite) => {
                      const event = index?.byEvent.get(cite.eventId)
                      return (
                        <li key={cite.eventId}>
                          <button type="button" className="citation" data-cite={cite.eventId} disabled={!event} onClick={() => onCite(cite.eventId)}>
                            <span className="mono">{event ? `${index?.nodes.get(event.node)?.label ?? event.node} · ${utcTime(event.at)}` : cite.eventId}</span>
                            {event && <span className="citation-label">{event.label}</span>}
                          </button>
                          {cite.quote && <q>{cite.quote.length > 280 ? `${cite.quote.slice(0, 280)}…` : cite.quote}</q>}
                        </li>
                      )
                    })}
                    {row.evidence.length > citations.length && (
                      <li><button type="button" className="ui-button" onClick={() => setAllCitations(true)}>All cited events</button></li>
                    )}
                  </ul>
                )}
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
