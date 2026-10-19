import { type DotGroup, unitDotLayout } from '@tangle-network/charts'
import { DOT_MAP_CATEGORIES, DotMap, type DotMapLabel, type DotMapRect } from '@tangle-network/charts/react'
import { useEffect, useMemo, useState } from 'react'
import { useDocument } from './data.js'

/**
 * The fleet explorer (J5, J3): every Discovery run as one dot, packed in a rectangle per play, or every agent the Lab
 * mapped by what its transcript says (its semantic map), coloured by a lens. The host (`/api/discovery/explore`) joins
 * the catalog, the Lab's semantic map and its computed columns; the page lays them out and draws them on one canvas.
 */

type Cell = string | number | null
interface Table {
  columns: string[]
  rows: Cell[][]
}
interface Agreement {
  column: string
  id: string
  classifiers: string[]
  n: number
  agree: number
  kappa: number
  decided?: { n: number; agree: number; kappa: number } | null
  confusion?: Record<string, number>
}
interface Disagreement {
  column: string
  runId: string
  agent: string
  href?: string
  [classifier: string]: string | undefined
}
export interface ExploreDocument {
  schema: string
  composedAt?: string
  runs: Table
  semantic: { map: string; builtAt?: string | null; clusters: Array<{ id: number; label: string | null; labelled?: boolean; size: number; runs: number; x: number | null; y: number | null }>; agents: Table } | null
  columns: {
    builtAt?: string | null
    classifiers?: Array<{ name: string; model?: string; family?: string }> | null
    columns?: Array<{ id: string; key: string; question: string; labels: string[] }> | null
    sample?: unknown
    agreement: Agreement[]
    disagreements: Disagreement[]
    labels: Table
  } | null
}

type Layout = 'runs' | 'agents'
type Lens = 'ending' | 'harness' | 'credential' | 'program' | 'cluster' | `column:${string}`

const LENS_WORD: Record<string, string> = { ending: 'How it ended', harness: 'Harness', credential: 'Credential', program: 'Program', cluster: 'Behaviour cluster' }
/** The play groups a fleet layout draws on their own; the rest fold into one rectangle. */
const GROUPS_SHOWN = 40
const ORDER_FIRST: Record<string, string[]> = { ending: ['solved', 'died', 'ended', 'cancelled', 'stalled', 'live', 'never started'] }

const col = (table: Table, name: string) => table.columns.indexOf(name)
const fmtInt = (n: number) => n.toLocaleString('en-US')
const utc = (seconds: Cell) => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '—')

/** One lens over the points: each point's category, the categories by count, and which three are drawn in colour. */
function lensOf(values: string[], named: string[] | null, lens: string) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const first = ORDER_FIRST[lens] ?? []
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1] || first.indexOf(a[0]) - first.indexOf(b[0])).map(([value, count]) => ({ value, count }))
  const pick = (named ?? categories.filter((item) => item.value !== 'none' && item.value !== 'not labelled').slice(0, 3).map((item) => item.value)).slice(0, 3)
  const slot = new Map(pick.map((value, i) => [value, i]))
  const colors = new Uint8Array(values.length)
  values.forEach((value, i) => (colors[i] = slot.get(value) ?? 3))
  return { categories, named: pick, slot, colors }
}

