import { useMemo, useState } from 'react'
import type { RunDocument } from '../workspace-model.js'
import { StatusPill, useDocument } from './data.js'
import { shortRun } from './play-standing.js'
import type { RunWorkspaceDocument, WorkspaceRelease } from './RunWorkspace.js'
import { viewChip } from './view.js'

/**
 * Two candidate run pages for the journey spec (BRIEF amendment 2026-10-24 19:55Z, JOURNEY.html Q5/Q6), drawn from the
 * same run workspace document so the lead and Drew can pick one: `?layout=a` is a swimlane timeline (one lane per agent
 * across the run's hours, release ticks on top, the span that produced the best release outlined); `?layout=b` leads
 * with the best release's step ladder and how long it has been stuck, then who moved it and what changed.
 */
type Node = RunWorkspaceDocument['nodes'][number] & { start?: string | null; end?: string | null }
type Release = WorkspaceRelease & { by?: Record<string, number> }

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const hours = (a: number, b: number) => (b - a) / 3_600_000
const clock = (t: number) => new Date(t).toISOString().slice(11, 16)
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const tone = (r: Release) => (r.passed != null && r.total ? (r.passed === r.total ? 'pass' : r.passed / r.total >= 0.8 ? 'near' : 'fail') : 'none')

/** The run's plain status line: at most a few words, the jargon behind "details". */
function Head({ doc, sentence }: { doc: RunDocument; sentence: string }) {
  const view = doc.view
  return (
    <header className="rv-head">
      <a className="rv-crumb" href={`/play/${encodeURIComponent(doc.run.play)}`}>{doc.run.play}</a>
      <div className="rv-title"><h1>Run {shortRun(doc.run.play, doc.run.id)}</h1>{view && <StatusPill status={viewChip(view.status)} />}</div>
      <p className="rv-sentence">{sentence}</p>
    </header>
  )
}

function useModel(api: string, doc: RunDocument) {
  const runUrl = `${api}/runs/${encodeURIComponent(doc.run.id)}`
  const ws = useDocument<RunWorkspaceDocument>(`${runUrl}/workspace`)
  return useMemo(() => {
    const data = ws.data
    if (!data) return null
    const nodes = data.nodes as Node[]
    const releases = (data.releases as Release[]).filter((r) => r.taggedAt)
    const t0 = Math.min(...nodes.map((n) => ms(n.start)).filter(Number.isFinite))
    const t1 = Math.max(...nodes.map((n) => ms(n.end ?? n.lastAt)).filter(Number.isFinite))
    const best = releases.find((r) => r.release === data.best) ?? releases.at(-1) ?? null
    const commits = new Map<string, number>()
    for (const r of releases) for (const [id, n] of Object.entries(r.by ?? {})) commits.set(id, (commits.get(id) ?? 0) + n)
    const root = nodes.find((n) => n.role === 'root' || n.role === 'lead')?.id ?? doc.run.id
    // Plateau: since the first release that reached the best's steps.
    const plateau = best ? releases.find((r) => r.passed === best.passed) ?? best : null
    const open = best?.steps?.find((s) => s.state !== 'pass') ?? null
    return { runUrl, data, nodes, releases, t0, t1, best, commits, root, plateau, open }
  }, [ws.data, api, doc.run.id])
}

function plainSentence(doc: RunDocument, m: NonNullable<ReturnType<typeof useModel>>) {
  const word = doc.view?.status.label ?? 'Ended'
  const stuck = m.plateau && m.best ? hours(ms(m.plateau.taggedAt), m.t1) : null
  const blocker = doc.view?.blocker
  return [
    `${word} after ${hours(m.t0, m.t1).toFixed(1)} h.`,
    m.best ? `Best ${m.best.release}: ${m.best.passed} of ${m.best.total} steps${m.open ? `, stuck at the ${m.open.label}` : ''}${stuck ? ` for ${stuck.toFixed(0)} h` : ''}.` : null,
    blocker ? `Blocked by ${blocker.owner ?? 'an owner not named'}.` : null,
  ].filter(Boolean).join(' ')
}

