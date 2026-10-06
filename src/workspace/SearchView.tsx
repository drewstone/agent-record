import { useMemo, useState } from 'react'
import type { ProfileGraphDocument } from '../workspace.js'
import { duration, money, when } from './data.js'
import { ProfileDiffView } from './ProfileVersions.js'
import { blameOf, replayAt, searchesOf, signed, type SearchModel, type SearchVersion } from './search.js'

const STATUS_TONE: Record<string, string> = { selected: 'state-ok', finalist: 'state-run', rejected: 'state-unknown', invalid: 'state-fail', pending: 'state-unknown' }
const ms = (value: string | null | undefined) => (value ? Date.parse(value) : NaN)

/**
 * Every optimizer search the selected version ran: the claim it made, the best version per dollar as the search went,
 * a replay over its clock, every version it proposed as a tree with the paired effect on its parent, and the selected
 * version's reason, scores, decision, diff from its parent and prompt blame.
 */
export function Searches({ graph, runId }: { graph: ProfileGraphDocument | null; runId: string | null }) {
  const models = useMemo(() => searchesOf(graph, runId), [graph, runId])
  if (!models.length) return null
  return (
    <>
      {models.map((model) => (
        <SearchView key={model.searchId} graph={graph!} model={model} />
      ))}
    </>
  )
}

function SearchView({ graph, model }: { graph: ProfileGraphDocument; model: SearchModel }) {
  const opened = ms(model.openedAt)
  const closed = ms(model.closedAt) || Math.max(...model.versions.map((version) => ms(version.at)).filter(Number.isFinite), opened)
  const [clock, setClock] = useState<number | null>(null)
  const shown = replayAt(model, clock)
  const selected = model.claim?.selected ?? null
  const [focus, setFocus] = useState<string | null>(selected ?? model.versions[0]?.digest ?? null)
  const version = model.versions.find((item) => item.digest === focus) ?? null
  const visible = new Set(shown.versions.map((item) => item.digest))
  const totalUsd = model.curve.at(-1)?.usd ?? null
  const unknownCost = model.curve.at(-1)?.unknownCost ?? 0
  const finalist = model.claim?.finalists?.find((item) => item.digest === selected) ?? null
  const reach = Math.max(0.05, ...model.versions.flatMap((item) => (item.effect ? [Math.abs(item.effect.low ?? item.effect.delta), Math.abs(item.effect.high ?? item.effect.delta)] : [])))
  const span = Math.ceil(reach * 20) / 20
  return (
    <section className="search-view ws-section" data-search={model.searchId} aria-label="Optimizer search">
      <header className="search-head">
        <h2>Optimizer search</h2>
        <span className="chip">{model.kind ?? 'search'}</span>
        <span className="faint">
          {model.versions.length} versions · {Number.isFinite(opened) && Number.isFinite(closed) ? duration(closed - opened) : 'duration unknown'} · ranked by{' '}
          {model.ranking ?? 'unknown'} · {money(totalUsd)} evaluated{unknownCost ? `, ${unknownCost} cells' cost unknown` : ''}
          {model.closeReason ? ` · closed: ${model.closeReason.replaceAll('-', ' ')}` : model.closedAt ? '' : ' · open'}
        </span>
      </header>
      {model.claim && (
        <p className={`search-claim ${model.claim.decision === 'ship' ? 'ship' : ''}`} data-search-claim={model.claim.decision}>
          <b>{model.claim.decision === 'ship' ? 'Shipped' : `Claim: ${model.claim.decision}`}</b>
          {selected ? ` ${model.versions.find((item) => item.digest === selected)?.label ?? selected.slice(7, 19)}` : ''}
          {finalist?.test ? (
            <>
              {' '}— beat the root on {finalist.test.pairs} held-out test units: <b>{signed(finalist.test.delta)}</b> [{signed(finalist.test.low)}, {signed(finalist.test.high)}]
            </>
          ) : null}
          {model.claim.reason ? <span className="faint"> · {model.claim.reason}</span> : null}
        </p>
      )}
      <div className="search-top">
        <BestPerDollar model={model} shown={shown.curve} />
        <div className="search-replay">
          <label htmlFor={`replay-${model.searchId}`} className="answer-label">Replay the search</label>
          <input
            id={`replay-${model.searchId}`}
            type="range"
            min={Number.isFinite(opened) ? opened : 0}
            max={Number.isFinite(closed) ? closed : 1}
            step={1000}
            value={clock ?? (Number.isFinite(closed) ? closed : 1)}
            onChange={(event) => {
              const value = Number(event.target.value)
              setClock(value >= closed ? null : value)
            }}
          />
          <span className="faint">
            {clock === null ? 'the whole search' : `${new Date(clock).toISOString().slice(11, 19)} UTC`} · {shown.versions.length} of {model.versions.length} versions
          </span>
        </div>
      </div>
      <div className="search-layout">
        <div className="search-table" role="table" aria-label="Versions the search proposed">
          <div className="search-row search-row-head" role="row">
            <span role="columnheader">Version · what the optimizer changed</span>
            <span role="columnheader">Decision</span>
            <span role="columnheader" className="num">Selection</span>
            <span role="columnheader">Effect on its parent</span>
            <span role="columnheader" className="num">Cost</span>
          </div>
          {model.versions.map((item) => (
            <VersionRow key={item.digest} version={item} span={span} on={item.digest === focus} hidden={!visible.has(item.digest)} onSelect={() => setFocus(item.digest)} />
          ))}
          <p className="faint search-note">
            Effect: the paired difference from the version's parent on the search's split, with its interval; green when the interval is above zero,
            red when below. Selection: the mean score on the selection units. Cost: the proposal and its evaluation; + when a part is unknown.
          </p>
        </div>
        <aside className="search-inspector" aria-label="Version">
          {version ? <VersionDetail graph={graph} model={model} version={version} onSelect={setFocus} /> : <p className="faint">Select a version.</p>}
        </aside>
      </div>
    </section>
  )
}

