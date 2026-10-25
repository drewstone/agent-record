import { useEffect, useRef, useState } from 'react'
import { usePhone } from './use-phone.js'

/**
 * The play's distance to the paper, from the host's `gap` (tangle-tools play_page._play_gap; lead 2026-10-25 05:45Z):
 * the last check a release passed, every measured proving rate, and each prove that outlived the check's time cap,
 * which bounds the rate from above without measuring it. The chart is that, on a log scale, against the paper's band.
 */
export type PlayGapFacts = {
  metric: { label: string; unit: string; target?: { min: number; max: number } | null }
  source?: string | null
  passed: { checker: string; tag: string; run: string | null; lastAt?: string | null } | null
  checker: string | null
  measured: { tag: string; run: string | null; at: string | null; value: number; cycles: number | null }[]
  capMisses: { tag: string | null; runId: string | null; checker: string | null; at: string | null; count: number; cycles: number; capS: number; below: number }[]
  need: { cycles: number; capS: number; checker: string | null; count: number } | null
}

const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }
/** 1048576 → "2²⁰"; a count that is not a power of two stays a number. */
export const cyclesWord = (n: number) => (Number.isInteger(Math.log2(n)) ? `2${String(Math.log2(n)).replace(/\d/g, (d) => SUP[d]!)}` : n.toLocaleString())
const rate = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString())
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }) + 'Z' : '—')
const shortRun = (runId: string | null | undefined) => (runId ? runId.slice(-3) : '')

/**
 * The hero as the answer (review 2 #1: "1,436 cycles/s" alone needed domain knowledge): how fast it proves, how much
 * faster the check needs it, where the paper is, then what passed before the bar rose.
 */
export function gapHeadline(gap: PlayGapFacts) {
  const best = gap.measured.reduce<PlayGapFacts['measured'][number] | null>((a, b) => (!a || b.value > a.value ? b : a), null)
  const target = gap.metric.target
  const needRate = gap.need ? Math.round(gap.need.cycles / gap.need.capS) : null
  const hero = best ? `Proves at ${best.value.toLocaleString()} ${gap.metric.unit}.` : 'No proving rate measured yet.'
  const needs = needRate && best ? `The check needs ${needRate.toLocaleString()} (${(needRate / best.value).toFixed(1)}× faster)` : null
  const paper = target ? `the paper reaches ${rate(target.min)}–${rate(target.max)}` : null
  const verdict = [needs, paper].filter(Boolean).join('; ')
  const passed = gap.passed ? `Passed under check ${gap.passed.checker} (${gap.passed.tag}, run ${gap.passed.run}) before the bar rose` : 'No release has passed a check'
  const misses = gap.need ? `; since ${gap.need.checker}, ${gap.need.count} proves ran past the ${gap.need.capS} s cap.` : '.'
  return { best, target, hero, sentence: verdict ? `${verdict.charAt(0).toUpperCase()}${verdict.slice(1)}.` : '', history: passed + misses }
}

type Mark = { key: string; x: number; y: number; kind: 'measured' | 'bound'; title: string; pill: string; rows: [string, string][]; reason?: string }

