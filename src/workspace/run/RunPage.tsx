import { type KeyboardEvent, type ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@tangle-network/sandbox-ui/primitives'
import type { RunDocument } from '../../workspace-model.js'
import type { Play } from '../answers.js'
import { StatusPill, useDocument } from '../data.js'
import { shortRun } from '../play-standing.js'
import { viewChip } from '../view.js'
import { reloadOnce } from '../lazy-pages.js'
import { buildModel, count, type RunModel, elapsed, type WorkspaceDoc } from './model.js'
import { CardLayer, Icon, Picker } from './ui.js'

/**
 * The run page (Drew 2026-10-26): one header (the run, its status and the few numbers that matter), then a tab bar where
 * each tab is a route, `/run/<id>/<tab>`, and one workspace that fills the screen below it. The selected agent and file
 * live in the query (`?agent=`, `?file=`), so a reload or a shared link restores the tab, the agent and the file.
 */
export const RUN_PAGE_TABS = ['overview', 'timeline', 'files', 'topology', 'conversations', 'traces', 'analytics', 'checks'] as const
export type RunTabId = (typeof RUN_PAGE_TABS)[number]
const LABEL: Record<RunTabId, string> = { overview: 'Overview', timeline: 'Waterfall', files: 'Files', topology: 'Topology', conversations: 'Conversations', traces: 'Traces', analytics: 'Analytics', checks: 'Checks' }

const Overview = lazy(() => import('./Overview.js').catch(reloadOnce).then((m) => ({ default: m.Overview })))
const Timeline = lazy(() => import('./Timeline.js').catch(reloadOnce).then((m) => ({ default: m.TimelineTab })))
const Files = lazy(() => import('./Files.js').catch(reloadOnce).then((m) => ({ default: m.Files })))
const Topology = lazy(() => import('./Topology.js').catch(reloadOnce).then((m) => ({ default: m.Topology })))
const Conversations = lazy(() => import('./Conversations.js').catch(reloadOnce).then((m) => ({ default: m.Conversations })))
const Traces = lazy(() => import('./Traces.js').catch(reloadOnce).then((m) => ({ default: m.Traces })))
const Analytics = lazy(() => import('./Analytics.js').catch(reloadOnce).then((m) => ({ default: m.Analytics })))
const Checks = lazy(() => import('./Checks.js').catch(reloadOnce).then((m) => ({ default: m.Checks })))

/** Older `?section=` links land on the tab that now holds what they named. */
const SECTION_TAB: Record<string, RunTabId> = { agents: 'conversations', spend: 'analytics', progress: 'overview' }
/** Sections with no tab of their own: one menu at the end of the tab bar opens them under the header. */
const MORE: [string, string][] = [['findings', 'Findings'], ['outputs', 'Outputs and grades'], ['readout', 'Readout'], ['versions', 'Versions'], ['graph', 'Knowledge graph'], ['profiles', 'Profiles'], ['assessments', 'Assessments'], ['coverage', 'Capture'], ['input', 'Input']]

/** The route: the tab is the path's third part, everything else the query. */
export function useRunRoute(id: string) {
  const read = () => {
    const parts = window.location.pathname.split('/').filter(Boolean)
    const asked = parts[0] === 'run' ? decodeURIComponent(parts[2] ?? '') : ''
    return { tab: (RUN_PAGE_TABS as readonly string[]).includes(asked) ? (asked as RunTabId) : null, search: window.location.search }
  }
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const changed = () => setRoute(read())
    window.addEventListener('popstate', changed)
    return () => window.removeEventListener('popstate', changed)
  }, [])
  const params = useMemo(() => new URLSearchParams(route.search), [route.search])
  const href = useCallback((tab: RunTabId, patch: Record<string, string | null | undefined> = {}, keep = true) => {
    const next = keep ? new URLSearchParams(window.location.search) : new URLSearchParams()
    for (const key of ['section', 'node', 'view', 'details', 'tab']) next.delete(key)
    const theme = new URLSearchParams(window.location.search).get('theme')
    if (theme) next.set('theme', theme)
    for (const [key, value] of Object.entries(patch)) value === null || value === undefined || value === '' ? next.delete(key) : next.set(key, value)
    const query = next.toString()
    return `/run/${encodeURIComponent(id)}/${tab}${query ? `?${query}` : ''}`
  }, [id])
  const go = useCallback((tab: RunTabId, patch: Record<string, string | null | undefined> = {}, replace = false) => {
    const url = href(tab, patch)
    if (url === window.location.pathname + window.location.search) return
    if (replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [href])
  return { tab: route.tab, params, href, go }
}
export type RunRoute = ReturnType<typeof useRunRoute> & { tab: RunTabId }

/** `?agent=` names an agent as the Lab's fold does: `root`, `s3`, `s3:s0`; the page maps it to the node id. */
export const agentParam = (runId: string, nodeId: string) => (nodeId === runId ? 'root' : nodeId.startsWith(`${runId}:`) ? nodeId.slice(runId.length + 1) : nodeId)
export const agentFromParam = (m: RunModel, runId: string, value: string | null) => {
  if (!value) return null
  const id = value === 'root' ? (m.root?.id ?? runId) : m.byId.has(value) ? value : `${runId}:${value}`
  return m.byId.has(id) ? id : null
}

export interface TabProps {
  api: string
  runUrl: string
  doc: RunDocument
  play: Play | null
  m: RunModel
  route: RunRoute
  /** The selected agent's node id (the root when none is named). */
  agent: string | null
  selectAgent: (id: string | null, tab?: RunTabId) => void
}

export function RunPage({ api, id, legacy }: { api: string; id: string; legacy?: (section: string) => ReactNode }) {
  const route = useRunRoute(id)
  const runUrl = `${api}/runs/${encodeURIComponent(id)}`
  const run = useDocument<RunDocument>(runUrl, undefined, true)
  const initial = useDocument<WorkspaceDoc>(`${runUrl}/workspace`, undefined, true)
  const [frame, setFrame] = useState<{ url: string; workspace: WorkspaceDoc; run: RunDocument } | null>(null)
  const [now, setNow] = useState(Date.now)
  const current = frame?.url === runUrl ? frame : null
  const doc = current?.run ?? run.data
  const ws = { ...initial, data: current?.workspace ?? initial.data }
  const live = Boolean(doc?.execution?.alive || ws.data?.live)
  useEffect(() => {
    if (!live) return
    const source = new EventSource(`${runUrl}/agents/${encodeURIComponent(id)}/stream?workspace=1`)
    source.addEventListener('workspace', event => {
      try {
        const next = JSON.parse((event as MessageEvent<string>).data)
        if (next.workspace?.runId === id && next.run?.run?.id === id) setFrame({ ...next, url: runUrl })
      } catch { /* EventSource reconnects; retain the last complete document. */ }
    })
    source.addEventListener('end', () => source.close())
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { source.close(); window.clearInterval(clock) }
  }, [live, runUrl, id])
  const play = useDocument<Play>(doc ? `${api}/plays/${encodeURIComponent(doc.run.play)}` : null)
  const m = useMemo(() => (ws.data && doc ? buildModel(ws.data, doc.run) : null), [ws.data, doc, now])
  const section = route.params.get('section')
  const mapped = section ? SECTION_TAB[section] : undefined
  // A link from before the tabs lands on the tab that holds its section, with its agent or file.
  useEffect(() => {
    if (!mapped) return
    const node = route.params.get('node')
    route.go(mapped, { agent: node ? agentParam(id, node) : undefined, file: route.params.get('file') ?? undefined }, true)
  }, [mapped]) // eslint-disable-line react-hooks/exhaustive-deps
  const tab: RunTabId = route.tab ?? 'overview'
  const agent = m ? (agentFromParam(m, id, route.params.get('agent')) ?? m.root?.id ?? null) : null
  const selectAgent = useCallback((node: string | null, next?: RunTabId) => route.go(next ?? tab, { agent: node ? agentParam(id, node) : null }), [route, tab, id])
  const tabsRef = useRef<HTMLElement>(null)
  // On a phone the tab strip scrolls: the open tab scrolls into view, and while more tabs sit past the edge a chevron says so
  // and steps to them (judges 10-27: "Conversat" was cut at 390 px with no cue).
  const [more, setMore] = useState(false)
  useEffect(() => {
    const nav = tabsRef.current
    if (!nav) return
    const check = () => setMore(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4)
    nav.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    check()
    nav.addEventListener('scroll', check, { passive: true })
    const r = new ResizeObserver(check)
    r.observe(nav)
    return () => { nav.removeEventListener('scroll', check); r.disconnect() }
  }, [tab, run.data])
  if (run.error && !run.data) return <p className="ws-status" role="alert">This run is unavailable: {run.error}</p>
  if (!doc) return <p className="ws-status" role="status">Loading…</p>
  const counts: Partial<Record<RunTabId, string>> = m ? {
    conversations: count(m.agents.length),
    traces: count(m.totals.steps),
    checks: count((doc.run as unknown as { check?: { counts?: { checks?: number } } }).check?.counts?.checks ?? m.releases.length),
  } : {}
  const keys = (event: KeyboardEvent) => {
    const at = RUN_PAGE_TABS.indexOf(tab)
    const to = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: RUN_PAGE_TABS.length - 1 } as Record<string, number>)[event.key]
    if (to === undefined) return
    event.preventDefault()
    const next = RUN_PAGE_TABS[(to + RUN_PAGE_TABS.length) % RUN_PAGE_TABS.length]!
    route.go(next)
    requestAnimationFrame(() => tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus())
  }
  const legacyBody = section && !mapped && legacy ? legacy(section) : null
  const props: TabProps | null = m ? { api, runUrl, doc, play: play.data ?? null, m, route: { ...route, tab }, agent, selectAgent } : null
  return (
    <CardLayer>
      <div className="rp rp-run" data-run={id} data-tab={legacyBody ? undefined : tab}>
        <PageHeader
          className="rp-head"
          title={<><a href={`/play/${encodeURIComponent(doc.run.play)}`}>{doc.run.play}</a><span className="sep" aria-hidden="true">/</span><span>Run {shortRun(doc.run.play, doc.run.id)}</span></>}
          description={doc.view ? <StatusPill status={viewChip(doc.view.status)} title={doc.view.status.reason ?? undefined} /> : undefined}
          actions={m ? <time className="rp-elapsed" aria-label="Elapsed">{elapsed(m.duration)}</time> : undefined}
        />
        <div className="rp-tabs-wrap" data-more={more || undefined}>
        <nav ref={tabsRef} className="rp-tabs" role="tablist" aria-label="Run" onKeyDown={keys}>
          {RUN_PAGE_TABS.map((t) => (
            <a key={t} role="tab" data-tab={t} href={route.href(t)} aria-selected={!legacyBody && t === tab} tabIndex={t === tab ? 0 : -1} aria-controls="rp-panel"
              onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); route.go(t) }}>
              {LABEL[t]}{counts[t] ? <span className="ct">{counts[t]}</span> : null}
            </a>
          ))}
          <span className="rp-more">
            <Picker label="More run sections" options={MORE.map(([value, label]) => ({ id: value, label }))} value={legacyBody ? section : null} width={260} placeholder="Find a section"
              onChange={(value) => { if (!value) return; window.history.pushState(null, '', `/run/${encodeURIComponent(id)}?section=${value}`); window.dispatchEvent(new PopStateEvent('popstate')) }}>
              {legacyBody ? MORE.find(([value]) => value === section)?.[1] ?? 'More' : 'More'}
            </Picker>
          </span>
        </nav>
        {more && <button type="button" className="rp-tabs-next" aria-label="More tabs" onClick={() => tabsRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}><Icon name="chevron" /></button>}
        </div>
        <main id="rp-panel" className="rp-work" role="tabpanel" aria-label={legacyBody ? section ?? undefined : LABEL[tab]}>
          {legacyBody ?? (!props ? (
            <p className="ws-status" role={ws.error ? 'alert' : 'status'}>{ws.error ? `The run's agents are unavailable: ${ws.error}` : 'Reading the run…'}</p>
          ) : (
            <Suspense fallback={<p className="ws-status" role="status">Loading…</p>}>
              {tab === 'overview' && <Overview {...props} />}
              {tab === 'timeline' && <Timeline {...props} />}
              {tab === 'files' && <Files {...props} />}
              {tab === 'topology' && <Topology {...props} />}
              {tab === 'conversations' && <Conversations {...props} />}
              {tab === 'traces' && <Traces {...props} />}
              {tab === 'analytics' && <Analytics {...props} />}
              {tab === 'checks' && <Checks {...props} />}
            </Suspense>
          ))}
        </main>
      </div>
    </CardLayer>
  )
}