function EffectBar({ low, high, delta, span }: { low: number | null; high: number | null; delta: number; span: number }) {
  const x = (value: number) => `${((Math.max(-span, Math.min(span, value)) + span) / (2 * span)) * 100}%`
  const lo = low ?? delta
  const hi = high ?? delta
  const tone = lo > 0 ? 'up' : hi < 0 ? 'down' : 'flat'
  return (
    <span className={`effect-bar ${tone}`} aria-hidden="true">
      <span className="effect-zero" style={{ left: x(0) }} />
      <span className="effect-interval" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
      <span className="effect-point" style={{ left: x(delta) }} />
    </span>
  )
}

function VersionRow({ version, span, on, hidden, onSelect }: { version: SearchVersion; span: number; on: boolean; hidden: boolean; onSelect: () => void }) {
  const effect = version.effect
  return (
    <button
      type="button"
      role="row"
      className={`search-row ${on ? 'on' : ''} ${hidden ? 'later' : ''}`}
      aria-pressed={on}
      data-search-version={version.short}
      onClick={onSelect}
      title={version.reason ?? undefined}
    >
      <span role="cell" className="search-label" style={{ paddingLeft: `${version.depth * 20}px` }}>
        {version.root ? <span className="chip">root</span> : version.operator ? <span className="chip">{version.operator}</span> : null}
        <span className="clip">{version.root ? 'the registered profile' : version.label}</span>
      </span>
      <span role="cell">
        <span className={`state-pill ${STATUS_TONE[version.status] ?? 'state-unknown'}`}>{version.status}</span>
      </span>
      <span role="cell" className="num">{version.scores.selection ? version.scores.selection.mean.toFixed(3) : '—'}</span>
      <span role="cell" className="search-effect">
        {effect ? (
          <>
            <EffectBar low={effect.low} high={effect.high} delta={effect.delta} span={span} />
            <span className="num">{signed(effect.delta)}</span>
          </>
        ) : (
          <span className="faint search-effect-note">{version.root ? 'the baseline' : 'not measured'}</span>
        )}
      </span>
      <span role="cell" className="num" title={`proposal ${money(version.proposalUsd)} · evaluation ${money(version.evaluationUsd)}`}>
        {version.proposalUsd === null && version.evaluationUsd === null ? 'unknown' : money((version.proposalUsd ?? 0) + (version.evaluationUsd ?? 0))}
        {version.proposalUsd === null && version.evaluationUsd !== null ? '+' : ''}
      </span>
    </button>
  )
}

