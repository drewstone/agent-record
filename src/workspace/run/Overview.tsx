import { ENDING_COLORS } from '@tangle-network/charts'
import { agentCost } from './ui.js'
import { useRef } from 'react'
import { Gantt, Meter, type ChartMark, type TimelineLane } from '@tangle-network/charts/react'
import { detectFileFormat } from '@tangle-network/sandbox-ui/files'
import { VirtualList } from '@tangle-network/sandbox-ui/run/record'
import { type TabProps, agentParam } from './RunPage.js'
import { elapsed, type RunRelease } from './model.js'
import { goalText, plainSummary, sinceLabel } from '../plain-words.js'
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

const passed = (r: RunRelease) => r.checked && typeof r.total === 'number' && r.total > 0 && r.passed === r.total
export function Overview({ m, doc, route, agent, selectAgent }: TabProps) {
  const phone = usePhone(), scroller = useRef<HTMLElement>(null)
  const best = m.best
  const releases = m.releases.filter(r => r.taggedAt)
  const plateau = best ? releases.find(r => r.passed === best.passed) ?? best : null
  const open = best?.steps?.find(s => s.state !== 'pass')
  const stuck = plateau?.taggedAt ? elapsed(Math.max(0, m.t0 + m.duration - Date.parse(plateau.taggedAt))) : null
  const groups: typeof releases[] = []
  for (const release of releases) {
    const group = groups.at(-1), previous = group?.at(-1)
    if (previous && previous.passed === release.passed && previous.total === release.total && previous.checker === release.checker) group!.push(release)
    else groups.push([release])
  }
  const blocker = doc.view?.blocker as { owner?: string; action?: string; since?: string; why?: string } | null | undefined
  const picked = route.params.has('agent') && agent ? m.byId.get(agent) : null
  const changed = [...new Set(releases.flatMap(r => picked ? r.files?.[picked.id] ?? [] : []))].sort((a, b) => Number(detectFileFormat(b) === 'code') - Number(detectFileFormat(a) === 'code') || a.localeCompare(b))
  const lanes: TimelineLane[] = m.tree.filter(a => a.start !== null).map(a => ({ id: a.id, label: a.name, count: a.commits ?? (a.modelCalls !== null && a.toolCalls !== null ? a.modelCalls + a.toolCalls : undefined), countLabel: a.commits !== null ? 'commits' : 'calls', spans: [{ start: m.t0 + Math.max(0, a.start!), end: m.live && ['running', 'waiting', 'needs-you'].includes(a.status) ? null : m.t0 + Math.max(a.start!, a.end ?? a.last ?? a.start!), state: a.id === m.root?.id ? 'lead' : a.state.tone || 'none', note: a.state.label, endLabel: `${elapsed(Math.max(0, (m.live && ['running', 'waiting', 'needs-you'].includes(a.status) ? m.duration : a.end ?? a.last ?? a.start!) - a.start!))} · ${agentCost(a)}` }] }))
  const marks: ChartMark[] = releases.map(r => ({ at: Date.parse(r.taggedAt!), kind: 'release', label: r.release, verdict: passed(r) ? 'pass' : 'unknown' }))
  const clock = (t: number) => new Date(t).toISOString().slice(5, 16).replace('T', ' ')
  const drill = picked ? <section key={picked.id} ref={scroller} tabIndex={0} role="list" className="rp-card rj-drill rj-files" aria-label={`${picked.name}: what it did`}>
      <VirtualList items={[null, ...changed]} keyOf={path => path === null ? 'summary' : `file:${path}`} scroller={scroller} estimate={28} overscan={280}
        render={path => <div role="listitem">{path === null ? <>
          <div className="rp-hd"><h2>{picked.name}</h2><a className="rp-btn end" href={route.href('conversations', { agent: agentParam(doc.run.id, picked.id) })}>Conversation →</a></div>
          <dl><dt>Task</dt><dd>{plainSummary(picked.node.assignment) || (picked.id === doc.run.id && plainSummary(goalText(doc.input?.objective))) || 'Not recorded'}</dd><dt>Result</dt><dd>{plainSummary(picked.node.turn) || 'No result recorded yet'}</dd><dt>Changed</dt><dd>{changed.length ? `${changed.length} files in released work` : 'No files in released work'}</dd></dl>
        </> : <code>{path}</code>}</div>} />
    </section> : null
  return <section className="rp-journey" aria-label="Run overview">
    <section className="rj-hero" aria-label="How close the best release is">
      {best?.steps?.length ? <Meter total={best.total} used={best.passed} steps={best.steps} text="How close the best release is" /> : <p>No release was checked.</p>}
      {best && <p><b>{best.release}</b> · {open ? `stuck at ${open.label}${stuck ? ` for ${stuck}, since ${plateau?.release}` : ''}` : 'every step passes'}</p>}
      <p className="rj-next">{doc.view?.paused ? <><b>Next:</b> Decide whether to resume research. <a href="/today">Today →</a></> : blocker?.owner === 'Drew' ? <><b>Next:</b> {blocker.action}</> : <><b>Nothing for you.</b> {blocker?.owner ?? 'Discovery operator'} is on it{blocker?.since ? ` since ${sinceLabel(blocker.since)}` : ''}{blocker?.action ? `: ${blocker.action}` : '.'}</>}</p>
      <p className="rj-releases">{groups.map(group => { const first = group[0]!, last = group.at(-1)!; return <a key={first.release} data-pass={passed(last) || undefined} href={route.href('checks', { release: last.release })}>{first.release}{group.length > 1 ? `–${last.release}: all` : ''} {last.passed ?? '?'}/{last.total ?? '?'}</a> })}</p>
    </section>
    <div className="rj-main" data-picked={picked && !phone || undefined}>
    <section className="rp-card rj-work" aria-label="What the agents did">
      <div className="rp-hd"><h2>What the agents did</h2><span className="muted">{m.agents.length} agents</span></div>
      <Gantt lanes={lanes} marks={marks} bestMark={best?.release} selectedId={picked?.id} onSelect={id => selectAgent(id)} maxHeight={420} now={m.live ? m.t0 + m.duration : undefined} colors={{ ok: ENDING_COLORS.solved, done: ENDING_COLORS.cancelled, live: ENDING_COLORS.live, lead: ENDING_COLORS.cancelled, fail: ENDING_COLORS.died, waiting: ENDING_COLORS.stalled, 'needs-you': ENDING_COLORS.stalled, none: ENDING_COLORS.cancelled }} axis={clock} span={(a, b) => elapsed(b - a)} />
    </section>
    {phone ? <Sheet open={Boolean(picked)} onOpenChange={open => { if (!open) selectAgent(null) }}><SheetContent side="bottom" className="rj-agent-sheet agent-record rp"><SheetHeader><SheetTitle>{picked?.name}</SheetTitle>{picked && <a className="rp-btn" href={route.href('conversations', { agent: agentParam(doc.run.id, picked.id) })}>Conversation →</a>}</SheetHeader>{drill}</SheetContent></Sheet> : drill}
    </div>
  </section>
}
