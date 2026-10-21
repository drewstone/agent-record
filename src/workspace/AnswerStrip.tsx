import { useState, type ReactNode } from 'react'
import { Spark } from '@tangle-network/charts/react'
import type { Answer, Figure } from './answers.js'
import { StatusPill } from './data.js'

/** One answer tile and the detail its drawer holds. */
export type Tile = Answer & { drawer: ReactNode }

function TileFigure({ figure }: { figure: Figure }) {
  if (figure.kind === 'spark')
    return (
      <span className="answer-spark" data-spark title={figure.tip} role="img" aria-label={figure.tip}>
        <Spark points={figure.points} max={Math.max(1, ...figure.points.map(([, y]) => y))} />
        <b>{figure.label}</b>
      </span>
    )
  return (
    <span className="answer-figure">
      <span className="answer-num" data-num title={figure.tip}>
        {figure.value}
        {figure.small && <small>{figure.small}</small>}
      </span>
      {figure.unit && <span className="answer-unit">{figure.unit}</span>}
    </span>
  )
}

/**
 * A decision page's answers (design-system section 6, wall redesign v2): one tile per question, each a label, a headline,
 * one figure, a sub-line and a button for its drawer. Drawers start closed and one is open at a time; a closed drawer
 * stays in the markup, so its detail is searchable and printable.
 */
export function AnswerStrip({ id, tiles }: { id: string; tiles: Tile[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="answer-strip-wrap">
      <div className="answer-strip" data-answers style={{ ['--n' as string]: tiles.length }}>
        {tiles.map((tile) => {
          const drawer = `${id}-${tile.slot}`
          const expanded = open === tile.slot
          return (
            <div key={tile.slot} className="answer-tile" data-answer={tile.slot} data-open={expanded}>
              <span className="answer-label">
                {tile.href ? <a href={tile.href}>{tile.label}</a> : tile.label}
                {tile.status && <StatusPill status={tile.status} className="answer-mark" />}
              </span>
              <span className="answer-headline" data-headline>{tile.headline}</span>
              <TileFigure figure={tile.figure} />
              <span className="answer-subline" data-subline>{tile.subline}</span>
              <button type="button" className="answer-more" aria-controls={drawer} aria-expanded={expanded} aria-label={`Details: ${tile.label}`} onClick={() => setOpen(expanded ? null : tile.slot)}>
                <span aria-hidden="true">⌄</span>
              </button>
            </div>
          )
        })}
      </div>
      {tiles.map((tile) => (
        <section key={tile.slot} className="answer-drawer" id={`${id}-${tile.slot}`} hidden={open !== tile.slot} aria-label={`${tile.label} details`}>
          {tile.drawer}
        </section>
      ))}
    </div>
  )
}

/** The page's one as-of statement: the time on screen, the date, its meaning and its source in the tip. */
export function AsOf({ at, source, meaning = 'when the host composed this page; every number above the fold is as of then' }: { at: string | null | undefined; source: string; meaning?: string }) {
  if (!at || !Number.isFinite(Date.parse(at))) return null
  const iso = new Date(at).toISOString()
  return (
    <span className="asof" data-asof title={`${iso.slice(0, 10)} ${iso.slice(11, 16)}Z · ${meaning} · ${source}`} tabIndex={0}>
      as of {iso.slice(11, 16)}Z
    </span>
  )
}
