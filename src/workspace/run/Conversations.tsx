import { useEffect, useMemo, useRef, useState } from 'react'
import { HarnessLogo, ProviderMark, type HarnessType } from '@tangle-network/sandbox-ui/dashboard'
import { LiveTranscript } from '../LiveTranscript.js'
import { AgentConversation, useRecordPart } from '../record-part.js'
import type { TabProps } from './RunPage.js'
import { type Agent, clockOf, abbr, type RunModel, elapsed, plural, spanOf } from './model.js'
import { StateDot, Hilite, Icon, useRows } from './ui.js'

type Row = { kind: 'team'; id: string; label: string; n: number } | { kind: 'agent'; a: Agent }

function rowsOf(m: RunModel, query: string): Row[] {
  const q = query.trim().toLowerCase()
  const list = m.tree.filter((a) => !q || `${a.name} ${a.node.label}`.toLowerCase().includes(q))
  if (!m.teams.length) return list.map((a) => ({ kind: 'agent', a }))
  const out: Row[] = list.filter((a) => !a.team || a.team === a.id).map((a) => ({ kind: 'agent', a }))
  for (const t of m.teams) {
    const members = list.filter((a) => a.team === t.id && a.id !== t.id)
    if (!members.length) continue
    out.push({ kind: 'team', id: t.id, label: t.label, n: members.length })
    for (const a of members) out.push({ kind: 'agent', a })
  }
  return out
}