/** Variant A: a run is a story in time. */
function Swimlanes({ doc, m, phone }: { doc: RunDocument; m: NonNullable<ReturnType<typeof useModel>>; phone: boolean }) {
  const [picked, setPicked] = useState<string | null>(null)
  const working = m.nodes.filter((n) => n.id === m.root || m.commits.has(n.id)).sort((a, b) => ms(a.start) - ms(b.start))
  const idle = m.nodes.filter((n) => !working.includes(n))
  const W = phone ? 358 : 1420
  const L = phone ? 0 : 150
  const laneH = phone ? 30 : 34
  const top = 54
  const H = top + (working.length + (idle.length ? 1 : 0)) * laneH + 34
  const x = (t: number) => L + ((t - m.t0) / (m.t1 - m.t0)) * (W - L - 12)
  const bestBy = new Set(Object.keys(m.best?.by ?? {}))
  const prevBest = m.best ? m.releases[m.releases.indexOf(m.best) - 1] : undefined
  const sel = m.nodes.find((n) => n.id === picked) ?? null
  const contributed = sel ? m.releases.filter((r) => r.by?.[sel.id]).map((r) => `${r.release} (${r.by![sel.id]})`) : []
  const ticks = Array.from({ length: phone ? 3 : 7 }, (_, i) => m.t0 + ((m.t1 - m.t0) * i) / (phone ? 2 : 6))
  return (
    <div className="rv-a">
      <svg className="rv-lanes" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Agents across the run's hours, with releases on top">
        {m.releases.map((r) => {
          const rx = x(ms(r.taggedAt))
          const isBest = r === m.best
          return (
            <g key={r.release} className={`rv-rel rv-${tone(r)}${isBest ? ' rv-best' : ''}`}>
              <line x1={rx} x2={rx} y1={top - 8} y2={H - 30} />
              <path d={`M${rx} ${top - 22} l6 7 l-6 7 l-6 -7z`} />
              {(isBest || r === m.releases[0] || !phone) && <text x={rx} y={top - 28} textAnchor="middle">{r.release}{isBest ? ' best' : ''}</text>}
            </g>
          )
        })}
        {m.best && prevBest && bestBy.size > 0 && (() => {
          const rows = working.map((n, i) => (bestBy.has(n.id) ? i : -1)).filter((i) => i >= 0)
          const y0 = top + Math.min(...rows) * laneH + 2
          const y1 = top + (Math.max(...rows) + 1) * laneH - 2
          return <rect className="rv-produced" x={x(ms(prevBest.taggedAt))} y={y0} width={x(ms(m.best.taggedAt)) - x(ms(prevBest.taggedAt))} height={y1 - y0} rx={6} />
        })()}
        {working.map((n, i) => {
          const y = top + i * laneH
          const a = x(ms(n.start)), b = x(ms(n.end ?? n.lastAt))
          const kind = n.status === 'failed' ? 'crash' : n.id === m.root ? 'lead' : 'work'
          return (
            <g key={n.id} className={`rv-lane rv-${kind}${picked === n.id ? ' rv-on' : ''}`} onClick={() => setPicked(n.id)} role="button" tabIndex={0}>
              {!phone && <text className="rv-lane-label" x={L - 10} y={y + laneH / 2 + 4} textAnchor="end">{n.id === m.root ? 'lead' : n.role ?? n.label}</text>}
              <rect x={a} y={y + (phone ? 12 : 8)} width={Math.max(3, b - a)} height={phone ? 12 : 18} rx={4} />
              {phone && <text className="rv-lane-label" x={a} y={y + 9}>{n.id === m.root ? 'lead' : n.role ?? n.label}</text>}
              {m.releases.filter((r) => r.by?.[n.id]).map((r) => <circle key={r.release} cx={x(ms(r.taggedAt))} cy={y + (phone ? 18 : 17)} r={4} />)}
            </g>
          )
        })}
        {idle.length > 0 && <text className="rv-idle" x={phone ? 0 : L} y={top + working.length * laneH + 20}>+{idle.length} agents with no work in a release</text>}
        {ticks.map((t, i) => <text key={t} className="rv-axis" x={x(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{day(t)} {clock(t)}</text>)}
      </svg>
      <div className="rv-detail" aria-live="polite">
        {sel ? (
          <>
            <p className="rv-detail-head">{sel.id === m.root ? 'lead' : sel.role} · {sel.status} · {hours(ms(sel.start), ms(sel.end ?? sel.lastAt)).toFixed(1)} h</p>
            <p>{contributed.length ? `Work in ${contributed.join(', ')}` : 'No work landed in a release.'}</p>
            <p className="rv-muted">{sel.turn ?? 'No last words recorded.'}</p>
            <a href={`/run/${encodeURIComponent(doc.run.id)}?node=${encodeURIComponent(sel.id)}`}>Show the diff and transcript</a>
          </>
        ) : (
          <p className="rv-muted">{m.best ? (() => { const who = [...bestBy].map((id) => (id === m.root ? 'the lead' : m.nodes.find((n) => n.id === id)?.role ?? 'an agent')).join(' and ') || 'the lead'; return `${who.charAt(0).toUpperCase()}${who.slice(1)} produced ${m.best.release}, the best release (outlined). ` })() : ''}Select a lane for that agent's work.</p>
        )}
      </div>
    </div>
  )
}

/** Variant B: how close, and what stops it, first. */
function LadderFirst({ m, phone }: { m: NonNullable<ReturnType<typeof useModel>>; phone: boolean }) {
  const diff = useDocument<{ files: { path: string; additions: number | null; deletions: number | null }[] }>(
    m.best && m.releases.indexOf(m.best) > 0 ? `${m.runUrl}/diff?base=${m.releases[m.releases.indexOf(m.best) - 1]!.release}&head=${m.best.release}` : null,
  )
  const ranked = [...m.commits.entries()].filter(([id]) => id !== m.root).sort((a, b) => b[1] - a[1])
  const top = Math.max(1, ...ranked.map(([, n]) => n))
  const stuck = m.plateau ? hours(ms(m.plateau.taggedAt), m.t1) : null
  return (
    <div className="rv-b">
      {m.best?.steps && (
        <section className="rv-ladder" aria-label={`Best release ${m.best.release}`}>
          {m.best.steps.map((s, i) => (
            <div key={i} className={`rv-step rv-step-${s.state}`}>
              <span className="rv-step-n">{i + 1}</span>
              <span className="rv-step-label">{s.label}</span>
            </div>
          ))}
          <p className="rv-ladder-note">{m.best.release} · {m.open ? `stuck at the ${m.open.label}${stuck ? ` for ${stuck.toFixed(0)} h, since ${m.plateau!.release}` : ''}` : 'every step passes'}</p>
        </section>
      )}
      <section className="rv-releases" aria-label="Releases">
        {m.releases.map((r) => (
          <div key={r.release} className={`rv-mini${r === m.best ? ' rv-best' : ''}`} title={r.sentence ?? undefined}>
            <span className="rv-mini-bar">{(r.steps ?? []).map((s, i) => <i key={i} data-step={s.state} />)}</span>
            <b>{r.release}</b><span className="rv-muted">{clock(ms(r.taggedAt))}</span>
          </div>
        ))}
      </section>
      <div className={phone ? '' : 'rv-cols'}>
        <section aria-label="Who moved it">
          <h2>Who moved it</h2>
          <ol className="rv-who">
            {ranked.slice(0, 6).map(([id, n]) => {
              const node = m.nodes.find((item) => item.id === id)
              return <li key={id}><span>{node?.role ?? node?.label ?? id}</span><i style={{ width: `${(n / top) * 100}%` }} /><b>{n}</b></li>
            })}
          </ol>
          <p className="rv-muted">Commits in releases, by the agent whose work they carry; the lead integrated {m.commits.get(m.root) ?? 0} more.</p>
        </section>
        <section aria-label="What changed">
          <h2>What changed in {m.best?.release}</h2>
          <ul className="rv-files">
            {(diff.data?.files ?? []).slice(0, 8).map((f) => <li key={f.path}><span className="mono">{f.path}</span><b className="rv-add">+{f.additions ?? '?'}</b><b className="rv-del">−{f.deletions ?? '?'}</b></li>)}
          </ul>
          {diff.data && diff.data.files.length > 8 && <p className="rv-muted">and {diff.data.files.length - 8} more files</p>}
        </section>
      </div>
    </div>
  )
}

export function RunVariant({ api, doc, layout }: { api: string; doc: RunDocument; layout: 'a' | 'b' }) {
  const m = useModel(api, doc)
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  if (!m) return <p className="rw-empty">Reading the run…</p>
  return (
    <section className={`rv rv-layout-${layout}`} data-run-variant={layout}>
      <Head doc={doc} sentence={plainSentence(doc, m)} />
      {layout === 'a' ? <Swimlanes doc={doc} m={m} phone={phone} /> : <LadderFirst m={m} phone={phone} />}
    </section>
  )
}
