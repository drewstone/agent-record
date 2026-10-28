import type { TabProps } from './RunPage.js'
import { clause } from './Overview.js'
import { type CheckDoc, checkVerdict, count, plural, type RunRelease } from './model.js'
import { Bar, StateDot } from './ui.js'

type Row = { kind: 'release'; r: RunRelease } | { kind: 'unscored'; from: string; to: string; n: number }

/** Newest first; a run of releases the checker never scored reads as one line in reading order (`rc3–rc7`), not one "not scored" per tag. */
function ladder(releases: readonly RunRelease[]): Row[] {
  const out: Row[] = []
  for (const r of [...releases].reverse()) {
    const last = out[out.length - 1]
    if (r.total) out.push({ kind: 'release', r })
    else if (last?.kind === 'unscored') { last.to = r.release; last.n++ }
    else out.push({ kind: 'unscored', from: r.release, to: r.release, n: 1 })
  }
  return out
}

/** Was anything checked against the bar: one verdict, the facts behind it, and every release the checker scored. */
export function Checks({ m, doc }: TabProps) {
  const check = (doc.run as unknown as { check?: CheckDoc }).check
  const latest = check?.latest
  const verdict = checkVerdict(check)
  const checker = check?.checkerNames?.find((c) => c.current) ?? check?.checkerNames?.[0]
  const stages = check?.calibration?.stages ?? []
  const best = m.best
  const committers = m.tree.filter((a) => (a.commits ?? 0) > 0).sort((a, b) => (b.commits ?? 0) - (a.commits ?? 0))
  const maxCommits = Math.max(1, ...committers.map((a) => a.commits ?? 0))
  return (
    <div className="rp-ck">
      <section className="rp-card" aria-label="Checks">
        <div className="rp-ck-in">
          <h2 className="rp-ck-h"><StateDot tone={verdict.tone} />{verdict.word}</h2>
          {verdict.note && <p className="rp-ck-note">{verdict.note}.</p>}
          <div className="rp-ck-stats">
            <div><b>{count(check?.counts?.checks ?? 0)}</b><span>checks run, {count(check?.counts?.known ?? 0)} with a verdict</span></div>
            <div><b>{checker?.label ?? '—'}</b><span>{checker ? `checker, ${checker.ruling ?? 'as pressed'}` : 'no checker recorded'}</span></div>
            <div><b>{best ? `${best.release}${best.total ? ` · ${best.passed ?? 0}/${best.total}` : ''}` : 'None'}</b><span>{m.releases.length ? `best of ${plural(m.releases.length, 'release')}` : 'no release tagged'}</span></div>
          </div>
          {latest?.line && (
            <p className="rp-ck-line"><span className="lbl">Latest</span><span>{clause(latest.line, 28)}</span><time>{latest.at ? `${latest.at.slice(5, 10)} ${latest.at.slice(11, 16)} UTC` : ''}{latest.tag ? ` · ${latest.tag}` : ''}</time></p>
          )}
          {stages.some((s) => s.state !== 'calibrated') && (
            // In words, not ✓ and ○ glyphs nobody had a key for (judges 10-27).
            <p className="rp-ck-line"><span className="lbl">Calibration</span>
              <span>{plural(stages.filter((s) => s.state === 'calibrated').length, 'stage')} of {stages.length} calibrated{stages.some((s) => s.state === 'calibrated') ? ` (${stages.filter((s) => s.state === 'calibrated').map((s) => s.name).join(', ')})` : ''}; not yet: {stages.filter((s) => s.state !== 'calibrated').map((s) => s.name).join(', ')}</span>
            </p>
          )}
          {m.releases.length > 0 && (
            <>
              <h3 className="rp-subh">Releases</h3>
              <ol className="rp-rel">
                {ladder(m.releases).map((row) => row.kind === 'unscored' ? (
                  <li key={row.from} className="gap"><b>{row.n > 1 ? `${row.to}–${row.from}` : row.from}</b><span className="sub">{row.n > 1 ? `${row.n} releases, not scored` : 'not scored'}</span></li>
                ) : (
                  <li key={row.r.release}>
                    <b>{row.r.release}</b>
                    <span className="score">{row.r.passed ?? 0}/{row.r.total}</span>
                    <span className="steps">{(row.r.steps ?? []).map((s, i) => <i key={i} className={s.state} title={`${s.label}: ${s.state}`} />)}</span>
                    <span className="when">{row.r.taggedAt ? `${row.r.taggedAt.slice(5, 10)} ${row.r.taggedAt.slice(11, 16)}` : '—'}</span>
                    {row.r.sentence && <span className="sub">{clause(row.r.sentence, 20)}</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </section>
      <section className="rp-card" aria-label="Commits by agent">
        <div className="rp-hd sm"><h2>Commits by agent<span className="ct">{count(committers.reduce((t, a) => t + (a.commits ?? 0), 0))}</span></h2></div>
        <div className="rp-commits">
          {committers.length ? committers.map((a) => (
            <div key={a.id} className="row"><span className="l" title={a.name}>{a.name}</span><Bar ok={a.commits ?? 0} max={maxCommits} /><span className="n">{a.commits}</span></div>
          )) : <p className="ws-status">No agent's commits reached the run's deliverables.</p>}
        </div>
      </section>
    </div>
  )
}