export function ExplorePage({ api }: { api: string }) {
  const doc = useDocument<ExploreDocument>(`${api}/explore`)
  const [layout, setLayout] = useState<Layout>(() => (new URLSearchParams(window.location.search).get('layout') === 'agents' ? 'agents' : 'runs'))
  const [lens, setLens] = useState<Lens>(() => (layout === 'agents' ? 'cluster' : 'ending'))
  const [named, setNamed] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.innerWidth < 700)
  useEffect(() => {
    const changed = () => setPhone(window.innerWidth < 700)
    window.addEventListener('resize', changed)
    return () => window.removeEventListener('resize', changed)
  }, [])
  useEffect(() => {
    const url = new URL(window.location.href)
    if (layout === 'agents') url.searchParams.set('layout', 'agents')
    else url.searchParams.delete('layout')
    window.history.replaceState(null, '', url)
  }, [layout])

  const data = doc.data ?? null
  const runs = data?.runs ?? null
  const agents = data?.semantic?.agents ?? null
  // Labels each classifier gave an agent, keyed `run:agent`, for the column lenses and the selected agent.
  const columnLabels = useMemo(() => {
    const out = new Map<string, Record<string, Record<string, string | null>>>()
    const table = data?.columns?.labels
    if (!table) return out
    const [ri, ai, di] = [col(table, 'run'), col(table, 'agent'), col(table, 'dimension')]
    const names = table.columns.slice(3)
    for (const row of table.rows) {
      const key = `${row[ri]}:${row[ai]}`
      const entry = out.get(key) ?? {}
      entry[String(row[di])] = Object.fromEntries(names.map((name, k) => [name, (row[3 + k] as string | null) ?? null]))
      out.set(key, entry)
    }
    return out
  }, [data])
  const clusterLabel = useMemo(() => new Map((data?.semantic?.clusters ?? []).map((cluster) => [cluster.id, cluster.label ?? `cluster ${cluster.id}`])), [data])
  const firstClassifier = data?.columns?.labels.columns[3] ?? null

  /** Each point's run row index (agents point at their run). */
  const runOfPoint = useMemo(() => {
    if (!runs) return [] as number[]
    if (layout === 'runs' || !agents) return runs.rows.map((_, i) => i)
    const ri = col(agents, 'run')
    return agents.rows.map((row) => row[ri] as number)
  }, [runs, agents, layout])

  const values = useMemo(() => {
    if (!runs) return [] as string[]
    const field = (name: string) => {
      const k = col(runs, name)
      return runOfPoint.map((r) => String(runs.rows[r]?.[k] ?? 'none'))
    }
    if (lens === 'cluster' && agents) {
      const ci = col(agents, 'cluster')
      return agents.rows.map((row) => (row[ci] === -1 || row[ci] === null ? 'unclustered' : (clusterLabel.get(row[ci] as number) ?? `cluster ${row[ci]}`)))
    }
    if (lens.startsWith('column:') && agents) {
      const dimension = lens.slice(7)
      const [ri, ai] = [col(agents, 'run'), col(agents, 'agent')]
      return agents.rows.map((row) => {
        const labels = columnLabels.get(`${runs.rows[row[ri] as number]?.[0]}:${row[ai]}`)?.[dimension]
        return labels && firstClassifier ? (labels[firstClassifier] ?? 'not labelled') : 'not labelled'
      })
    }
    return field(lens)
  }, [runs, agents, lens, runOfPoint, clusterLabel, columnLabels, firstClassifier])

  const colored = useMemo(() => lensOf(values, named, lens), [values, named, lens])

  // Positions: unit dots grouped by play (runs), or the semantic map's x and y (agents).
  const geometry = useMemo(() => {
    if (!runs) return null
    if (layout === 'agents' && agents) {
      const [xi, yi] = [col(agents, 'x'), col(agents, 'y')]
      const positions = new Float32Array(agents.rows.length * 2)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      agents.rows.forEach((row, i) => {
        // The map's y grows upward; the canvas's downward.
        const x = row[xi] as number, y = -(row[yi] as number)
        positions[i * 2] = x
        positions[i * 2 + 1] = y
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
      })
      const labels: DotMapLabel[] = (data?.semantic?.clusters ?? []).filter((cluster) => cluster.labelled !== false && cluster.label && cluster.x !== null && cluster.y !== null).slice(0, 30).map((cluster) => ({ x: cluster.x!, y: -cluster.y!, text: cluster.label! }))
      return { positions, radii: (x1 - x0) / 900, extent: [x0, y0, x1, y1] as const, rects: undefined, labels, order: null as Int32Array | null }
    }
    const pi = col(runs, 'play')
    const byPlay = new Map<string, number[]>()
    runs.rows.forEach((row, i) => {
      const play = String(row[pi])
      const list = byPlay.get(play)
      if (list) list.push(i)
      else byPlay.set(play, [i])
    })
    const ranked = [...byPlay.entries()].sort((a, b) => b[1].length - a[1].length)
    const shown = ranked.slice(0, GROUPS_SHOWN)
    const rest = ranked.slice(GROUPS_SHOWN)
    const groups: Array<{ id: string; label: string; members: number[] }> = shown.map(([play, members]) => ({ id: play, label: play, members }))
    if (rest.length) groups.push({ id: '__other', label: `${rest.length} other plays`, members: rest.flatMap(([, members]) => members) })
    // Within a group, dots run in lens order, so each play reads as its proportions.
    for (const group of groups) group.members.sort((a, b) => (colored.colors[a]! - colored.colors[b]!) || a - b)
    const order = new Int32Array(runs.rows.length)
    let k = 0
    for (const group of groups) for (const member of group.members) order[k++] = member
    const box: [number, number] = phone ? [360, 900] : [1300, 640]
    const dots = unitDotLayout(groups.map((group): DotGroup => ({ id: group.id, label: group.label, count: group.members.length })), box[0], box[1], { header: phone ? 14 : 16, maxRadius: 7 })
    // unitDotLayout places items in group order; map them back to run rows.
    const positions = new Float32Array(runs.rows.length * 2)
    const radii = new Float32Array(runs.rows.length)
    for (let p = 0; p < order.length; p++) {
      const r = order[p]!
      positions[r * 2] = dots.positions[p * 2]!
      positions[r * 2 + 1] = dots.positions[p * 2 + 1]!
      radii[r] = dots.radii[p]!
    }
    const rects: DotMapRect[] = dots.rects.map((rect) => ({ x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1, label: rect.label, note: fmtInt(rect.count) }))
    return { positions, radii, extent: [0, 0, box[0], box[1]] as const, rects, labels: undefined, order }
  }, [runs, agents, layout, colored.colors, data, phone])

  const dimmed = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !runs) return null
    const [ii, pi] = [col(runs, 'id'), col(runs, 'play')]
    const out = new Uint8Array(runOfPoint.length)
    runOfPoint.forEach((r, i) => {
      const row = runs.rows[r]
      out[i] = row && (String(row[ii]).toLowerCase().includes(q) || String(row[pi]).toLowerCase().includes(q) || values[i]!.toLowerCase().includes(q)) ? 0 : 1
    })
    return out
  }, [query, runs, runOfPoint, values])
  const matches = dimmed ? dimmed.reduce((sum, value) => sum + (value ? 0 : 1), 0) : null

  if (doc.error) return <p className="ws-status" role="alert">The explorer is unavailable: {doc.error}</p>
  if (!data || !runs || !geometry) return <p className="ws-status" role="status">Loading the fleet…</p>

  const describe = (i: number) => {
    const row = runs.rows[runOfPoint[i]!]
    if (!row) return ''
    const agent = layout === 'agents' && agents ? String(agents.rows[i]![col(agents, 'agent')]) : null
    return [agent ? `${row[0]} · ${agent}` : String(row[0]), `${row[col(runs, 'play')]} · ${row[col(runs, 'ending')]}`, `${LENS_WORD[lens] ?? lens.slice(7)}: ${values[i]}`].join('\n')
  }
  const lensOptions: Lens[] = layout === 'agents' ? ['cluster', 'ending', 'harness', 'credential', ...((data.columns?.agreement ?? []).map((item) => `column:${item.id}` as Lens))] : ['ending', 'harness', 'credential', 'program']
  const columnTitle = (id: string) => {
    const item = data.columns?.agreement.find((a) => a.id === id)
    return item ? `${id} ${item.column.replaceAll('_', ' ')}` : id
  }
  const lensTitle = (value: Lens) => (value.startsWith('column:') ? columnTitle(value.slice(7)) : LENS_WORD[value])
  const toggleNamed = (value: string) => {
    const current = colored.named
    if (current.includes(value)) setNamed(current.filter((item) => item !== value))
    else setNamed([...current, value].slice(-3))
  }
  const sel = selected !== null && selected < runOfPoint.length ? selected : null
  const selRow = sel !== null ? runs.rows[runOfPoint[sel]!] : null
  const selAgent = sel !== null && layout === 'agents' && agents ? String(agents.rows[sel]![col(agents, 'agent')]) : null
  const selLabels = selRow && selAgent ? columnLabels.get(`${selRow[0]}:${selAgent}`) : undefined

  return (
    <div className="ws-page explore-page" data-explore>
      <header className="ws-head explore-head">
        <div className="ws-title-row">
          <h1>Explore</h1>
          <p className="faint explore-counts">
            {fmtInt(runs.rows.length)} runs{data.semantic ? ` · ${fmtInt(data.semantic.agents.rows.length)} agents mapped by what they said (${data.semantic.clusters.length} clusters)` : ' · no semantic map yet'}
          </p>
        </div>
        <div className="explore-controls" role="toolbar" aria-label="Explorer controls">
          <div className="seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={layout === 'runs'} onClick={() => { setLayout('runs'); setLens('ending'); setNamed(null); setSelected(null) }}>Runs by play</button>
            <button type="button" aria-pressed={layout === 'agents'} disabled={!data.semantic} title={data.semantic ? undefined : 'The Lab has not built a semantic map of agents'} onClick={() => { setLayout('agents'); setLens('cluster'); setNamed(null); setSelected(null) }}>Agents by behaviour</button>
          </div>
          <label className="explore-lens">
            <span className="faint">Colour</span>
            <select value={lens} onChange={(event) => { setLens(event.target.value as Lens); setNamed(null) }}>
              {lensOptions.map((value) => (
                <option key={value} value={value}>{lensTitle(value)}</option>
              ))}
            </select>
          </label>
          <input type="search" className="explore-search" placeholder="Find a run, play or label" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a run, play or label" />
          {matches !== null && <span className="faint">{fmtInt(matches)} match</span>}
        </div>
      </header>
      <div className="explore-body">
        <section className="ws-section explore-map" aria-label="Map">
          <DotMap
            positions={geometry.positions}
            radii={geometry.radii}
            colors={colored.colors}
            palette={DOT_MAP_CATEGORIES}
            extent={geometry.extent}
            rects={geometry.rects}
            labels={geometry.labels}
            dimmed={dimmed}
            selected={sel}
            minPixelRadius={layout === 'agents' ? 1.6 : 1.2}
            onSelect={setSelected}
            describe={describe}
            height={phone ? 440 : 640}
            ariaLabel={layout === 'agents' ? `${agents?.rows.length ?? 0} agents placed by what their transcripts say, coloured by ${lensTitle(lens)}` : `${runs.rows.length} runs grouped by play, coloured by ${lensTitle(lens)}`}
          />
          <p className="faint explore-hint">Scroll to zoom, drag to pan, double-click to fit; click a dot for its run.{layout === 'agents' ? ' Nearby agents said similar things (EmbeddingGemma, UMAP, HDBSCAN); labels name the largest clusters.' : ' One rectangle per play, sized by its runs; the 40 largest plays are drawn on their own.'}</p>
        </section>
        <aside className="ws-section explore-side" aria-label="Legend and selection">
          <h3>{lensTitle(lens)}</h3>
          <p className="faint explore-legend-note">Three named in colour; click a row to name it. The rest are grey.</p>
          <ol className="explore-legend">
            {colored.categories.slice(0, 14).map((item) => {
              const slot = colored.slot.get(item.value)
              return (
                <li key={item.value}>
                  <button type="button" onClick={() => toggleNamed(item.value)} aria-pressed={slot !== undefined} title={slot !== undefined ? 'Named in colour; click to grey it' : 'Click to name it in colour'}>
                    <i style={{ background: DOT_MAP_CATEGORIES[slot ?? 3] }} data-named={slot !== undefined ? 'yes' : 'no'} />
                    <span className="explore-legend-label">{item.value}</span>
                    <span className="num faint">{fmtInt(item.count)}</span>
                  </button>
                </li>
              )
            })}
            {colored.categories.length > 14 && <li className="faint">{colored.categories.length - 14} more, {fmtInt(colored.categories.slice(14).reduce((sum, item) => sum + item.count, 0))} points</li>}
          </ol>
          {selRow ? (
            <div className="explore-selected" data-selected={String(selRow[0])}>
              <h3>{selAgent ? 'Agent' : 'Run'}</h3>
              <p className="mono explore-selected-id">
                <a href={`/run/${encodeURIComponent(String(selRow[0]))}${selAgent ? `?agent=${encodeURIComponent(selAgent)}` : ''}`}>{String(selRow[0])}{selAgent ? ` · ${selAgent}` : ''}</a>
              </p>
              <dl className="explore-facts">
                <dt>play</dt>
                <dd><a href={`/play/${encodeURIComponent(String(selRow[col(runs, 'play')]))}`}>{String(selRow[col(runs, 'play')])}</a></dd>
                <dt>ended</dt>
                <dd>{String(selRow[col(runs, 'ending')])}</dd>
                <dt>started</dt>
                <dd>{utc(selRow[col(runs, 'started')])}</dd>
                {selRow[col(runs, 'wallHours')] !== null && (<><dt>wall</dt><dd>{String(selRow[col(runs, 'wallHours')])} h</dd></>)}
                {selRow[col(runs, 'agents')] !== null && (<><dt>agents</dt><dd>{String(selRow[col(runs, 'agents')])}</dd></>)}
                {selRow[col(runs, 'harness')] !== null && (<><dt>harness</dt><dd>{String(selRow[col(runs, 'harness')])}</dd></>)}
                {selRow[col(runs, 'lostHours')] !== null && (<><dt>lost</dt><dd>{String(selRow[col(runs, 'lostHours')])} agent-h</dd></>)}
                {selAgent && agents && (<><dt>cluster</dt><dd>{values[sel!] && lens === 'cluster' ? values[sel!] : (clusterLabel.get(agents.rows[sel!]![col(agents, 'cluster')] as number) ?? 'unclustered')}</dd></>)}
              </dl>
              {selLabels && (
                <table className="data-table explore-labels">
                  <thead>
                    <tr>
                      <th>Column</th>
                      {data.columns!.labels.columns.slice(3).map((name) => <th key={name}>{name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(selLabels).map(([dimension, byClassifier]) => {
                      const labels = Object.values(byClassifier)
                      return (
                        <tr key={dimension} data-agree={new Set(labels).size === 1 ? 'yes' : 'no'}>
                          <td title={data.columns?.columns?.find((item) => item.id === dimension)?.question}>{columnTitle(dimension)}</td>
                          {labels.map((label, k) => <td key={k}>{label ?? '—'}</td>)}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <p className="faint explore-selected-empty">Click a dot to see its run{layout === 'agents' ? ', its cluster and what each classifier labelled it' : ''}.</p>
          )}
        </aside>
      </div>
      {data.columns && <ComputedColumns columns={data.columns} />}
    </div>
  )
}

/**
 * Computed columns (J5): one question per behaviour, answered for each sampled agent by two classifiers from different
 * model families; Cohen's kappa says how far their agreement exceeds chance, over every agent and over those both
 * decided. A column whose kappa is near zero is noise on this evidence, and the table says so.
 */
function ComputedColumns({ columns }: { columns: NonNullable<ExploreDocument['columns']> }) {
  const [open, setOpen] = useState<string | null>(null)
  const names = columns.labels.columns.slice(3)
  const word = (kappa: number) => (kappa >= 0.6 ? 'substantial' : kappa >= 0.4 ? 'moderate' : kappa >= 0.2 ? 'fair' : 'noise')
  return (
    <section className="ws-section explore-columns" aria-label="Computed columns">
      <header className="section-head">
        <h3>Computed columns</h3>
        <p className="faint">
          Each column asks one question of every sampled agent{columns.classifiers?.length ? `, answered by ${columns.classifiers.map((item) => `${item.name} (${item.model ?? 'model unrecorded'})`).join(' and ')}` : ''}. κ is Cohen&rsquo;s kappa between the two, over all agents and over those both decided; under 0.2 is noise.
        </p>
      </header>
      <div className="table-scroll">
        <table className="data-table explore-agreement">
          <thead>
            <tr>
              <th>Column</th>
              <th className="num">n</th>
              <th className="num">agree</th>
              <th className="num">κ</th>
              <th className="num">decided n</th>
              <th className="num">decided κ</th>
              <th>Reads as</th>
              <th>Disagreements</th>
            </tr>
          </thead>
          <tbody>
            {columns.agreement.map((item) => {
              const question = columns.columns?.find((c) => c.id === item.id)?.question
              const disagreements = columns.disagreements.filter((d) => d.column === item.column)
              return (
                <tr key={item.id} data-column={item.id}>
                  <td title={question}>
                    <b>{item.id}</b> {item.column.replaceAll('_', ' ')}
                  </td>
                  <td className="num">{item.n}</td>
                  <td className="num">{Math.round(item.agree * 100)}%</td>
                  <td className="num">
                    <span className="kappa-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, item.kappa)) * 100}%` }} /></span> {item.kappa.toFixed(2)}
                  </td>
                  <td className="num">{item.decided?.n ?? '—'}</td>
                  <td className="num">{item.decided ? item.decided.kappa.toFixed(2) : '—'}</td>
                  <td className={`kappa-word kappa-${word(item.kappa)}`}>{word(item.kappa)}</td>
                  <td>
                    {disagreements.length ? (
                      <button type="button" className="link-button" onClick={() => setOpen(open === item.id ? null : item.id)}>
                        {open === item.id ? 'hide' : `${disagreements.length} agents`}
                      </button>
                    ) : (
                      <span className="faint">none listed</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {open && (
        <ul className="explore-disagreements">
          {columns.disagreements
            .filter((d) => d.column === columns.agreement.find((a) => a.id === open)?.column)
            .slice(0, 60)
            .map((d) => (
              <li key={`${d.runId}:${d.agent}`}>
                <a className="mono" href={d.href ?? `/run/${encodeURIComponent(d.runId)}?agent=${encodeURIComponent(d.agent)}`}>{d.runId} · {d.agent}</a>
                {names.map((name) => <span key={name} className="faint"> {name}: <b>{d[name] ?? '—'}</b></span>)}
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}
