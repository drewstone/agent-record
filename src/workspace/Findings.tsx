import { useEffect, useMemo, useState } from 'react'
import type { FindingItem, Findings, RunDocument } from '../workspace.js'
import { MessageText } from '../viewer/StructuredContent.js'

const LEAD_KINDS = new Set(['result', 'claim'])
const SHOWN = 10
const KIND_LABEL: Record<string, string> = {
  result: 'result',
  claim: 'claim',
  check: 'check',
  sources: 'sources',
  plan: 'plan',
  evidence: 'evidence',
  process: 'process',
}

const clock = (value: string | null | undefined) => (value ? `${value.slice(11, 16)} UTC` : 'time unknown')
const stem = (path: string) => path.split('/').pop()?.replace(/\.md$/i, '') ?? path
const short = (label: string | null | undefined) => (label ? label.split(' · ')[0]! : 'agent')
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** Where a citation opens: arXiv, the IACR ePrint archive, or a DOI resolver. */
function citationHref(kind: string, id: string) {
  if (kind === 'arxiv') return `https://arxiv.org/abs/${id}`
  if (kind === 'iacr') return `https://eprint.iacr.org/${id}`
  if (kind === 'doi') return `https://doi.org/${id}`
  return null
}

/** The tone a check's verdict word carries. */
function verdictTone(verdict: string | null) {
  if (!verdict) return 'neutral'
  if (/^(CORRECT|NO ERRORS? FOUND|NO ERROR|NO GAPS)$/.test(verdict)) return 'ok'
  if (/^(INCORRECT|REFUTED|ERROR)$/.test(verdict)) return 'fail'
  return 'warn'
}

/** One page's full text, fetched when its reader opens it. */
function usePage(href: string | null) {
  const [state, setState] = useState<{ text?: string; error?: string }>({})
  useEffect(() => {
    setState({})
    if (!href) return
    const controller = new AbortController()
    fetch(href, { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then((text) => setState({ text }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'Request failed' })
      })
    return () => controller.abort()
  }, [href])
  return state
}

export function PageReader({ href }: { href: string }) {
  const page = usePage(href)
  if (page.error) return <p className="ws-status" role="alert">This page is unavailable: {page.error}</p>
  if (page.text === undefined) return <p className="ws-status" role="status">Loading the page…</p>
  return (
    <div className="finding-page">
      <MessageText text={page.text} />
    </div>
  )
}

function FindingRow({ item, pageHref, open, onToggle }: { item: FindingItem; pageHref: string; open: boolean; onToggle: () => void }) {
  const [reading, setReading] = useState(false)
  return (
    <li className={`finding-row ${open ? 'open' : ''}`} data-finding={item.sha256}>
      <button type="button" className="finding-head" aria-expanded={open} onClick={onToggle}>
        <span className="finding-tags">
          <span className={`ftag kind-${item.kind}`}>{KIND_LABEL[item.kind] ?? item.kind}</span>
          {item.class && <span className="ftag tone-neutral">{item.class.toLowerCase()}</span>}
        </span>
        <span className="finding-text">
          <span className="finding-title">{item.title}</span>
          {!open && <span className="finding-summary clamp-2">{item.answer ?? item.summary}</span>}
        </span>
        <span className="finding-meta">
          <span>{short(item.agentLabel)}</span>
          <span className="mono">{clock(item.at)}</span>
        </span>
      </button>
      {open && (
        <div className="finding-body">
          {item.answer && <p className="finding-summary"><b>Answer:</b> {item.answer}</p>}
          {!(item.answer && item.summary.includes(item.answer.slice(0, 80))) && <p className="finding-summary">{item.summary}</p>}
          <div className="finding-facts">
            <span className="mono">{item.path}</span>
            {item.versions > 1 && <span>{item.versions} versions</span>}
            {item.uncaptured && <span className="tone-warn" title="The run directory holds this page; the conversation record stopped before the agent wrote it.">written after capture stopped</span>}
          </div>
          <div className="finding-actions">
            <button type="button" className="ui-button" onClick={() => setReading((value) => !value)} aria-expanded={reading}>
              {reading ? 'Hide the page' : 'Read the page'}
            </button>
          </div>
          {reading && <PageReader href={pageHref} />}
        </div>
      )}
    </li>
  )
}

function StopCard({ findings, doc }: { findings: Findings; doc: RunDocument }) {
  const stop = findings.stop
  const failed = doc.run.state !== 'winner' && doc.run.state !== 'running'
  if (!stop.limits.length && !(failed && (stop.lastCause || stop.firstFailure))) return null
  return (
    <section className="finding-card" aria-label="Why the run stopped" data-findings-stop>
      <h3 className="kicker tone-fail">Why it stopped</h3>
      <ol className="stop-steps">
        {stop.limits.map((limit, i) => (
          <li key={`${limit.agent}:${limit.limit}:${i}`}>
            <span className="mono">{clock(limit.at)}</span>
            <span>
              <b>{short(limit.label)}</b> hit its {limit.limit} subscription limit
            </span>
          </li>
        ))}
        {failed && (stop.firstFailure || stop.lastCause) && (
          <li>
            <span className="mono">end</span>
            <span>
              <b>driver</b> stopped{stop.attempts ? ` after ${plural(stop.attempts, 'attempt')}` : ''}
              {stop.firstFailure ? `; first failure: ${stop.firstFailure}` : ''}
            </span>
          </li>
        )}
      </ol>
      {failed && stop.lastCause && (
        <details className="stop-cause">
          <summary>Last cause</summary>
          <p className="mono">{stop.lastCause}</p>
        </details>
      )}
    </section>
  )
}

