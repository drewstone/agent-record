import { Gantt, Meter, type ChartMark, type TimelineLane } from '@tangle-network/charts/react'
import { type TabProps, agentParam } from './RunPage.js'
import { elapsed } from './model.js'
import { plainSummary, sinceLabel } from '../plain-words.js'
import { usePhone } from '../use-phone.js'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@tangle-network/sandbox-ui/primitives'

export function clause(text: string | null | undefined, words = Infinity): string {
  if (!text) return ''
  let t = text.replace(/\/(home|mnt|Users|tmp|private)\/\S+/g, '').replace(/:?\s*\b[0-9a-f]{10,40}\b/g, '').replace(/\s+/g, ' ').trim()
  t = t.replace(/^(?:[\w-]+(?: [\w-]+){0,3}: )+(?=\S)/, (prefix) => (prefix.split(': ').length > 2 ? '' : prefix))
  t = t.split(/(?<=[.;])\s|;\s|, the |, starting /)[0] ?? t
  const cut = t.split(' ')
  return cut.length > words ? `${cut.slice(0, words).join(' ').replace(/[.;,:]+$/, '')}…` : t.replace(/[.;,:]$/, '')
}

/** The approved 0.65.0 journey, composed from the shared live timeline and recorded check steps. */
export function Overview({ m, doc, route, agent, selectAgent }: TabProps) {
  const phone = usePhone()
  const best = m.best
  const releases = m.releases.filter(r => r.taggedAt)
  const plateau = best ? releases.find(r => r.passed === best.passed) ?? best : null
  const open = best?.steps?.find(s => s.state !== 'pass')
  const stuck = plateau?.taggedAt ? elapsed(Math.max(0, m.t0 + m.duration - Date.parse(plateau.taggedAt))) : null
  const same = releases.length > 1 && releases.every(r => r.passed === releases[0]!.passed && r.total === releases[0]!.total)
  const blocker = doc.view?.blocker as { owner?: string; action?: string; since?: string; why?: string } | null | undefined
  const picked = route.params.has('agent') && agent ? m.byId.get(agent) : null
  const changed = [...new Set(releases.flatMap(r => picked ? r.files?.[picked.id] ?? [] : []))].sort((a, b) => Number(/\.(log|jsonl?|txt|csv|bin|out)$/.test(a)) - Number(/\.(log|jsonl?|txt|csv|bin|out)$/.test(b)) || a.localeCompare(b))
  const lanes: TimelineLane[] = m.tree.filter(a => a.start !== null).map(a => ({ id: a.id, label: a.name, spans: [{ start: m.t0 + Math.max(0, a.start!), end: m.live && ['running', 'waiting', 'needs-you'].includes(a.status) ? null : m.t0 + Math.max(a.start!, a.end ?? a.last ?? a.start!), state: a.state.tone || 'none' }] }))
  const marks: ChartMark[] = releases.map(r => ({ at: Date.parse(r.taggedAt!), kind: 'release', label: r.release, verdict: r.passed === r.total ? 'pass' : 'unknown' }))
  const clock = (t: number) => new Date(t).toISOString().slice(5, 16).replace('T', ' ')
  const drill = picked ? <section className="rp-card rj-drill" aria-label={`${picked.name}: what it did`}>
      <div className="rp-hd"><h2>{picked.name}</h2><a className="rp-btn end" href={route.href('conversations', { agent: agentParam(doc.run.id, picked.id) })}>Conversation →</a></div>
      <dl><dt>Task</dt><dd>{plainSummary(picked.node.assignment) || 'Not recorded'}</dd><dt>Result</dt><dd>{plainSummary(picked.node.turn) || 'No result recorded yet'}</dd><dt>Changed</dt><dd>{changed.length ? `${changed.length} files in released work` : 'No files in released work'}</dd></dl>
      {!!changed.length && <ul>{changed.map(path => <li key={path}><a href={route.href('files', { agent: agentParam(doc.run.id, picked.id), file: path, ref: best?.release })}>{path}</a></li>)}</ul>}
    </section> : null
  return <section className="rp-journey" aria-label="Run overview">
    <section className="rj-hero" aria-label="How close the best release is">
      {best?.steps?.length ? <Meter total={best.total} used={best.passed} steps={best.steps} text="How close the best release is" /> : <p>No release was checked.</p>}
      {best && <p><b>{best.release}</b> · {open ? `stuck at ${open.label}${stuck ? ` for ${stuck}, since ${plateau?.release}` : ''}` : 'every step passes'}</p>}
      <p className="rj-next">{doc.view?.paused ? <><b>Next:</b> Decide whether to resume research. <a href="/today">Today →</a></> : blocker?.owner === 'Drew' ? <><b>Next:</b> {blocker.action}</> : <><b>Nothing for you.</b> {blocker?.owner ?? 'Discovery operator'} owns the next action{blocker?.since ? ` since ${sinceLabel(blocker.since)}` : ''}{blocker?.action ? `: ${blocker.action}` : '.'}</>}</p>
      <p className="rj-releases">{same ? `${releases[0]!.release}–${releases.at(-1)!.release}: all ${releases[0]!.passed}/${releases[0]!.total}${open && stuck ? `, no step gained in ${stuck}` : ''}` : releases.map(r => <a key={r.release} data-pass={r.passed === r.total || undefined} href={route.href('checks', { release: r.release })}>{r.release} {r.passed ?? '?'}/{r.total ?? '?'}</a>)}</p>
    </section>
    <div className="rj-main" data-picked={picked && !phone || undefined}>
    <section className="rp-card rj-work" aria-label="What the agents did">
      <div className="rp-hd"><h2>What the agents did</h2><span className="muted">{m.agents.length} agents</span></div>
      <Gantt lanes={lanes} marks={marks} bestMark={best?.release} selectedId={picked?.id} onSelect={id => selectAgent(id)} maxHeight={420} now={m.live ? m.t0 + m.duration : undefined} colors={{ ok: 'var(--surface-success-text)', done: 'var(--tone-teal-icon)', live: 'var(--accent-text)', fail: 'var(--surface-danger-text)', waiting: 'var(--surface-warning-text)', 'needs-you': 'var(--surface-warning-text)', none: 'var(--text-dim)' }} axis={clock} span={(a, b) => elapsed(b - a)} />
    </section>
    {phone ? <Sheet open={Boolean(picked)} onOpenChange={open => { if (!open) selectAgent(null) }}><SheetContent side="bottom" className="rj-agent-sheet agent-record rp"><SheetHeader><SheetTitle>{picked?.name}</SheetTitle></SheetHeader>{drill}</SheetContent></Sheet> : drill}
    </div>
  </section>
}