export function GapChart({ gap, checkers, now }: { gap: PlayGapFacts; checkers: { label: string; firstAt: string }[]; now: number }) {
  const phone = usePhone()
  const [on, setOn] = useState<string | null>(null)
  // Drawn at the container's measured width so its 12 px labels stay 12 px (a fixed 1000-unit viewBox stretched to
  // 1,400 px drew them at 18 px; review 1 #6: one type scale).
  const box = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<number | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setMeasured(Math.round(entry!.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const target = gap.metric.target
  const times = [...gap.measured.map((m) => ms(m.at)), ...gap.capMisses.map((m) => ms(m.at)), ms(gap.passed?.lastAt)].filter(Number.isFinite)
  if (!times.length) return null
  const w = measured ?? (phone ? 380 : 1000), h = phone ? 260 : 300, left = phone ? 44 : 64, right = 16, top = 16, bottom = 28
  const t0 = Math.min(...times) - 3_600_000, t1 = Math.max(now, ...times)
  // Fitted to our own data, a decade either side (lead 07:12Z: with the paper's band on the axis all our points sat in
  // the bottom tenth and the chart read flat); the paper, thousands of times higher, is an off-scale arrow.
  const values = [...gap.measured.map((m) => m.value), ...gap.capMisses.map((m) => m.below)].filter((v) => v > 0)
  if (!values.length && target) values.push(target.min)
  const lo = Math.floor(Math.log10(Math.min(...values) / 2)), hi = Math.ceil(Math.log10(Math.max(...values) * 1.5))
  const best = gap.measured.reduce((a, b) => Math.max(a, b.value), 0)
  const offScale = target && target.min > 10 ** hi ? { ratio: best ? Math.round(target.min / best) : null } : null
  const ratio = (v: number) => (target && v > 0 ? `×${Math.round(target.min / v).toLocaleString()}` : '—')
  const x = (t: number) => left + ((t - t0) / Math.max(1, t1 - t0)) * (w - left - right)
  const y = (v: number) => top + (1 - (Math.log10(v) - lo) / (hi - lo)) * (h - top - bottom)
  const marks: Mark[] = [
    ...gap.measured.map((m): Mark => ({ key: `m-${m.tag}-${m.at}`, x: x(ms(m.at)), y: y(m.value), kind: 'measured', title: `${m.tag} · run ${m.run ?? ''}`, pill: 'measured',
      rows: [['Rate', `${m.value.toLocaleString()} ${gap.metric.unit}`], ['Program', m.cycles ? `${cyclesWord(m.cycles)} cycles` : '—'], ['Gap to paper', ratio(m.value)], ['When', when(m.at)]] })),
    ...gap.capMisses.map((m): Mark => ({ key: `b-${m.tag}-${m.at}`, x: x(ms(m.at)), y: y(m.below), kind: 'bound', title: `${m.tag ?? ''} · run ${shortRun(m.runId)}`, pill: 'ran past cap',
      rows: [['Rate', `below ${m.below.toLocaleString()} ${gap.metric.unit}`], ['Program', `${cyclesWord(m.cycles)} cycles`], ['Proves', String(m.count)], ['Gap to paper', `over ${ratio(m.below)}`], ['When', when(m.at)]],
      reason: `Every prove ran past the ${m.capS} s cap under ${m.checker ?? 'the check'}.` })),
  ]
  const picked = marks.find((m) => m.key === on) ?? null
  const ticks = Array.from({ length: hi - lo + 1 }, (_, i) => 10 ** (lo + i))
  const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const shown = checkers.filter((c) => ms(c.firstAt) > t0 && ms(c.firstAt) <= t1)
  // A tick at each UTC midnight, thinned to at most 7 so labels never touch.
  const allDays: number[] = []
  for (let t = Math.ceil(t0 / 86_400_000) * 86_400_000; t < t1 - 43_200_000; t += 86_400_000) allDays.push(t)
  const days = allDays.filter((_, i) => i % Math.ceil(allDays.length / (phone ? 3 : 7)) === 0)
  const lastMiss = marks.filter((m) => m.kind === 'bound').reduce<Mark | null>((a, b) => (!a || b.x > a.x ? b : a), null)
  return (
    <div className="pj-gap" ref={box}>
      <svg className="pj-gap-chart" viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`${gap.metric.label} per release on a log scale against the paper's ${target ? `${rate(target.min)}–${rate(target.max)}` : ''} ${gap.metric.unit}`} onMouseLeave={() => setOn(null)}>
        {ticks.map((v) => <g key={v} className="pj-grid"><line x1={left} x2={w - right} y1={y(v)} y2={y(v)} /><text x={left - 8} y={y(v) + 4} textAnchor="end">{rate(v)}</text></g>)}
        {target && offScale && <g className="pj-band pj-offscale"><text x={w - right - 6} y={top + 12} textAnchor="end">paper {rate(target.min)}–{rate(target.max)} ↑{offScale.ratio ? ` ×${offScale.ratio.toLocaleString()}` : ''}</text></g>}
        {target && !offScale && <g className="pj-band"><rect x={left} width={w - left - right} y={y(Math.min(target.max, 10 ** hi))} height={Math.max(2, y(target.min) - y(Math.min(target.max, 10 ** hi)))} /><text x={w - right - 6} y={y(target.max) + 14} textAnchor="end">paper {rate(target.min)}–{rate(target.max)}</text></g>}
        {gap.need && <g className="pj-need"><line x1={left} x2={w - right} y1={y(gap.need.cycles / gap.need.capS)} y2={y(gap.need.cycles / gap.need.capS)} /><text x={w - right - 6} y={y(gap.need.cycles / gap.need.capS) - 6} textAnchor="end">needed: {cyclesWord(gap.need.cycles)} cycles in {gap.need.capS} s</text></g>}
        {shown.map((c) => <g key={c.label} className="pj-check"><line x1={x(ms(c.firstAt))} x2={x(ms(c.firstAt))} y1={top} y2={h - bottom} /><text x={x(ms(c.firstAt)) + 4} y={top + 10}>{c.label}</text></g>)}
        {gap.passed?.lastAt && <g className="pj-pass"><line x1={x(ms(gap.passed.lastAt))} x2={x(ms(gap.passed.lastAt))} y1={top} y2={h - bottom} /><text x={x(ms(gap.passed.lastAt)) + 4} y={top + 26}>{gap.passed.tag} passed {gap.passed.checker}</text></g>}
        {marks.map((m) => (
          <g key={m.key} className={`pj-mark pj-${m.kind}${on === m.key ? ' is-on' : ''}`} tabIndex={0} role="button" aria-label={`${m.title}: ${m.rows.map(([k, v]) => `${k} ${v}`).join(', ')}`}
            onMouseEnter={() => setOn(m.key)} onFocus={() => setOn(m.key)} onBlur={() => setOn(null)} onClick={() => setOn(m.key)}>
            <circle className="pj-hit" cx={m.x} cy={m.y} r={16} />
            {m.kind === 'measured' ? <circle cx={m.x} cy={m.y} r={5} /> : <path d={`M${m.x - 5} ${m.y - 4} h10 l-5 8z`} />}
          </g>
        ))}
        {days.map((t, i) => <text key={t} className="pj-tick" x={x(t)} y={h - 8} textAnchor={i === 0 ? 'start' : 'middle'}>{day(t)}</text>)}
        <text className="pj-tick" x={x(t1)} y={h - 8} textAnchor="end">now</text>
        {gap.need && lastMiss && <text className="pj-count" x={lastMiss.x + 10} y={lastMiss.y - 8}>×{gap.need.count}</text>}
      </svg>
      {picked && (
        <div className="pj-tip" role="tooltip" style={{ left: `${(picked.x / w) * 100}%`, top: `${(picked.y / h) * 100}%` }}>
          <p className="pj-tip-title"><b>{picked.title}</b> <span className={`pj-pill pj-${picked.kind}`}>{picked.pill}</span></p>
          <dl>{picked.rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {picked.reason && <p className="pj-tip-reason">{picked.reason}</p>}
        </div>
      )}
    </div>
  )
}