/** What each agent said and did: a searchable, grouped agent list beside the selected agent's transcript. */
export function Conversations({ m, doc, runUrl, agent, selectAgent, route }: TabProps) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => rowsOf(m, query), [m, query])
  const list = useRef<HTMLDivElement>(null)
  const ROW = 52
  const win = useRows(list, rows.length, ROW)
  const selected = (agent ? m.byId.get(agent) : null) ?? m.root
  const digest = doc.run.record.digest ?? null
  const ready = doc.run.record.status === 'ready' || Boolean(digest)
  const version = digest ? `&digest=${digest}` : ''
  const nodes = useRecordPart(ready ? `${runUrl}/record?part=nodes${version}` : null)
  const index = nodes.index
  const live = Boolean(doc.execution?.alive)
  // One count everywhere: the run's agents, as the header, the tab and the search name them.
  const talkers = m.agents.length
  const picked = Boolean(route.params.get('agent'))
  const recorded = selected && index && index.nodes.has(index.canonical(selected.id))
  const [emptyStream, setEmptyStream] = useState<ReadonlySet<string>>(new Set())
  // The root was started with the run's input; its record starts at its first step, so the chat opens with that prompt.
  const opening = useMemo(() => {
    const text = [doc.input?.objective, doc.input?.instruction].filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join('\n\n')
    return selected && selected.id === m.root?.id && text ? { text, at: doc.run.startedAt ?? new Date(m.t0).toISOString() } : undefined
  }, [doc, selected, m])
  useEffect(() => setEmptyStream(new Set()), [doc.run.id])
  return (
    <div className="rp-conv" data-picked={picked ? '' : undefined}>
      <aside className="rp-card" aria-label="Agents">
        <div className="rp-hd"><h2>Agents<span className="ct">{talkers}</span></h2></div>
        <div className="rp-fbar"><label className="rp-field"><Icon name="search" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${talkers} agents`} aria-label="Search agents" /></label></div>
        <div className="rp-alist" ref={list} role="list">
          <div style={{ height: win.before }} />
          {rows.slice(win.first, win.last).map((r) => r.kind === 'team' ? (
            <div key={`t:${r.id}`} className="ag" style={{ height: ROW }}><Icon name="users" size={14} />{r.label}<span className="ct">{r.n}</span></div>
          ) : (
            <button key={r.a.id} type="button" role="listitem" aria-current={r.a.id === selected?.id} style={{ height: ROW }} onClick={() => selectAgent(r.a.id)}>
              <span className="rp-agent-logos"><HarnessLogo type={(r.a.harness === 'claude' ? 'claude-code' : r.a.harness ?? 'cli-base') as HarnessType} size={18} /><ProviderMark provider={r.a.model ?? undefined} size="xs" /></span>
              <span className="nm" title={r.a.name}><StateDot tone={r.a.state.tone} /><Hilite text={r.a.name} query={query} /></span>
              <span className="sb">{r.a.steps.length || r.a.turns ? `${plural(r.a.steps.length, 'step')}${r.a.first !== null ? ` · ${spanOf(m.t0, r.a.first, r.a.state.tone === 'live' ? 'now' : r.a.last ?? r.a.first)}` : ''}` : r.a.state.label}</span>
              <span className="n">{r.a.tokens === null ? '' : abbr(r.a.tokens)}</span>
            </button>
          ))}
          <div style={{ height: win.after }} />
          {!rows.length && <p className="rp-empty">No agent matches “{query}”.</p>}
        </div>
      </aside>
      {selected && (
        <article className="rp-card" aria-label={`${selected.name}: conversation`}>
          <div className="rp-hd">
            <button type="button" className="rp-back" onClick={() => selectAgent(null)} aria-label="All agents"><Icon name="arrow" size={16} /></button>
            <h2><StateDot tone={selected.state.tone} />{selected.name}</h2>
            <span className="muted ph-hide">{[selected.model, selected.harness].filter(Boolean).join(' · ')}</span>
            {selected.toolFailures > 0 && <span className="rp-pill danger">{selected.toolFailures} tool errors</span>}
          </div>
          <div className="rp-scroll rp-tx">
            {!live && recorded ? (
              <AgentConversation key={selected.id} runUrl={runUrl} version={version} index={index!} actor={index!.canonical(selected.id)} opening={opening} />
            ) : !live && (nodes.loading || nodes.pending) ? (
              <p className="ws-status" role="status">Loading the conversation…</p>
            ) : emptyStream.has(selected.id) ? (
              <StepLog m={m} a={selected} />
            ) : (
              <LiveTranscript key={selected.id} runUrl={runUrl} runId={doc.run.id} alive={live} selected={selected.id} onSelect={(id) => selectAgent(id)} chooser={false} opening={opening}
                onEmpty={() => setEmptyStream((s) => new Set([...s, selected.id]))} />
            )}
          </div>
        </article>
      )}
    </div>
  )
}

/** An agent without a recorded conversation: its steps, consecutive calls of one tool grouped, failures inline. */
function StepLog({ m, a }: { m: RunModel; a: Agent }) {
  const clock = clockOf(m.t0)
  const groups: { name: string; model: boolean; n: number; at: number; end: number; failed: number; targets: Set<string> }[] = []
  for (const s of a.steps) {
    if (s.kind === 'waiting') continue
    const name = s.kind === 'model' ? 'model call' : s.tool ?? 'tool'
    const last = groups[groups.length - 1]
    if (last && last.name === name && s.t - last.end < 60_000) { last.n++; last.end = s.t + s.d; last.failed += s.failed ? 1 : 0; if (s.target) last.targets.add(s.target) }
    else groups.push({ name, model: s.kind === 'model', n: 1, at: s.t, end: s.t + s.d, failed: s.failed ? 1 : 0, targets: new Set(s.target ? [s.target] : []) })
  }
  if (!groups.length) return <p className="ws-status">No conversation or step was recorded for {a.name}.</p>
  return (
    <div className="rp-steplog">
      <p className="rp-note">No conversation was recorded for this agent; these are its {plural(a.steps.length, 'recorded step')}.</p>
      {groups.map((g, i) => (
        <div key={i} className="rp-msg">
          <time>{clock(g.at)}</time>
          <div>
            <span className={`rp-tchip${g.failed ? ' fail' : ''}`}><i className={g.model ? 'model' : ''} /><span className="t">{g.name}{g.n > 1 ? ` ×${g.n}` : ''}</span>{g.targets.size > 0 && <span className="a">{[...g.targets].slice(0, 2).join(', ')}{g.targets.size > 2 ? ` +${g.targets.size - 2}` : ''}</span>}<span className="dim">{elapsed(g.end - g.at)}</span></span>
            {g.failed > 0 && <span className="rp-errline">✕ {g.failed} failed</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
