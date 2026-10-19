import { type DotGroup, type RateRow, rankedRates, unitDotLayout } from '@tangle-network/charts'
import { DOT_MAP_CATEGORIES, DotMap, type DotMapLabel, type DotMapRect, FigureView } from '@tangle-network/charts/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
type Lens = 'ending' | 'outcome' | 'harness' | 'credential' | 'program' | 'effort' | 'cluster' | `column:${string}`

const LENS_WORD: Record<string, string> = {
  ending: 'How it ended',
  outcome: 'Research outcome or infrastructure',
  harness: 'Harness',
  credential: 'Credential',
  program: 'Program',
  effort: 'Reasoning effort',
  cluster: 'Behaviour cluster',
}

/**
 * The catalog's own state as a research outcome or an infrastructure failure (J1): a run the driver lost never reached a
 * research verdict, so it is never counted as a research failure. States with no verdict recorded read as such.
 */
const OUTCOME_OF: Record<string, string> = {
  winner: 'solved',
  'no-winner': 'not solved',
  failed: 'failed',
  'driver-failed': 'infrastructure failure',
  running: 'live or stalled',
  stalled: 'live or stalled',
}
const outcomeOf = (state: Cell) => OUTCOME_OF[String(state)] ?? 'no outcome recorded'

/**
 * Lenses whose categories are fixed words get fixed colours, the same on every view: solved is the ok hue, an
 * infrastructure failure or a death the failure hue. Other lenses name their three largest categories in colour.
 */
const FIXED: Record<string, Record<string, string>> = {
  ending: {
    solved: 'var(--ar-c-ok)',
    died: 'var(--ar-c-fail)',
    ended: 'var(--ar-c-info)',
    stalled: 'var(--ar-c-run)',
    cancelled: 'var(--chart-category-other)',
    live: 'var(--ar-c-action)',
    'never started': 'color-mix(in srgb, var(--chart-category-other) 45%, transparent)',
  },
  outcome: {
    solved: 'var(--ar-c-ok)',
    'not solved': 'var(--ar-c-info)',
    failed: 'var(--ar-c-run)',
    'infrastructure failure': 'var(--ar-c-fail)',
    'live or stalled': 'var(--ar-c-action)',
    'no outcome recorded': 'color-mix(in srgb, var(--chart-category-other) 45%, transparent)',
  },
}
/** The play groups a fleet layout draws on their own; the rest fold into one rectangle. */
const GROUPS_SHOWN = 40
const ORDER_FIRST: Record<string, string[]> = { ending: ['solved', 'died', 'ended', 'cancelled', 'stalled', 'live', 'never started'] }

const col = (table: Table, name: string) => table.columns.indexOf(name)
const fmtInt = (n: number) => n.toLocaleString('en-US')
const utc = (seconds: Cell) => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '—')

/**
 * One lens over the points: each point's category, the categories by count, and its palette. A fixed lens colours every
 * category it knows; any other lens names three categories in colour (the largest, or the ones clicked) and greys the rest.
 */
function lensOf(values: string[], named: string[] | null, lens: string) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const first = ORDER_FIRST[lens] ?? []
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1] || first.indexOf(a[0]) - first.indexOf(b[0])).map(([value, count]) => ({ value, count }))
  const fixed = FIXED[lens]
  if (fixed) {
    const known = categories.filter((item) => fixed[item.value]).map((item) => item.value)
    const palette = [...known.map((value) => fixed[value]!), DOT_MAP_CATEGORIES[3]!]
    const slot = new Map(known.map((value, i) => [value, i]))
    const colors = new Uint8Array(values.length)
    values.forEach((value, i) => (colors[i] = slot.get(value) ?? known.length))
    return { categories, named: known, slot, colors, palette, fixed: true }
  }
  const pick = (named ?? categories.filter((item) => item.value !== 'none' && item.value !== 'not labelled').slice(0, 3).map((item) => item.value)).slice(0, 3)
  const slot = new Map(pick.map((value, i) => [value, i]))
  const colors = new Uint8Array(values.length)
  values.forEach((value, i) => (colors[i] = slot.get(value) ?? 3))
  return { categories, named: pick, slot, colors, palette: DOT_MAP_CATEGORIES, fixed: false }
}