function SourcesCard({ findings }: { findings: Findings }) {
  const sources = findings.sources
  const reads = sources.knowledgeReads + sources.knowledgeSearches
  if (!sources.citations.length && !sources.webSearches.length && !sources.webFetches.length && !reads) return null
  return (
    <section className="finding-card" aria-label="Sources" data-findings-sources>
      <h3 className="kicker tone-info">Sources</h3>
      <div className="source-counts">
        <span><b>{sources.citations.length}</b> papers cited</span>
        <span><b>{sources.webSearches.length}</b> web searches</span>
        <span><b>{sources.webFetches.length}</b> pages fetched</span>
        <span><b>{reads}</b> knowledge reads</span>
      </div>
      {sources.citations.length > 0 && (
        <ul className="citation-list">
          {sources.citations.slice(0, 8).map((citation) => {
            const href = citationHref(citation.kind, citation.id)
            return (
              <li key={`${citation.kind}:${citation.id}`}>
                {href ? (
                  <a className="mono" href={href} target="_blank" rel="noopener noreferrer">{citation.kind === 'arxiv' ? `arXiv ${citation.id}` : citation.id}</a>
                ) : (
                  <span className="mono">{citation.id}</span>
                )}
                <span className="faint">{plural(citation.mentions, 'mention')} · {citation.agents.map(short).join(', ')}</span>
              </li>
            )
          })}
        </ul>
      )}
      {(sources.webSearches.length > 0 || sources.webFetches.length > 0) && (
        <details className="source-searches">
          <summary>What the agents searched and fetched</summary>
          <ol>
            {sources.webSearches.map((search, i) => (
              <li key={`s${i}`}>
                <span className="mono">{clock(search.at)}</span> <b>{short(search.label)}</b> searched “{search.query}”
              </li>
            ))}
            {sources.webFetches.map((fetched, i) => (
              <li key={`f${i}`}>
                <span className="mono">{clock(fetched.at)}</span> <b>{short(fetched.label)}</b> fetched{' '}
                <a href={fetched.url} target="_blank" rel="noopener noreferrer" className="mono">{fetched.url}</a>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  )
}

function ChecksCard({ checks, pageHref }: { checks: FindingItem[]; pageHref: (item: FindingItem) => string }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!checks.length) return null
  return (
    <section className="finding-card" aria-label="Checks" data-findings-checks>
      <h3 className="kicker tone-ok">How far to trust it</h3>
      <ul className="check-list">
        {checks.map((item) => (
          <li key={item.sha256}>
            <button type="button" className="check-row" aria-expanded={open === item.sha256} onClick={() => setOpen(open === item.sha256 ? null : item.sha256)}>
              <span className="clamp-1" title={item.title}>{item.title}</span>
              <span className={`ftag tone-${verdictTone(item.verdict)}`}>{item.verdict ? item.verdict.toLowerCase() : 'no verdict word'}</span>
            </button>
            {open === item.sha256 && <PageReader href={pageHref(item)} />}
          </li>
        ))}
      </ul>
      <p className="faint card-note">Checks are the agents' own critics and audits, usually the same model family; outside review is separate.</p>
    </section>
  )
}

/**
 * What the run found, first: the results and claims its agents wrote as knowledge pages, the checks on them, the
 * sources behind them, and why the run stopped. A run whose driver failed after an agent proved something shows the
 * proof here, not "none recorded".
 */
export function RunFindings({ doc, runUrl, open, onOpen }: { doc: RunDocument; runUrl: string; open: string | null; onOpen: (sha: string | null) => void }) {
  const findings = doc.findings
  const [all, setAll] = useState(false)
  const setOpen = onOpen
  const groups = useMemo(() => {
    const items = findings?.items ?? []
    return {
      lead: items.filter((item) => LEAD_KINDS.has(item.kind)),
      checks: items.filter((item) => item.kind === 'check'),
      rest: items.filter((item) => !LEAD_KINDS.has(item.kind) && item.kind !== 'check'),
      results: items.filter((item) => item.kind === 'result' && stem(item.path).toUpperCase() === 'RESULT'),
    }
  }, [findings])
  // A finding opened from elsewhere (an agent's list) is shown and brought into view.
  const hiddenOpen = !!open && groups.lead.findIndex((item) => item.sha256 === open) >= SHOWN
  useEffect(() => {
    if (!open) return
    if (hiddenOpen) setAll(true)
    const frame = requestAnimationFrame(() => document.querySelector(`[data-finding="${open}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    return () => cancelAnimationFrame(frame)
  }, [open, hiddenOpen])
  if (!findings || (!findings.total && !findings.agents.some((agent) => agent.lastWords))) return null
  const pageHref = (item: FindingItem) => `${runUrl}/page/${item.sha256}`
  const shown = all || hiddenOpen ? groups.lead : groups.lead.slice(0, SHOWN)
  const agentsWithPages = findings.agents.filter((agent) => agent.pages > 0).length
  const notSettled = doc.run.state !== 'winner' && doc.run.state !== 'running'
  return (
    <section className="run-findings" aria-label="What this run found" data-findings={findings.total}>
      <div className="findings-main">
        <h2 className="kicker tone-finding">What this run found</h2>
        {groups.results.length > 0 ? (
          <div className="findings-lead">
            {groups.results.map((item) => (
              <p key={item.sha256}>
                <b>{short(item.agentLabel)}:</b> {item.answer ?? item.summary}
              </p>
            ))}
          </div>
        ) : (
          <p className="findings-lead">
            {plural(groups.lead.length, 'result or claim')} written by {plural(agentsWithPages, 'agent')}.
          </p>
        )}
        {notSettled && groups.lead.length > 0 && (
          <p className="findings-caution">
            The run ended as {doc.run.state.replaceAll('-', ' ')}, so none of this reached its declared result. Every page below is
            what an agent wrote and kept.
          </p>
        )}
        {groups.lead.length > 0 && (
          <ol className="finding-list">
            {shown.map((item) => (
              <FindingRow key={item.sha256} item={item} pageHref={pageHref(item)} open={open === item.sha256} onToggle={() => setOpen(open === item.sha256 ? null : item.sha256)} />
            ))}
          </ol>
        )}
        {groups.lead.length > SHOWN && (
          <button type="button" className="ui-button" onClick={() => setAll((value) => !value)}>
            {all ? 'Show fewer' : `Show all ${groups.lead.length}`}
          </button>
        )}
        {findings.agents.some((agent) => agent.lastWords) && (
          <details className="last-words">
            <summary>Each agent's last words</summary>
            {findings.agents
              .filter((agent) => agent.lastWords)
              .map((agent) => (
                <div key={agent.agent ?? agent.label ?? 'agent'} className="last-word">
                  <div className="finding-meta">
                    <b>{short(agent.label)}</b>
                    <span className="mono">{clock(agent.lastWords!.at)}</span>
                  </div>
                  <MessageText text={agent.lastWords!.text} />
                </div>
              ))}
          </details>
        )}
        {groups.rest.length > 0 && (
          <details className="other-pages">
            <summary>
              {plural(groups.rest.length, 'other page')}:{' '}
              {Object.entries(
                groups.rest.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.kind]: (counts[item.kind] ?? 0) + 1 }), {}),
              )
                .map(([kind, count]) => `${count} ${KIND_LABEL[kind] ?? kind}`)
                .join(' · ')}
            </summary>
            <ol className="finding-list">
              {groups.rest.map((item) => (
                <FindingRow key={item.sha256} item={item} pageHref={pageHref(item)} open={open === item.sha256} onToggle={() => setOpen(open === item.sha256 ? null : item.sha256)} />
              ))}
            </ol>
          </details>
        )}
      </div>
      <div className="findings-side">
        <ChecksCard checks={groups.checks} pageHref={pageHref} />
        <SourcesCard findings={findings} />
        <StopCard findings={findings} doc={doc} />
      </div>
    </section>
  )
}

/** What one agent wrote, under the agents table: its results and claims, each opening in the run's findings above. */
export function AgentFindings({ doc, agent, label, onOpen }: { doc: RunDocument; agent: string | null; label: string; onOpen: (sha: string) => void }) {
  const items = (doc.findings?.items ?? []).filter((item) => item.agent === agent)
  if (!agent || !doc.findings) return null
  const lead = items.filter((item) => LEAD_KINDS.has(item.kind) || item.kind === 'check')
  return (
    <section className="agent-findings" aria-label={`What ${label} wrote`} data-agent-findings={items.length}>
      <h3 className="kicker tone-finding">What {short(label)} wrote</h3>
      {lead.length ? (
        <ol className="agent-finding-list">
          {lead.slice(0, 12).map((item) => (
            <li key={item.sha256}>
              <button type="button" className="agent-finding" onClick={() => onOpen(item.sha256)} title={item.title}>
                <span className={`ftag kind-${item.kind}`}>{KIND_LABEL[item.kind] ?? item.kind}</span>
                <span className="clamp-1">{item.title}</span>
                <span className="mono faint">{clock(item.at)}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="faint">{items.length ? 'No result, claim or check pages.' : 'This agent wrote no knowledge pages.'}</p>
      )}
      {items.length > lead.length && <p className="faint card-note">{plural(items.length - lead.length, 'other page')}: plans, evidence and working notes.</p>}
    </section>
  )
}
