import type { TabProps } from './RunPage.js'
import { clause } from './Overview.js'
import { count } from './model.js'
import { Bar, StateDot } from './ui.js'

type Check = {
  latest?: { at?: string | null; line?: string | null; verdict?: string | null; known?: boolean; solved?: boolean; tag?: string | null } | null
  counts?: { checks?: number; known?: number; solved?: number }
  checkerNames?: { label: string; ruling?: string | null; current?: boolean }[]
  calibration?: { state?: string; stages?: { name: string; state: string }[] } | null
}

/** Was anything checked against the bar: the checker's verdicts, every release it scored, and the commits behind them. */
export function Checks({ m, doc }: TabProps) {
  const check = (doc.run as unknown as { check?: Check }).check
  const latest = check?.latest
  const verdict = !latest ? 'Not checked' : latest.solved ? 'Passed' : latest.known ? 'Failed' : 'No verdict'
  const checker = check?.checkerNames?.find((c) => c.current) ?? check?.checkerNames?.[0]
  const committers = m.tree.filter((a) => (a.commits ?? 0) > 0).sort((a, b) => (b.commits ?? 0) - (a.commits ?? 0))
  const maxCommits = Math.max(1, ...committers.map((a) => a.commits ?? 0))
  return (
    <div className="rp-ck">
      <section className="rp-card" aria-label="Checks">
        <div className="rp-scroll rp-ck-in">
          <h2 className="rp-ck-h"><StateDot tone={verdict === 'Passed' ? 'ok' : verdict === 'Failed' ? 'fail' : 'none'} />{verdict}</h2>
          <dl className="rp-facts">
            <dt>Checks</dt><dd>{count(check?.counts?.checks ?? 0)} run · {count(check?.counts?.known ?? 0)} with a verdict<span className="sub">{check?.counts?.solved ? `${check.counts.solved} passed` : 'none passed'}</span></dd>
            <dt>Latest</dt><dd>{latest?.line ? clause(latest.line, 24) : '—'}<span className="sub">{latest?.at ? `${latest.at.slice(0, 10)} ${latest.at.slice(11, 16)} UTC` : ''}{latest?.tag ? ` · ${latest.tag}` : ''}</span></dd>
            <dt>Checker</dt><dd>{checker ? `${checker.label}${checker.ruling ? ` · ${checker.ruling}` : ''}` : 'not recorded'}<span className="sub">{check?.calibration?.state ? `${check.calibration.state}${check.calibration.stages?.length ? `: ${check.calibration.stages.map((s) => `${s.name} ${s.state}`).join(', ')}` : ''}` : 'calibration not recorded'}</span></dd>
            <dt>Releases</dt><dd>{m.releases.length ? `${m.releases.length} · best ${m.best?.release ?? 'none'}` : 'None tagged'}</dd>
          </dl>
          {m.releases.length > 0 && (
            <>
              <h3 className="rp-subh">Releases</h3>
              <ol className="rp-rel">
                {[...m.releases].reverse().map((r) => (
                  <li key={r.release}>
                    <b>{r.release}</b>
                    <span className="score">{r.total ? `${r.passed ?? 0}/${r.total}` : 'not scored'}</span>
                    <span className="steps">{(r.steps ?? []).map((s, i) => <i key={i} className={s.state} title={`${s.label}: ${s.state}`} />)}</span>
                    <span className="when">{r.taggedAt ? `${r.taggedAt.slice(5, 10)} ${r.taggedAt.slice(11, 16)}` : '—'}</span>
                    {r.sentence && <span className="sub">{clause(r.sentence, 20)}</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </section>
      <section className="rp-card" aria-label="Commits by agent">
        <div className="rp-hd sm"><h2>Commits by agent<span className="ct">{count(committers.reduce((t, a) => t + (a.commits ?? 0), 0))}</span></h2></div>
        <div className="rp-scroll rp-commits">
          {committers.length ? committers.map((a) => (
            <div key={a.id} className="row"><span className="l"><StateDot tone={a.state.tone} />{a.name}</span><Bar ok={a.commits ?? 0} max={maxCommits} /><span className="n">{a.commits}</span></div>
          )) : <p className="ws-status">No agent's commits reached the run's deliverables.</p>}
        </div>
      </section>
    </div>
  )
}