function VersionDetail({ graph, model, version, onSelect }: { graph: ProfileGraphDocument; model: SearchModel; version: SearchVersion; onSelect: (digest: string) => void }) {
  const diff = version.parent ? graph.diffs[`${version.parent}..${version.digest}`] : undefined
  const blame = blameOf(graph, model, version.digest)
  const parent = version.parent ? model.versions.find((item) => item.digest === version.parent) : null
  const [allBlame, setAllBlame] = useState(false)
  return (
    <div className="inspector" data-search-detail={version.short}>
      <header className="inspector-head">
        <h2>{version.root ? 'The registered profile' : version.label}</h2>
        <span className={`state-pill ${STATUS_TONE[version.status] ?? 'state-unknown'}`}>{version.status}</span>
        <code className="faint">{version.short}</code>
      </header>
      <p className="faint">
        {version.operator ? `${version.operator} · ` : ''}registered {when(version.at)}
        {parent ? (
          <>
            {' '}· from{' '}
            <button type="button" className="link-button" onClick={() => onSelect(parent.digest)}>{parent.root ? 'the registered profile' : parent.label}</button>
          </>
        ) : null}
      </p>
      {version.reason && (
        <section>
          <h3>Why the optimizer made it</h3>
          <blockquote className="search-reason">{version.reason}</blockquote>
        </section>
      )}
      <section>
        <h3>Measured</h3>
        <table className="data-table search-scores">
          <tbody>
            {(['train', 'selection', 'test'] as const).map((name) => (
              <tr key={name}>
                <th>{name}</th>
                <td className="num">{version.scores[name] ? version.scores[name]!.mean.toFixed(3) : '—'}</td>
                <td className="faint">{version.scores[name] ? `${version.scores[name]!.units} units` : 'not scored'}</td>
              </tr>
            ))}
            {version.effect && (
              <tr>
                <th>effect on its parent</th>
                <td className="num">{signed(version.effect.delta)}</td>
                <td className="faint">
                  [{signed(version.effect.low)}, {signed(version.effect.high)}] on {version.effect.pairs} {version.effect.split} pairs
                  {version.effect.method ? `, ${version.effect.method}` : ''}
                  {version.effect.confidence ? ` at ${version.effect.confidence}` : ''}
                </td>
              </tr>
            )}
            {version.vsRoot && !version.root && (
              <tr>
                <th>against the root</th>
                <td className="num">{signed(version.vsRoot.delta)}</td>
                <td className="faint">
                  [{signed(version.vsRoot.low)}, {signed(version.vsRoot.high)}] on {version.vsRoot.pairs} {version.vsRoot.split} pairs
                  {version.vsRoot.method ? `, ${version.vsRoot.method}` : ''}
                </td>
              </tr>
            )}
            <tr>
              <th>cost</th>
              <td className="num">{money((version.proposalUsd ?? 0) + (version.evaluationUsd ?? 0))}</td>
              <td className="faint">proposal {money(version.proposalUsd)} · evaluation {money(version.evaluationUsd)}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section>
        <h3>Decision</h3>
        <p>
          <b>{version.status}</b> {version.statusReason ? <span className="faint">{version.statusReason}</span> : null}
        </p>
      </section>
      <section>
        <h3>{parent ? 'What changed from its parent' : 'Its content'}</h3>
        {diff ? <ProfileDiffView diff={diff} /> : <p className="faint">{parent ? 'The index holds no diff for this edge.' : 'The baseline every version descends from.'}</p>}
      </section>
      {blame && (
        <section>
          <h3>Blame: which version wrote each line</h3>
          <ul className="search-blame" data-blame-rows={blame.rows.length}>
            {(allBlame ? blame.rows : blame.rows.filter((row) => row.text.trim()).slice(0, 14)).map((row, i) => (
              <li key={i} className={row.own ? 'own' : ''}>
                <button type="button" className="link-button blame-by" onClick={() => row.introducedBy && onSelect(row.introducedBy)} title={row.introducedBy ?? undefined}>
                  {row.label}
                </button>
                <span className="blame-text">{row.text || ' '}</span>
              </li>
            ))}
          </ul>
          {blame.rows.length > 14 && (
            <button type="button" className="ui-button" aria-expanded={allBlame} onClick={() => setAllBlame(!allBlame)}>
              {allBlame ? 'Show fewer lines' : `Show all ${blame.rows.length} lines`}
            </button>
          )}
          {blame.complete === false && <p className="faint">The blame is incomplete: an ancestor's content is missing from the index.</p>}
        </section>
      )}
    </div>
  )
}

/** The best version's score against cumulative evaluation spend: what each dollar of the search bought. */
function BestPerDollar({ model, shown }: { model: SearchModel; shown: SearchModel['curve'] }) {
  const all = model.curve.filter((point) => point.score !== null)
  if (!all.length) return <p className="faint">The search recorded no best-version curve.</p>
  const width = 560
  const height = 190
  const pad = { left: 52, right: 16, top: 14, bottom: 42 }
  const maxUsd = Math.max(...all.map((point) => point.usd), 0.01)
  const scores = all.map((point) => point.score!)
  const lo = Math.max(0, Math.floor((Math.min(...scores) - 0.02) * 20) / 20)
  const hi = Math.min(1, Math.ceil((Math.max(...scores) + 0.02) * 20) / 20)
  const x = (usd: number) => pad.left + (usd / maxUsd) * (width - pad.left - pad.right)
  const y = (score: number) => pad.top + (1 - (score - lo) / (hi - lo || 1)) * (height - pad.top - pad.bottom)
  const points = shown.filter((point) => point.score !== null)
  let path = ''
  points.forEach((point, i) => {
    path += i === 0 ? `M${x(point.usd)},${y(point.score!)}` : `H${x(point.usd)}V${y(point.score!)}`
  })
  const last = points.at(-1)
  const ticksY = [lo, (lo + hi) / 2, hi]
  const ticksX = [0, maxUsd / 2, maxUsd]
  return (
    <figure className="search-curve" data-curve-points={points.length}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Best selection score against evaluation spend: ${last ? `${last.score!.toFixed(3)} at ${money(last.usd)}` : 'nothing yet'}`}>
        {ticksY.map((tick) => (
          <g key={`y${tick}`}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end">{tick.toFixed(2)}</text>
          </g>
        ))}
        {ticksX.map((tick, i) => (
          <text key={`x${tick}`} x={x(tick)} y={height - pad.bottom + 26} textAnchor={i === 0 ? 'start' : i === ticksX.length - 1 ? 'end' : 'middle'}>{money(tick)}</text>
        ))}
        <path d={path} className="line" />
        {points.map((point, i) => (
          <circle key={i} cx={x(point.usd)} cy={y(point.score!)} r={i === points.length - 1 ? 5 : 3.5} className={i === points.length - 1 ? 'end' : 'dot'}>
            <title>{`${point.score!.toFixed(3)} after ${point.versions} versions, ${money(point.usd)}`}</title>
          </circle>
        ))}
        {last && (
          <text x={Math.min(x(last.usd), width - pad.right) - 4} y={y(last.score!) - 9} textAnchor="end" className="end-label">
            {last.score!.toFixed(3)} · {last.versions} versions
          </text>
        )}
      </svg>
      <figcaption className="faint">Best selection score so far against the search's evaluation spend.</figcaption>
    </figure>
  )
}