/** A Wilson score interval at 95%: the solve rate's uncertainty for n runs, never a bare percentage. */
function wilson(k: number, n: number) {
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half), level: 0.95, method: 'wilson' as const }
}

export function ExplorePage({ api }: { api: string }) {
  const doc = useDocument<ExploreDocument>(`${api}/explore`)
  const [layout, setLayout] = useState<Layout>(() => (new URLSearchParams(window.location.search).get('layout') === 'agents' ? 'agents' : 'runs'))
  const [lens, setLens] = useState<Lens>(() => (layout === 'agents' ? 'cluster' : 'ending'))
  const [named, setNamed] = useState<string[] | null>(null)
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const [only, setOnly] = useState<string | null>(null)
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
    if (lens === 'outcome') {
      const k = col(runs, 'state')
      return runOfPoint.map((r) => outcomeOf(runs.rows[r]?.[k] ?? null))
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
    // A dot's area follows its run's wall hours (the 95th percentile fills the cell), so long runs stand out the way
    // long trajectories do in a length-sized map; a run with no recorded hours keeps the smallest size.
    const wi = col(runs, 'wallHours')
    const hours = runs.rows.map((row) => (typeof row[wi] === 'number' ? (row[wi] as number) : null))
    const known = hours.filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b)
    const p95 = known.length ? known[Math.min(known.length - 1, Math.floor(known.length * 0.95))]! : 1
    for (let p = 0; p < order.length; p++) {
      const r = order[p]!
      positions[r * 2] = dots.positions[p * 2]!
      positions[r * 2 + 1] = dots.positions[p * 2 + 1]!
      const h = hours[r]
      radii[r] = dots.radii[p]! * (h === null || !(h > 0) ? 0.45 : 0.45 + 0.55 * Math.sqrt(Math.min(1, h / p95)))
    }
    const rects: DotMapRect[] = dots.rects.map((rect) => ({ x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1, label: rect.label, note: fmtInt(rect.count) }))
    return { positions, radii, extent: [0, 0, box[0], box[1]] as const, rects, labels: undefined, order }
  }, [runs, agents, layout, colored.colors, data, phone])

  const dimmed = useMemo(() => {
    const q = query.trim().toLowerCase()
    if ((!q && !only) || !runs) return null
    const [ii, pi] = [col(runs, 'id'), col(runs, 'play')]
    const out = new Uint8Array(runOfPoint.length)
    runOfPoint.forEach((r, i) => {
      const row = runs.rows[r]
      const found = !q || (row && (String(row[ii]).toLowerCase().includes(q) || String(row[pi]).toLowerCase().includes(q) || values[i]!.toLowerCase().includes(q)))
      out[i] = found && (!only || values[i] === only) ? 0 : 1
    })
    return out
  }, [query, only, runs, runOfPoint, values])
  const matches = dimmed ? dimmed.reduce((sum, value) => sum + (value ? 0 : 1), 0) : null

  if (doc.error) return <p className="ws-status" role="alert">The explorer is unavailable: {doc.error}</p>
  if (!data || !runs || !geometry) return <p className="ws-status" role="status">Loading the fleet…</p>

  const describe = (i: number) => {
    const row = runs.rows[runOfPoint[i]!]
    if (!row) return ''
    const agent = layout === 'agents' && agents ? String(agents.rows[i]![col(agents, 'agent')]) : null
    return [agent ? `${row[0]} · ${agent}` : String(row[0]), `${row[col(runs, 'play')]} · ${row[col(runs, 'ending')]}`, `${LENS_WORD[lens] ?? lens.slice(7)}: ${values[i]}`].join('\n')
  }
  const lensOptions: Lens[] = layout === 'agents' ? ['cluster', 'ending', 'outcome', 'harness', 'credential', ...((data.columns?.agreement ?? []).map((item) => `column:${item.id}` as Lens))] : ['ending', 'outcome', 'harness', 'credential', 'program', 'effort']
  const columnTitle = (id: string) => {
    const item = data.columns?.agreement.find((a) => a.id === id)
    return item ? `${id} ${item.column.replaceAll('_', ' ')}` : id
  }
  const lensTitle = (value: Lens) => (value.startsWith('column:') ? columnTitle(value.slice(7)) : LENS_WORD[value])
  const toggleNamed = (value: string) => {
    if (colored.fixed) {
      setOnly(only === value ? null : value)
      return
    }
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
          <FleetLine runs={runs} onPick={(value) => { setLayout('runs'); setLens('outcome'); setNamed(null); setOnly(value); setSelected(null) }} />
          <p className="faint explore-counts">
            {data.semantic ? `${fmtInt(data.semantic.agents.rows.length)} agents mapped by what they said (${data.semantic.clusters.length} clusters, built ${utc(Date.parse(data.semantic.builtAt ?? '') / 1000)})` : 'No semantic map of agents yet'}
          </p>
        </div>
        <div className="explore-controls" role="toolbar" aria-label="Explorer controls">
          <div className="seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={layout === 'runs'} onClick={() => { setLayout('runs'); setLens('ending'); setNamed(null); setOnly(null); setSelected(null) }}>Runs by play</button>
            <button type="button" aria-pressed={layout === 'agents'} disabled={!data.semantic} title={data.semantic ? undefined : 'The Lab has not built a semantic map of agents'} onClick={() => { setLayout('agents'); setLens('cluster'); setNamed(null); setOnly(null); setSelected(null) }}>Agents by behaviour</button>
          </div>
          <label className="explore-lens">
            <span className="faint">Colour</span>
            <select value={lens} onChange={(event) => { setLens(event.target.value as Lens); setNamed(null); setOnly(null) }}>
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
            palette={colored.palette}
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
          <p className="faint explore-legend-note">{colored.fixed ? 'Click a row to show only it.' : 'Three named in colour; click a row to name it. The rest are grey.'}</p>
          <ol className="explore-legend">
            {colored.categories.slice(0, 14).map((item) => {
              const slot = colored.slot.get(item.value)
              return (
                <li key={item.value}>
                  <button type="button" onClick={() => toggleNamed(item.value)} aria-pressed={colored.fixed ? only === item.value : slot !== undefined} title={colored.fixed ? (only === item.value ? 'Shown alone; click to show every category' : 'Click to show only these') : slot !== undefined ? 'Named in colour; click to grey it' : 'Click to name it in colour'}>
                    <i style={{ background: colored.palette[slot ?? colored.palette.length - 1] }} data-named={slot !== undefined ? 'yes' : 'no'} />
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
      <Compare runs={runs} runOfPoint={runOfPoint} values={values} lens={lens} lensTitle={lensTitle(lens)} unit={layout === 'agents' ? 'agent' : 'run'} />
      {data.columns && <ComputedColumns columns={data.columns} />}
    </div>
  )
}

/**
 * The fleet in one line (J1): every catalogued run by research outcome, with infrastructure failures counted apart from
 * research verdicts. Each count isolates its runs on the map.
 */
function FleetLine({ runs, onPick }: { runs: Table; onPick: (value: string) => void }) {
  const k = col(runs, 'state')
  const counts = new Map<string, number>()
  for (const row of runs.rows) {
    const value = outcomeOf(row[k] ?? null)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const order = ['solved', 'not solved', 'failed', 'infrastructure failure', 'live or stalled', 'no outcome recorded']
  const total = runs.rows.length
  return (
    <p className="explore-fleet-line" data-fleet-line>
      <b>{fmtInt(total)} runs</b>
      {order
        .filter((value) => counts.get(value))
        .map((value) => (
          <span key={value}>
            {' · '}
            <button type="button" className="link-button" onClick={() => onPick(value)} title={`Show only the ${fmtInt(counts.get(value)!)} runs whose catalog state reads ${value}, of ${fmtInt(total)}`}>
              <i className="explore-swatch" style={{ background: FIXED.outcome![value] }} aria-hidden="true" />
              {fmtInt(counts.get(value)!)} {value}
            </button>
            {value === 'infrastructure failure' ? <span className="faint"> ({Math.round((counts.get(value)! / total) * 100)}%)</span> : null}
          </span>
        ))}
    </p>
  )
}

const RESEARCH = new Set(['winner', 'no-winner', 'failed'])

/**
 * Compare cohorts (J4, J6): the solve rate of each category of the current lens, over runs that reached a research
 * verdict, and its infrastructure failure rate over runs that started, each with a 95% Wilson interval. A category under
 * five runs prints its count without a bar. Under an outcome lens the cohorts are harnesses.
 */
function Compare({ runs, runOfPoint, values, lens, lensTitle, unit }: { runs: Table; runOfPoint: number[]; values: string[]; lens: Lens; lensTitle: string; unit: 'run' | 'agent' }) {
  const by = lens === 'ending' || lens === 'outcome' ? 'harness' : lens
  const byTitle = by === lens ? lensTitle : LENS_WORD.harness!
  const rows = useMemo(() => {
    const k = col(runs, 'state')
    const wi = col(runs, 'wallHours')
    const hi = col(runs, by)
    const groups = new Map<string, { research: number; solved: number; started: number; infra: number; hours: number[] }>()
    runOfPoint.forEach((r, i) => {
      const row = runs.rows[r]
      if (!row) return
      const key = by === lens ? values[i]! : String(row[hi] ?? 'none')
      const g = groups.get(key) ?? { research: 0, solved: 0, started: 0, infra: 0, hours: [] }
      const state = String(row[k] ?? '')
      if (RESEARCH.has(state)) {
        g.research++
        if (state === 'winner') g.solved++
      }
      if (RESEARCH.has(state) || state === 'driver-failed') {
        g.started++
        if (state === 'driver-failed') g.infra++
      }
      if (typeof row[wi] === 'number') g.hours.push(row[wi] as number)
      groups.set(key, g)
    })
    return [...groups.entries()].filter(([, g]) => g.started > 0).sort((a, b) => b[1].started - a[1].started).slice(0, 10)
  }, [runs, runOfPoint, values, by, lens])
  const rate = (pick: 'solve' | 'infra') =>
    rows.map(([label, g]): RateRow => {
      const n = pick === 'solve' ? g.research : g.started
      const k = pick === 'solve' ? g.solved : g.infra
      const sorted = [...g.hours].sort((a, b) => a - b)
      return {
        id: `${pick}:${label}`,
        label,
        rank: null,
        solved: k,
        attempts: n,
        rate: n ? k / n : 0,
        estimate: n >= 5 ? 'descriptive' : n ? 'insufficient' : 'none',
        interval: n >= 5 ? wilson(k, n) : null,
        tiers: null,
        cost: { perSolvedUsd: null, basis: 'unknown', receipts: null },
        medianWallMs: sorted.length ? sorted[Math.floor(sorted.length / 2)]! * 3_600_000 : null,
        onFront: null,
      }
    })
  const solve = useCallback(() => rankedRates(rate('solve'), { id: 'explore-solve', measure: 'solve rate', nouns: { attempt: unit, setup: byTitle.toLowerCase() } }), [rows, unit, byTitle])
  const infra = useCallback(() => rankedRates(rate('infra'), { id: 'explore-infra', measure: 'infrastructure failure rate', nouns: { attempt: unit, setup: byTitle.toLowerCase() } }), [rows, unit, byTitle])
  if (!rows.length) return null
  return (
    <section className="ws-section explore-compare" aria-label="Compare cohorts" data-explore-compare>
      <header className="section-head">
        <h3>Compare by {byTitle.toLowerCase()}</h3>
        <p className="faint">
          Solve rate over {unit === 'agent' ? 'agents whose runs' : 'runs that'} reached a research verdict (solved, not solved or failed), and infrastructure failure rate over {unit === 'agent' ? 'agents whose runs started' : 'runs that started'}, with 95% Wilson intervals; the ten largest cohorts. Under five, the count prints without a bar.{by !== lens ? ' Colour by another lens to compare by it.' : ''}
        </p>
      </header>
      <div className="explore-compare-grid">
        <FigureView figure={solve} />
        <FigureView figure={infra} />
      </div>
    </section>
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
