import { useId, useState, type ReactNode } from 'react'
import { Spark } from '@tangle-network/charts/react'
import { type Answer, type AsOf, asOfTip, clampWords, HEADLINE_WORDS, hm, type Slot, SUBLINE_WORDS } from './answers.js'
import { StatusPill } from './data.js'

/** The page's one as-of statement: the time on screen; its date, meaning and source in the tip. */
export function AsOfStamp({ asOf }: { asOf: AsOf | null }) {
  if (!asOf) return null
  // Data over 15 minutes old says its age (REVIEW-5 #8: /today read "as of 13:10Z" at 13:56Z beside fresher pages).
  const age = Math.round((Date.now() - Date.parse(asOf.at)) / 60_000)
  const stale = Number.isFinite(age) && age > 15
  return (
    <span className={`as-of${stale ? ' is-stale' : ''}`} data-asof title={asOfTip(asOf)}>
      as of {hm(asOf.at)}{stale ? ` · ${age < 120 ? `${age} min` : `${Math.round(age / 60)} h`} old` : ''}
    </span>
  )
}

/**
 * A hover and focus tooltip as an element, for marks a title attribute cannot serve: touch has no hover and a title
 * never appears in the page (REVIEW-5 #13: the /today sparkline and ladder and the /plays status read as tipless).
 */
export function Tip({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className={`ar-tip-anchor${className ? ` ${className}` : ''}`} tabIndex={0} aria-label={text}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children}
      {open && <span className="ar-tip" role="tooltip">{text}</span>}
    </span>
  )
}

/**
 * A decision page's answers as tiles (design-system section 3): each a label, a headline of at most 8 words, exactly one
 * figure (a number with its unit, or a Spark), a sub-line of at most 12 words, and a button for its drawer. Drawers start
 * closed and only one is open at a time. `extras` adds a component to a slot's drawer.
 */
export function AnswerStrip({ answers, label, extras = {} }: { answers: Answer[]; label: string; extras?: Partial<Record<Slot, ReactNode>> }) {
  const [open, setOpen] = useState<Slot | null>(null)
  const base = useId().replace(/:/g, '')
  const drawer = (slot: Slot) => `${base}-${slot}`
  return (
    <section className="answer-strip" aria-label={label} style={{ ['--n' as string]: answers.length }}>
      <div className="answer-tiles">
        {answers.map((answer) => (
          <div key={answer.slot} className="answer-tile" data-answer={answer.slot} data-open={open === answer.slot ? 'true' : undefined}>
            <span className="answer-tile-label">{answer.label}</span>
            <b className="answer-tile-head" data-headline>{clampWords(answer.headline, HEADLINE_WORDS)}</b>
            <span className="answer-tile-figure" title={answer.figure.tip}>
              {answer.figure.kind === 'num' ? (
                <span data-num>
                  <b>{answer.figure.value}</b>
                  {answer.figure.unit && <small> {answer.figure.unit}</small>}
                </span>
              ) : (
                <span data-spark aria-label={answer.figure.label}>
                  <Spark points={answer.figure.points} />
                  <small> {answer.figure.label}</small>
                </span>
              )}
            </span>
            <span className="answer-tile-sub" data-subline>{clampWords(answer.subline, SUBLINE_WORDS)}</span>
            <button type="button" className="answer-tile-more" aria-expanded={open === answer.slot} aria-controls={drawer(answer.slot)} aria-label={`${answer.label}: details`} onClick={() => setOpen(open === answer.slot ? null : answer.slot)}>
              <span aria-hidden="true">▾</span>
            </button>
          </div>
        ))}
      </div>
      {answers.map((answer) => (
        <div key={answer.slot} id={drawer(answer.slot)} className="answer-drawer" data-drawer-for={answer.slot} hidden={open !== answer.slot}>
          <dl>
            {answer.rows.map((row, i) => (
              <div key={`${row.term}-${i}`}>
                <dt>{row.status && <StatusPill status={row.status}>{row.pill}</StatusPill>} {row.term}</dt>
                <dd>{row.href ? <a href={row.href}>{row.text}</a> : row.text}</dd>
              </div>
            ))}
          </dl>
          {extras[answer.slot]}
        </div>
      ))}
    </section>
  )
}
