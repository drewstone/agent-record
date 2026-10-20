import { useEffect, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PlayInput } from '../workspace-model.js'
import { MessageText, StructuredContent } from '../viewer/StructuredContent.js'
import { CollapsibleValue, ValueControls, ValueScope } from './CollapsibleValue.js'

function Long({ title, text }: { title: string; text: string | null }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > 1400
  return (
    <section className="input-block" data-input={title.toLowerCase()}>
      <h4>{title}</h4>
      <div className={`input-text ${long && !open ? 'clamped' : ''}`}>
        {/^\s*[{[]/.test(text) ? <StructuredContent text={text} /> : <MessageText text={text} />}
      </div>
      {long && (
        <button type="button" className="ui-button" onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show all'}
        </button>
      )}
    </section>
  )
}

const bytes = (value: number) =>
  value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`

/** A budget in words (X16): "48 h, no iteration or token cap". A cap at or past Number.MAX_SAFE_INTEGER is no cap. */
function budgetText(budget: Record<string, unknown>) {
  const capped = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value < Number.MAX_SAFE_INTEGER
  const parts: string[] = []
  if (typeof budget.deadlineMs === 'number') parts.push(`${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(budget.deadlineMs / 3_600_000)} h`)
  const caps = [['maxIterations', 'iteration'], ['maxTokens', 'token']] as const
  const none = caps.filter(([key]) => key in budget && !capped(budget[key])).map(([, word]) => word)
  for (const [key, word] of caps) if (capped(budget[key])) parts.push(`at most ${new Intl.NumberFormat('en-US').format(budget[key] as number)} ${word}s`)
  if (none.length) parts.push(`no ${none.join(' or ')} cap`)
  for (const [key, value] of Object.entries(budget)) if (key !== 'deadlineMs' && !caps.some(([cap]) => cap === key)) parts.push(`${key} ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
  return parts.join(', ')
}

/** Knowledge recorded as the retriever's configuration (a JSON seed and store paths) is one line, not a page of internals. */
function knowledgeLine(text: string | null) {
  if (!text) return null
  try {
    const value = JSON.parse(text) as { retrieverVersion?: string; seed?: { digest?: string; directory?: string } }
    if (!value || typeof value !== 'object') return null
    return [value.seed?.digest && `seed ${value.seed.digest.slice(0, 12)}`, value.seed?.directory && `from ${value.seed.directory}`, value.retrieverVersion && `retriever ${value.retrieverVersion}`].filter(Boolean).join(' · ') || null
  } catch {
    return null
  }
}

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="faint">not set</span>
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return <span>{String(value)}</span>
  return <StructuredContent text={JSON.stringify(value)} />
}

function FileReader({ api, runId, file }: { api: string; runId: string; file: PlayInput['files'][number] }) {
  const [state, setState] = useState<{ text?: string; error?: string }>({})
  useEffect(() => {
    setState({})
    const controller = new AbortController()
    fetch(`${api}/runs/${encodeURIComponent(runId)}/source/${file.sha256}`, { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 409 ? 'The file no longer matches its recorded hash.' : `HTTP ${response.status}`)
        return response.text()
      })
      .then((text) => setState({ text }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'Unavailable' })
      })
    return () => controller.abort()
  }, [api, runId, file.sha256])
  const markdown = /\.(md|markdown)$/i.test(file.path)
  const [source, setSource] = useState(!markdown)
  const element = useRef<HTMLElement>(null)
  useEffect(() => element.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), [file.path])
  return (
    <article className="input-file-reader" data-file={file.path} ref={element}>
      <header>
        <div>
          <h4 className="mono">{file.path}</h4>
          <p className="faint mono">{bytes(file.bytes)} · sha256 <CollapsibleValue value={file.sha256} limit={16} /></p>
        </div>
        {markdown && (
          <button type="button" className="ui-button" aria-pressed={source} onClick={() => setSource(!source)}>
            {source ? 'Read document' : 'View source'}
          </button>
        )}
      </header>
      {state.error && <p role="alert" className="chat-empty">{state.error}</p>}
      {state.text === undefined && !state.error && <p className="faint">Loading…</p>}
      {state.text !== undefined &&
        (source ? (
          <pre className="file-source" data-file-content><code>{state.text}</code></pre>
        ) : (
          <div className="rr-markdown file-markdown" data-file-content>
            <Markdown skipHtml remarkPlugins={[remarkGfm]}>{state.text}</Markdown>
          </div>
        ))}
    </article>
  )
}

export function InputView(props: { input: PlayInput | null; api: string; changed?: boolean }) {
  return (
    <ValueScope>
      <InputBody {...props} />
    </ValueScope>
  )
}

