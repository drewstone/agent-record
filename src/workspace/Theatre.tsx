import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useDocument, when } from './data.js'
import { apiCost, billedCost, day, dotLabel, headlineBest, panelModel, playNames } from './theatre.js'
import type { Column, Dot, Panel, RoundKind, TheatreAct, TheatreBarView, TheatreViewsDocument } from './theatre.js'

const CHIP: Record<TheatreAct['result']['status'], string> = {
  'new-best': 'Step up',
  'no-gain': 'No gain',
  invalid: 'Broke a rule',
  unread: 'Not read yet',
  live: 'Running',
  'not-on-bar': 'Earlier bar',
}

/** The width of an element, followed as it resizes: the staircase is drawn in the pixels it has. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(960)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setWidth(Math.max(300, Math.floor(element.getBoundingClientRect().width)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function Mark({ dot, names }: { dot: Dot; names: Map<string, string> }) {
  const title = <title>{dotLabel(dot, names)}</title>
  const at = `translate(${dot.x.toFixed(1)} ${dot.y.toFixed(1)})`
  if (dot.kind === 'unread') return <g transform={at} className="th-dot th-unread">{title}<rect x={-1} y={-9} width={2} height={9} /></g>
  if (dot.kind === 'invalid') return <g transform={at} className="th-dot th-invalid">{title}<path d="M-3.6 -3.6 L3.6 3.6 M3.6 -3.6 L-3.6 3.6" /></g>
  const radius: Record<Exclude<RoundKind, 'invalid' | 'unread'>, number> = { selected: 4.6, rejected: 3.4, inside: 3.4, earlier: 3.4 }
  return (
    <g transform={at} className={`th-dot th-${dot.kind}${dot.best ? ' th-best-dot' : ''}`}>
      {title}
      {dot.best && <circle r={10} className="th-halo" />}
      <circle r={dot.best ? 6.4 : radius[dot.kind]} />
    </g>
  )
}

function Staircase({ panel, names }: { panel: Panel; names: Map<string, string> }) {
  const { plot, columns, ticks } = panel
  const label = panel.bestText ? `Staircase of ${panel.title}. Best round ${panel.bestText} checks.` : `Staircase of ${panel.title}. No round has a complete reading yet.`
  const right = panel.width - plot.right
  const bestRight = panel.best !== null && panel.best.x > panel.width * 0.55
  return (
    <svg className="th-svg" viewBox={`0 0 ${panel.width} ${panel.height}`} width={panel.width} height={panel.height} role="img" aria-label={label}>
      {columns.map((column, i) => (
        <g key={column.act ?? 'none'}>
          <rect className={`th-band${i % 2 === 1 ? ' odd' : ''}`} x={column.x0} y={plot.top - 16} width={column.x1 - column.x0} height={plot.bottom - plot.top + 16} />
          <text className="th-act-label" x={(column.x0 + column.x1) / 2} y={plot.bottom + 17} textAnchor="middle">{column.act === null ? 'No act' : `Act ${column.act}`}</text>
          <text className="th-act-date" x={(column.x0 + column.x1) / 2} y={plot.bottom + 31} textAnchor="middle">{column.card ? day(column.card.decided) : ''}</text>
        </g>
      ))}
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line className="th-grid" x1={plot.left} x2={right} y1={tick.y} y2={tick.y} />
          <text className="th-tick" x={plot.left - 8} y={tick.y + 4} textAnchor="end">{tick.value}</text>
        </g>
      ))}
      {panel.width >= 560 && <text className="th-axis" x={plot.left} y={plot.top - 20} textAnchor="start">checks passed of {panel.max}</text>}
      {panel.edges.map((edge) => <path key={edge.to} className="th-edge" d={edge.path}><title>{`forked from ${edge.from}`}</title></path>)}
      {panel.line && <path className="th-line" d={panel.line} />}
      {panel.dots.filter((dot) => !dot.best).map((dot) => <Mark key={dot.key} dot={dot} names={names} />)}
      {panel.best && <Mark dot={panel.best} names={names} />}
      {panel.best && panel.bestText && (
        <text className="th-best-label" x={panel.best.x + (bestRight ? -14 : 14)} y={panel.best.y - 12} textAnchor={bestRight ? 'end' : 'start'}>{panel.bestText}</text>
      )}
      {panel.best === null && panel.unreadCount > 0 && columns.length > 0 && (
        <text className="th-empty" x={(columns[columns.length - 1]!.x0 + columns[columns.length - 1]!.x1) / 2} y={plot.bottom - 20} textAnchor="middle">
          {panel.unreadCount === 1 ? '1 round tagged, no reading yet' : `${panel.unreadCount} rounds tagged, no reading yet`}
        </text>
      )}
    </svg>
  )
}

function ActCard({ act }: { act: TheatreAct }) {
  return (
    <article className={`th-act status-${act.result.status}`}>
      <h3>Act {act.act}<span>{day(act.decided)}{act.proposer === 'reflector' ? ' · reflector' : ''}</span></h3>
      <p className="th-change">{act.change}</p>
      <p className="th-result"><b className="th-chip">{CHIP[act.result.status]}</b> {act.result.text}</p>
      <dl className="th-cost">
        <div><dt>API-equivalent</dt><dd>{apiCost(act.spend)}</dd></div>
        <div><dt>Billed</dt><dd>{billedCost(act.spend)}</dd></div>
      </dl>
    </article>
  )
}

function Cards({ columns, panel }: { columns: Column[]; panel: Panel }) {
  const style = { '--th-cols': Math.max(1, columns.length), '--th-left': `${panel.plot.left}px`, '--th-right': `${panel.plot.right}px` } as CSSProperties
  return (
    <div className="th-cards" style={style}>
      {columns.map((column) => (column.card ? <ActCard key={column.act} act={column.card} /> : <div key="none" className="th-act th-loose">Rounds of plays that no act holds yet.</div>))}
    </div>
  )
}

function BarPanel({ view, index }: { view: TheatreBarView; index: number }) {
  const [ref, width] = useWidth()
  const panel = panelModel(view, index, { width, height: width < 560 ? 300 : 330 })
  const names = playNames([...view.rounds.map((round) => round.play), ...view.offBar.map((item) => item.owner)])
  const live = view.headline.plays.live.length
  return (
    <section className="th-panel" aria-label={panel.title}>
      <header className="th-panel-head">
        <h2>{panel.title}</h2>
        <p className="th-sub">{view.bar.checkCount} pass-or-fail checks{panel.span ? ` · ${panel.span}` : ''}{live > 0 ? ` · ${live} ${live === 1 ? 'play' : 'plays'} running` : ''}</p>
        <p className="th-panel-best">{panel.bestText ? <>Best round here: <b>{panel.bestText} checks</b></> : <>No round has a complete reading yet</>}</p>
      </header>
      <div ref={ref} className="th-figure">
        <Staircase panel={panel} names={names} />
        <Cards columns={panel.columns} panel={panel} />
      </div>
      <p className="th-key" aria-hidden="true">
        <span><i className="k-selected" />accepted step up</span><span><i className="k-rejected" />rejected</span><span><i className="k-invalid">×</i>broke a rule</span>
        <span><i className="k-earlier" />earlier act, read on this bar</span><span><i className="k-tick" />tagged, no complete reading</span><span><i className="k-line" />best so far</span><span><i className="k-edge" />forked from</span>
      </p>
    </section>
  )
}

function Banner({ views, name }: { views: TheatreBarView[]; name: string }) {
  const best = headlineBest(views)
  const first = views[0]
  const last = views[views.length - 1]
  if (!first || !last) return null
  return (
    <section className="th-banner" aria-label="Best round so far">
      <p className="th-goal"><b>{name} theatre</b>{last.goal}</p>
      {best ? (
        <>
          <p className="th-best"><span>Best round so far</span><b>{best.play} {best.tag}</b><em>{best.passed === null ? '' : `${best.passed} of ${best.total} checks`} · bar {best.bar}</em></p>
          {best.newer.length > 0 && <p className="th-newer">{best.newer.map((item) => `Bar ${item.bar}${item.live > 0 ? ` has ${item.live} ${item.live === 1 ? 'play' : 'plays'} running and` : ''} has no round with a reading yet`).join('; ')}.</p>}
        </>
      ) : <p className="th-best"><span>Best round so far</span><b>none read yet</b></p>}
      <p className="th-meta">As of {when(last.asOf)} · the next act is proposed by the {last.bar.policy}</p>
    </section>
  )
}

function TheatreView({ api, id }: { api: string; id: string }) {
  const { data, error, loading } = useDocument<TheatreViewsDocument>(`${api}/theatres/${encodeURIComponent(id)}`, 60_000)
  if (error) return <p className="ws-status" role="alert">{error}</p>
  if (loading || !data) return <p className="ws-status" role="status">Loading…</p>
  const last = data.bars[data.bars.length - 1]
  const test = last ? (typeof last.bar.test === 'string' ? last.bar.test : last.bar.test.state) : ''
  return (
    <div className="ws-page th-page">
      <Banner views={data.bars} name={id.replaceAll('-', ' ')} />
      {data.bars.map((view, i) => <BarPanel key={view.bar.digest} view={view} index={i} />)}
      {test && <p className="th-foot">Sealed test: {test}</p>}
    </div>
  )
}

function TheatreList({ api }: { api: string }) {
  const { data, error, loading } = useDocument<{ theatres: Record<string, { goal: string; best: { play: string; tag: string } | null }> }>(`${api}/theatres`)
  if (error) return <p className="ws-status" role="alert">{error}</p>
  if (loading || !data) return <p className="ws-status" role="status">Loading…</p>
  return (
    <div className="ws-page th-page">
      <header className="ws-head"><div className="ws-kicker">Research</div><h1>Theatres</h1></header>
      <ul className="th-list">
        {Object.entries(data.theatres).map(([id, row]) => (
          <li key={id}><a href={`/theatre/${encodeURIComponent(id)}`}>{id}</a><span>{row.goal}</span><span>{row.best ? `best ${row.best.play} ${row.best.tag}` : 'no round read yet'}</span></li>
        ))}
      </ul>
    </div>
  )
}

/** The `/theatre/<id>` page: a theatre's hill-climb, one panel per bar. With no id, the list of theatres. */
export function TheatrePage({ api, id }: { api: string; id: string }) {
  return id ? <TheatreView api={api} id={id} /> : <TheatreList api={api} />
}
