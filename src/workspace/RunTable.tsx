import { useMemo } from 'react'
import type { AssessmentRow, Dimension } from '../assessment.js'
import type { RecordNode } from '../record.js'
import type { RecordIndex } from '../viewer/model.js'
import { agentState, ms, roleOf } from '../viewer/model.js'
import type { RunDocument } from '../workspace.js'
import { polarityOf, shownPolarity } from './Assessments.js'
import { duration, money, stateClass, tokens } from './data.js'
import { briefLines } from './outputs.js'

/** Per agent, from the record's `nodes` part: event count, first and last event, recorded usage and list price, tool
 * calls, its latest words and the profile it was spawned with (the last four absent from hosts before them). */
export interface NodeStats {
  events: number
  firstAt: string | null
  lastAt: string | null
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } | null
  listUsd: number | null
  calls?: number
  lastText?: string | null
  lastTextAt?: string | null
  profileDigest?: string | null
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

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
  const live = useMemo(() => new Map((doc.progress?.agents ?? []).map((agent) => [agent.node, agent.status])), [doc])
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
        <span role="columnheader" className="num" title="Model usage at API prices when priced, else tokens; this column is not a bill">Usage</span>
        <span role="columnheader">Conversation</span>
        <span role="columnheader">Flags</span>
      </div>
      {rows.map(({ node, depth, start, end }) => {
        const stat = stats[node.id]
        const meter = (doc.spend.nodes[node.id] as { meter?: { tokens: Record<string, number> } | null } | undefined)?.meter ?? null
        const measured = !!stat && (stat.tokens !== null || stat.listUsd !== null)
        const capture = (node.capture as { status?: string } | undefined)?.status
        // A live agent has no terminal state yet: it is working, as Runtime's progress document says.
        const status = node.status ?? (doc.live.polling ? (live.get(node.id) ?? 'running') : null)
        const state = node.status ? agentState(node, measured || !!meter) : status ? `${status} · ${stat?.calls ?? 0} tool calls so far` : 'the run settled without this agent recording an end'
        const metered = meter ? Object.values(meter.tokens).reduce((sum, value) => sum + value, 0) : 0
        // Turns metered without counts measured nothing: no tokens, not zero.
        const total = stat?.tokens ? stat.tokens.input + stat.tokens.output + stat.tokens.cacheRead + stat.tokens.cacheWrite : metered > 0 ? metered : null
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
              <span className={`state-pill ${stateClass(status === 'running' ? 'running' : status)}`} title={state}>
                {status ? (status === 'running' ? 'working' : status.replaceAll('-', ' ')) : 'ended'}
              </span>
            </span>
            <span role="cell" className="lane" title={start !== null ? `${duration((end ?? start) - start)} from ${new Date(start).toISOString().slice(11, 16)} UTC` : 'no recorded time'}>
              {left !== null && width !== null && <i className={`seg ${stateClass(node.status)}`} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />}
            </span>
            <span role="cell" className="num">{start !== null && end !== null ? duration(end - start) : '—'}</span>
            <span role="cell" className="num">{total !== null ? tokens(total) : '—'}</span>
            <span role="cell" className="num" title={list === null ? (total !== null ? 'Tokens are counted; this model has no API list price yet' : 'No usage metered yet') : 'API-equivalent: every token at list price, whoever paid'}>
              {list !== null && list > 0 ? money(list) : total !== null ? `${tokens(total)} tok` : '—'}
            </span>
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
        Bars: when each agent ran, coloured by how it ended. Tokens are what the record or Runtime's meter measured; usage shows API-equivalent
        dollars where the model has a list price.{doing.size ? ` The line under an agent is the observer's brief ${doc.finalOutput?.brief?.sequence}, not the agent's own words.` : ''}
        {' '}Billed model API {money(doc.spend.apiUsd)} · billed sandbox compute {money(doc.spend.sandboxUsd)} for the whole run.
      </p>
    </div>
  )
}
