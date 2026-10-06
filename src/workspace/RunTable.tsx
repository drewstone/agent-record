import { useMemo } from 'react'
import type { AssessmentRow, Dimension } from '../assessment.js'
import type { RecordNode } from '../record.js'
import type { RecordIndex } from '../viewer/model.js'
import { agentState, ms, roleOf } from '../viewer/model.js'
import type { ProgressBrief, RunDocument } from '../workspace.js'
import { polarityOf, shownPolarity } from './Assessments.js'
import { duration, money, stateClass, tokens } from './data.js'
import { externalHref } from './final-output.js'
import { briefLines } from './outputs.js'
import { absoluteJudges, absoluteMedian } from './profile-compare.js'

/** Per agent, from the record's `nodes` part: event count, first and last event, recorded usage and list price. */
export interface NodeStats {
  events: number
  firstAt: string | null
  lastAt: string | null
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } | null
  listUsd: number | null
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const utcTime = (value: string | null | undefined) => (value ? `${value.slice(11, 16)} UTC` : 'time unknown')

/**
 * The run's answer in one pinned strip: how it ended, what it delivered, what the hypotheses came to, what the judges
 * say, what it cost, and the observer's latest brief when there is one. The deliverables cell opens the run's outputs;
 * the others open the full readout. A number nobody measured says so.
 */
