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
import { headlineScore, scoreRows } from './scores.js'

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

/** One fact of the answer strip: a label and its value on one line; it opens the section that holds the detail. */
interface Fact {
  key: string
  label: string
  value: string
  note?: string
  tone?: string
  title?: string
  open: () => void
}

/**
 * The run's answer in one line of facts, then the observer's latest brief. Only what is known is shown: a running run
 * leads with its agents working, spend so far, files written and findings so far, and a fact with nothing to say
 * (no deliverable declared, no hypothesis judged, no judge run) is left out rather than shown as unknown. Live figures
 * come from the run's progress document (the brief's own numbers), else from the latest brief.
 */
export function AnswerStrip({ doc, onOpen, onOutputs, onFindings, onProgress }: { doc: RunDocument; onOpen: () => void; onOutputs: () => void; onFindings: () => void; onProgress: () => void }) {
  const run = doc.run
  const readout = doc.finalOutput?.readout
  const finished = readout && readout.status !== 'pending' ? readout : null
  const outcome = finished?.settle ? `${finished.settle.kind.replaceAll('-', ' ')}${finished.settle.reason && finished.settle.reason !== finished.settle.kind ? ` · ${finished.settle.reason.replaceAll('-', ' ')}` : ''}` : `${run.state.replaceAll('-', ' ')}${run.reason && run.reason !== run.state ? ` · ${run.reason.replaceAll('-', ' ')}` : ''}`
  const deliverables = finished?.deliverables ?? []
  const present = deliverables.filter((item) => item.present === true).length
  const verdicts = finished?.verdicts ?? []
  const verdictCounts = new Map<string, number>()
  for (const verdict of verdicts) verdictCounts.set(verdict.verdict, (verdictCounts.get(verdict.verdict) ?? 0) + 1)
  const final = doc.finalOutput
  const headline = headlineScore(scoreRows(finished, final?.panel, final?.grades?.latest, { kind: 'run', id: run.id }))
  const yours = final?.grades?.latest.filter((grade) => grade.target.kind === 'run' && grade.category === 'overall').at(-1) ?? null
  const spend = doc.spend
  const brief = final?.brief ?? null
  const fallback = final?.fallback ?? null
  const fallbackLink = externalHref(fallback?.url)
  const report = externalHref(finished?.links.report ?? null)
  const progress = doc.progress ?? null
  const sample = progress?.samples.at(-1) ?? null
  const running = run.state === 'running'
  const items = doc.findings?.items ?? []
  const results = items.filter((item) => item.kind === 'result').length
  const claims = items.filter((item) => item.kind === 'claim').length

  const facts: Fact[] = [{ key: 'outcome', label: running ? 'State' : 'Outcome', value: outcome, note: duration(run.durationMs), tone: stateClass(finished?.settle?.kind ?? run.state), open: onOpen }]
  // Agents: those working now and all the run started, from the progress document, else the brief's team.
  const team = progress?.agents.length ?? brief?.team.length ?? run.nodes ?? null
  const working = sample?.working ?? (brief ? brief.team.filter((member) => member.state === 'running').length : null)
  if (team !== null)
    facts.push({ key: 'agents', label: 'Agents', value: running && working !== null ? `${working} working` : String(team), note: running && working !== null ? `of ${team}` : undefined, open: onProgress })
  // Spend so far: the brief's API-equivalent figure (every token at list price, whoever paid), then what was billed.
  const spent = progress?.spend.runUsd ?? brief?.spend?.runUsd ?? null
  if (spent !== null)
    facts.push({ key: 'spent', label: running ? 'Spend so far' : 'Spend', value: money(spent), note: 'API-equivalent', title: progress?.spend.provenance ?? brief?.spend?.provenance ?? undefined, open: onProgress })
  const billed = [spend.apiUsd !== null ? `API ${money(spend.apiUsd)}` : null, spend.sandboxUsd !== null ? `sandbox ${money(spend.sandboxUsd)}` : null].filter(Boolean)
  if (billed.length) facts.push({ key: 'billed', label: 'Billed', value: billed.join(' · '), open: onOpen })
  if (spend.subscriptionUsd !== null)
    facts.push({ key: 'subscription', label: 'Subscription use', value: money(spend.subscriptionUsd), note: `at API prices, not billed${spend.subscriptionKnown ? '' : ', partial'}`, open: onOpen })
  const files = progress?.files ?? sample?.files ?? null
  if (files !== null) facts.push({ key: 'files', label: running ? 'Files written' : 'Files', value: String(files), open: onOutputs })
  if (doc.findings)
    facts.push({ key: 'findings', label: running ? 'Findings so far' : 'Findings', value: results || claims ? [results ? plural(results, 'result') : null, claims ? plural(claims, 'claim') : null].filter(Boolean).join(' · ') : 'none yet', open: onFindings })
  if (deliverables.length || (final?.status && final.status !== 'none-declared' && final.status !== 'unknown'))
    facts.push({ key: 'deliverables', label: 'Deliverables', value: deliverables.length ? `${present} of ${deliverables.length} present` : (final?.status ?? '').replaceAll('-', ' '), open: onOutputs })
  if (verdicts.length) facts.push({ key: 'hypotheses', label: 'Hypotheses', value: [...verdictCounts].map(([verdict, count]) => `${count} ${verdict.replaceAll('-', ' ')}`).join(' · '), open: onOpen })
  if (headline)
    facts.push({ key: 'score', label: 'Score', value: `${headline.score} of 100`, note: `${headline.source === 'judges' ? 'AI judges' : `${headline.n} AI personas, advisory`}${yours ? ` · ${yours.by.split('@')[0]}: ${yours.score}` : ''}`, open: onOpen })

  return (
    <div className="answer-strip" role="group" aria-label="The run's answer" data-answer-strip>
      <div className="answer-facts">
        {facts.map((fact) => (
          <button key={fact.key} type="button" className="answer-fact" onClick={fact.open} title={fact.title} data-fact={fact.key}>
            <span className="answer-label">{fact.label}</span>
            <span className={`answer-value ${fact.tone ?? ''}`}>{fact.value}</span>
            {fact.note && <span className="faint">{fact.note}</span>}
          </button>
        ))}
        {report && (
          <a className="answer-fact answer-link" href={report} target="_blank" rel="noopener noreferrer">Report ↗</a>
        )}
        {readout?.status === 'pending' && !running && <span className="answer-fact faint">readout pending</span>}
      </div>
      {fallback && (
        <p className="answer-fallback">
          Ended undelivered: brief {fallback.sequence} is its readable result
          {fallbackLink && (
            <>
              {' '}
              <a className="answer-link" href={fallbackLink} target="_blank" rel="noopener noreferrer">↗</a>
            </>
          )}
        </p>
      )}
      {brief && <BriefLine brief={brief} />}
    </div>
  )
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** The observer's latest brief on one line: which and when, its headline, the gravest risk it names, and a link. */
function BriefLine({ brief }: { brief: ProgressBrief }) {
  const link = externalHref(brief.links.latest ?? brief.links.brief)
  const risk = [...brief.risks].sort((a, b) => (SEVERITY_RANK[a.severity ?? ''] ?? 3) - (SEVERITY_RANK[b.severity ?? ''] ?? 3))[0]
  return (
    <div className="answer-brief" data-answer-brief={brief.sequence}>
      <span className="answer-label">
        {brief.final ? 'Final brief' : 'Latest brief'} {brief.sequence} · {utcTime(brief.generatedAt)}
      </span>
      <span className="answer-headline" title={brief.headline ?? undefined}>{brief.headline ?? 'no headline'}</span>
      {risk && (
        <span className={`answer-risk ${risk.severity === 'high' ? 'risk-high' : ''}`} title={risk.evidence ?? undefined}>
          {risk.severity ?? 'unrated'} risk: {risk.risk}
        </span>
      )}
      {link && <a className="answer-link" href={link} target="_blank" rel="noopener noreferrer">Read ↗</a>}
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
        <span role="columnheader" className="num" title="Model usage at API prices; this column is not a bill">Usage at API prices</span>
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
        Bars: when each agent ran, coloured by how it ended. Tokens and usage at API prices are what the record measured; an agent marked
        unmeasured recorded no usage.{doing.size ? ` The line under an agent is the observer's brief ${doc.finalOutput?.brief?.sequence}, not the agent's own words.` : ''}
        {' '}Billed model API {money(doc.spend.apiUsd)} · billed sandbox compute {money(doc.spend.sandboxUsd)} for the whole run.
      </p>
    </div>
  )
}