function InputBody({ input, api, changed }: { input: PlayInput | null; api: string; changed?: boolean }) {
  const [file, setFile] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const acceptance = input?.acceptance as Record<string, unknown> | null
  const bounds = acceptance?.sandboxBounds as Record<string, unknown> | undefined
  const files = useMemo(
    () => (input?.files ?? []).filter((item) => !filter || item.path.toLowerCase().includes(filter.toLowerCase())),
    [input, filter],
  )
  if (!input) return <p className="chat-empty">No run input is recorded for this run.</p>
  const selected = input.files.find((item) => item.path === file)
  const profile = input.profile
  const { outsideCriterion, sandboxBounds: _b, budgetDerivation, ...restAcceptance } = acceptance ?? {}
  return (
    <div className="input-view" data-input-view>
      <ValueControls />
      {changed && <p className="input-changed">This run's input differs from the play's latest input.</p>}
      <div className="input-columns">
        <div className="input-main">
          <Long title="Objective" text={input.objective} />
          <Long title="Instruction" text={input.instruction} />
          <Long title="Completion" text={input.completion} />
          {knowledgeLine(input.knowledge) ? <p className="input-line" data-input="knowledge"><b>Knowledge</b> {knowledgeLine(input.knowledge)}</p> : <Long title="Knowledge" text={input.knowledge} />}
          {acceptance && (
            <section className="input-block" data-input="acceptance">
              <h4>Acceptance</h4>
              {typeof outsideCriterion === 'string' && (
                <div className="criterion">
                  <span className="kv-label">Outside criterion</span>
                  <MessageText text={outsideCriterion} />
                </div>
              )}
              {bounds && (
                <dl className="kv bounds" data-sandbox-bounds>
                  <div><dt>Per sandbox</dt><dd>{String(bounds.cpu ?? '?')} vCPU / {bounds.memoryMb ? `${Math.round(Number(bounds.memoryMb) / 1024)} GB` : '?'}{bounds.diskMb ? ` / ${Math.round(Number(bounds.diskMb) / 1024)} GB disk` : ''}</dd></div>
                  {bounds.perPlayMaximumSandboxes !== undefined && <div><dt>Per play</dt><dd>{String(bounds.perPlayMaximumSandboxes)} sandboxes · {String(bounds.perPlayCpu ?? '?')} vCPU</dd></div>}
                  {bounds.cohortMaximumSandboxes !== undefined && <div><dt>Cohort</dt><dd>{String(bounds.cohortMaximumSandboxes)} sandboxes · {String(bounds.cohortCpu ?? '?')} vCPU</dd></div>}
                  {bounds.capacityGuaranteed !== undefined && <div><dt>Capacity guaranteed</dt><dd>{String(bounds.capacityGuaranteed)}</dd></div>}
                </dl>
              )}
              {budgetDerivation !== undefined && (
                <details className="input-details">
                  <summary>Budget derivation</summary>
                  <Value value={budgetDerivation} />
                </details>
              )}
              {Object.keys(restAcceptance).length > 0 && (
                <details className="input-details">
                  <summary>All acceptance fields</summary>
                  <Value value={restAcceptance} />
                </details>
              )}
            </section>
          )}
          {input.budget && <p className="input-line" data-input="budget"><b>Budget</b> {budgetText(input.budget)}</p>}
          {input.continuation && (
            <details className="input-details">
              <summary>Continuation</summary>
              <Value value={input.continuation} />
            </details>
          )}
        </div>
        <aside className="input-side">
          {profile && (
            <section className="input-block" data-input="profile">
              <h4>Profile</h4>
              <dl className="kv">
                {profile.name && <div><dt>Name</dt><dd className="mono"><CollapsibleValue value={profile.name} /></dd></div>}
                <div><dt>Version</dt><dd className="mono"><CollapsibleValue value={profile.version} empty="not recorded" /></dd></div>
                <div><dt>Digest</dt><dd className="mono"><CollapsibleValue value={profile.digest} limit={23} empty="not recorded" /></dd></div>
                <div><dt>Harness</dt><dd><CollapsibleValue value={profile.harness} /></dd></div>
                <div><dt>Model</dt><dd className="mono"><CollapsibleValue value={profile.model} /></dd></div>
                <div><dt>Reasoning effort</dt><dd><CollapsibleValue value={profile.reasoningEffort} /></dd></div>
                <div><dt>Credential</dt><dd><CollapsibleValue value={profile.credentialSource} empty="not recorded" /></dd></div>
                {profile.systemPromptSha256 && (
                  <div><dt>System prompt sha256</dt><dd className="mono"><CollapsibleValue value={profile.systemPromptSha256} limit={16} /></dd></div>
                )}
                {profile.systemPrompt && <div className="wide" data-profile-value="system-prompt"><dt>System prompt</dt><dd><CollapsibleValue value={profile.systemPrompt} /></dd></div>}
                {profile.instructions && profile.instructions.length > 0 && (
                  <div className="wide" data-profile-value="instructions">
                    <dt>Instructions ({profile.instructions.length})</dt>
                    <dd>
                      <ol className="profile-instructions">
                        {profile.instructions.map((line, i) => <li key={i}><CollapsibleValue value={line} /></li>)}
                      </ol>
                    </dd>
                  </div>
                )}
                {profile.tools.length > 0 && (
                  <div className="wide" data-profile-value="tools"><dt>Tools ({profile.tools.length})</dt><dd className="mono"><CollapsibleValue value={profile.tools.join(', ')} /></dd></div>
                )}
                {profile.skills.length > 0 && (
                  <div className="wide" data-profile-value="skills"><dt>Skills ({profile.skills.length})</dt><dd><CollapsibleValue value={profile.skills.join(', ')} /></dd></div>
                )}
              </dl>
            </section>
          )}
          <section className="input-block" data-input="files">
            <h4>Input files</h4>
            {input.files.length > 12 && (
              <input type="search" className="file-filter" placeholder="Filter files" value={filter} onChange={(event) => setFilter(event.target.value)} />
            )}
            <ul className="file-list">
              {files.map((item) => (
                <li key={item.path}>
                  <button type="button" className={file === item.path ? 'selected' : ''} data-input-file={item.path} onClick={() => setFile(file === item.path ? null : item.path)}>
                    <span className="mono">{item.path}</span>
                    <small>{bytes(item.bytes)}</small>
                  </button>
                </li>
              ))}
            </ul>
            <p className="faint mono">run-input.json · sha256 <CollapsibleValue value={input.source.sha256} limit={16} /></p>
          </section>
        </aside>
      </div>
      {selected && <FileReader api={api} runId={input.runId} file={selected} />}
    </div>
  )
}