export function AnswerStrip({ doc, onOpen, onOutputs }: { doc: RunDocument; onOpen: () => void; onOutputs: () => void }) {
  const run = doc.run
  const readout = doc.finalOutput?.readout
  const finished = readout && readout.status !== 'pending' ? readout : null
  const outcome = finished?.settle ? `${finished.settle.kind.replaceAll('-', ' ')}${finished.settle.reason ? ` · ${finished.settle.reason.replaceAll('-', ' ')}` : ''}` : `${run.state.replaceAll('-', ' ')}${run.reason ? ` · ${run.reason.replaceAll('-', ' ')}` : ''}`
  const deliverables = finished?.deliverables ?? []
  const present = deliverables.filter((item) => item.present === true).length
  const report = finished?.links.report ?? null
  const verdicts = finished?.verdicts ?? []
  const verdictCounts = new Map<string, number>()
  for (const verdict of verdicts) verdictCounts.set(verdict.verdict, (verdictCounts.get(verdict.verdict) ?? 0) + 1)
  const judges = (finished?.judges ?? []).map((judge) => ({ category: judge.category, score: judge.score, max: judge.max, calibrated: judge.calibrated ?? null, scale: (judge as { scale?: string }).scale }))
  const absolute = absoluteMedian(judges)
  const spend = doc.spend
  const brief = doc.finalOutput?.brief ?? null
  const fallback = doc.finalOutput?.fallback ?? null
  const fallbackLink = externalHref(fallback?.url)
  const files = doc.finalOutput?.files.length ?? 0
  return (
    <div className={`answer-strip ${brief ? 'with-brief' : ''}`} role="group" aria-label="The run's answer" data-answer-strip>
      <button type="button" className="answer-cell" onClick={onOpen}>
        <span className="answer-label">Outcome</span>
        <span className={`answer-value ${stateClass(finished?.settle?.kind ?? run.state)}`}>{outcome}</span>
        <span className="faint">{duration(run.durationMs)}</span>
      </button>
      <button type="button" className="answer-cell" onClick={onOutputs} data-answer-outputs>
        <span className="answer-label">Deliverables</span>
        <span className="answer-value">
          {deliverables.length ? `${present} of ${deliverables.length} present` : doc.finalOutput?.status === 'none-declared' ? 'none declared' : (doc.finalOutput?.status ?? 'unknown').replaceAll('-', ' ')}
        </span>
        <span className="faint">
          {files ? `Open the ${files} ${files === 1 ? 'file' : 'files'}` : 'no file listed'}
          {report ? (
            <>
              {' · '}
              <a className="answer-link" href={report} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                Report ↗
              </a>
            </>
          ) : readout?.status === 'pending' ? ' · readout pending' : ''}
        </span>
        {fallback && (
          <span className="answer-fallback">
            Ended undelivered: read brief {fallback.sequence}
            {fallbackLink && (
              <>
                {' '}
                <a className="answer-link" href={fallbackLink} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>↗</a>
              </>
            )}
          </span>
        )}
      </button>
      <button type="button" className="answer-cell" onClick={onOpen}>
        <span className="answer-label">Hypotheses</span>
        <span className="answer-value">
          {verdicts.length ? [...verdictCounts].map(([verdict, count]) => `${count} ${verdict.replaceAll('-', ' ')}`).join(' · ') : 'none recorded'}
        </span>
      </button>
      <button type="button" className="answer-cell" onClick={onOpen}>
        <span className="answer-label">Score, 0–100 vs world class</span>
        <span className="answer-value">{absolute !== null ? `${absolute} of 100` : 'no absolute score yet'}</span>
        <span className="faint">
          {absolute !== null ? `median of ${absoluteJudges(judges).length} judges` : judges.length ? 'the judges used the retired relative scale' : 'no judges ran'}
        </span>
      </button>
      <button type="button" className="answer-cell" onClick={onOpen}>
        <span className="answer-label">Paid · list price</span>
        <span className="answer-value">
          {money(spend.paidUsd)}
          {!spend.paidKnown && spend.paidUsd !== null ? '+' : ''} · {money(spend.listUsd)}
          {spend.listKnown === false && spend.listUsd !== null ? '+' : ''}
        </span>
        <span className="faint">{spend.listUsd !== null ? 'list price is not billed' : 'usage not recorded'}</span>
      </button>
      {brief && <BriefCell brief={brief} />}
    </div>
  )
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** The observer's latest brief: its headline, when it was written, the gravest risk it names, and the brief itself. */
function BriefCell({ brief }: { brief: ProgressBrief }) {
  const link = externalHref(brief.links.latest ?? brief.links.brief)
  const risk = [...brief.risks].sort((a, b) => (SEVERITY_RANK[a.severity ?? ''] ?? 3) - (SEVERITY_RANK[b.severity ?? ''] ?? 3))[0]
  return (
    <div className="answer-cell answer-brief" data-answer-brief={brief.sequence}>
      <span className="answer-label">
        {brief.final ? 'Final brief' : 'Latest brief'} · {brief.sequence} · {utcTime(brief.generatedAt)}
      </span>
      <span className="answer-value answer-headline" title={brief.headline ?? undefined}>{brief.headline ?? 'no headline'}</span>
      {risk && (
        <span className={`answer-risk ${risk.severity === 'high' ? 'risk-high' : ''}`} title={risk.evidence ?? undefined}>
          {risk.severity ?? 'unrated'} risk: {risk.risk}
        </span>
      )}
      {link && <a className="answer-link" href={link} target="_blank" rel="noopener noreferrer">Read the brief ↗</a>}
    </div>
  )
}

interface Row {
  node: RecordNode
  depth: number
  start: number | null
  end: number | null
}

/**
 * The run's agents as a tree-table on one time axis: each row's bar is when that agent ran, coloured by how it ended.
 * Selecting a row opens the agent's conversation beside the table.
 */
export function AgentTable({
  index,
  stats,
  doc,
  assessments,
  dimensions,
  selected,
  onSelect,
}: {
  index: RecordIndex
  stats: Record<string, NodeStats>
  doc: RunDocument
  assessments: readonly AssessmentRow[]
  dimensions: Map<string, Dimension>
  selected: string | null
  onSelect: (id: string) => void
}) {
  const rows = useMemo(() => {
    const nodes = index.actors.filter((node) => node.kind !== 'finding')
    const ids = new Set(nodes.map((node) => node.id))
    const children = new Map<string | null, RecordNode[]>()
    for (const node of nodes) {
      const parent = node.parent ? index.canonical(node.parent) : null
      const key = parent && ids.has(parent) && parent !== node.id ? parent : null
      children.set(key, [...(children.get(key) ?? []), node])
    }
    const out: Row[] = []
    const seen = new Set<string>()
    const walk = (parent: string | null, depth: number) => {
      for (const node of children.get(parent) ?? []) {
        if (seen.has(node.id)) continue
        seen.add(node.id)
        const stat = stats[node.id]
        const start = node.start ? ms(node.start) : stat?.firstAt ? ms(stat.firstAt) : null
        const end = node.end ? ms(node.end) : stat?.lastAt ? ms(stat.lastAt) : null
        out.push({ node, depth, start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null })
        walk(node.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [index, stats])
  const span = useMemo(() => {
    const starts = rows.map((row) => row.start).filter((value): value is number => value !== null)
    const ends = rows.map((row) => row.end ?? row.start).filter((value): value is number => value !== null)
    const first = Math.min(...starts)
    const last = Math.max(...ends)
    return Number.isFinite(first) && Number.isFinite(last) && last > first ? { first, last } : null
  }, [rows])
  const flags = useMemo(() => {
    const out = new Map<string, Set<string>>()
    for (const row of assessments) {
      if (shownPolarity(row, polarityOf(dimensions, row.dimension, row.label)) !== 'bad' || !row.subject.nodeId) continue
      const node = index.canonical(row.subject.nodeId)
      out.set(node, new Set([...(out.get(node) ?? []), row.dimension]))
    }
    return out
  }, [assessments, dimensions, index])
  const doing = useMemo(() => briefLines(doc.finalOutput?.brief, doc.run.id, rows.map((row) => row.node.id)), [doc, rows])
  const ticks = span ? [0, 0.5, 1].map((at) => ({ at, label: duration((span.last - span.first) * at) })) : []
  return (
    <div className="agent-table" role="table" aria-label="Agents" data-agent-table>
      <div className="agent-row agent-row-head" role="row">
        <span role="columnheader">Agent · {rows.length}</span>
        <span role="columnheader">Outcome</span>
        <span role="columnheader" className="lane-head">
          {ticks.map((tick) => (
            <i key={tick.at} style={{ left: `${tick.at * 100}%` }}>{tick.at === 0 ? 'start' : tick.label}</i>
          ))}
        </span>
        <span role="columnheader" className="num">Time</span>
        <span role="columnheader" className="num">Tokens</span>
        <span role="columnheader" className="num">List price</span>
        <span role="columnheader">Conversation</span>
        <span role="columnheader">Flags</span>
      </div>
      {rows.map(({ node, depth, start, end }) => {
        const stat = stats[node.id]
        const measured = !!stat && (stat.tokens !== null || stat.listUsd !== null)
        const capture = (node.capture as { status?: string } | undefined)?.status
        const state = agentState(node, measured)
        const total = stat?.tokens ? stat.tokens.input + stat.tokens.output + stat.tokens.cacheRead + stat.tokens.cacheWrite : null
        const list = doc.spend.nodes[node.id]?.listUsd ?? stat?.listUsd ?? null
        const left = span && start !== null ? ((start - span.first) / (span.last - span.first)) * 100 : null
        const width = span && start !== null ? Math.max(0.6, (((end ?? start) - start) / (span.last - span.first)) * 100) : null
        const nodeFlags = [...(flags.get(node.id) ?? [])].sort()
        return (
          <button
            key={node.id}
            type="button"
            role="row"
            className={`agent-row ${selected === node.id ? 'on' : ''}`}
            aria-pressed={selected === node.id}
            data-agent-row={node.id}
            onClick={() => onSelect(node.id)}
          >
            <span className="agent-name" role="cell" style={{ paddingLeft: `${depth * 22}px` }} title={`${node.label}\n${roleOf(node)}\n${node.id}`}>
              <span className="clip">{node.label}</span>
            </span>
            <span role="cell">
              <span className={`state-pill ${measured || !node.status ? stateClass(node.status) : 'state-unknown'}`} title={state}>
                {node.status ? node.status.replaceAll('-', ' ') : 'no state'}
                {!measured && node.status ? ' · unmeasured' : ''}
              </span>
            </span>
            <span role="cell" className="lane" title={start !== null ? `${duration((end ?? start) - start)} from ${new Date(start).toISOString().slice(11, 16)} UTC` : 'no recorded time'}>
              {left !== null && width !== null && <i className={`seg ${stateClass(node.status)}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />}
            </span>
            <span role="cell" className="num">{start !== null && end !== null ? duration(end - start) : '—'}</span>
            <span role="cell" className="num">{total !== null ? tokens(total) : 'none'}</span>
            <span role="cell" className="num">{money(list)}</span>
            <span role="cell" className={`capture-text capture-${capture ?? 'unknown'}`}>
              {capture === 'complete' ? 'complete' : capture === 'lossy' ? 'partial' : capture === 'absent' ? 'not captured' : 'unknown'}
              {stat ? <span className="faint"> · {plural(stat.events, 'event')}</span> : null}
            </span>
            <span role="cell" className="agent-flags">
              {nodeFlags.slice(0, 4).map((flag) => <span key={flag} className="label-chip polarity-bad">{flag}</span>)}
              {nodeFlags.length > 4 && <span className="faint">+{nodeFlags.length - 4}</span>}
            </span>
            {doing.has(node.id) && (
              <span role="cell" className="agent-doing" style={{ paddingLeft: `${depth * 22}px` }} title={doing.get(node.id)}>
                {doing.get(node.id)}
              </span>
            )}
          </button>
        )
      })}
      <p className="faint agent-table-note">
        Bars: when each agent ran, coloured by how it ended. Tokens and list price are what the record measured; an agent marked
        unmeasured recorded no usage.{doing.size ? ` The line under an agent is the observer's brief ${doc.finalOutput?.brief?.sequence}, not the agent's own words.` : ''} Paid money is on the run's ledger: {money(doc.spend.paidUsd)}
        {doc.spend.paidKnown ? '' : '+'} for the whole run.
      </p>
    </div>
  )
}
