import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FinalOutput, OutputFile, RunDocument } from '../workspace.js'
import { useDocument, when } from './data.js'
import { byteSize, deliveryLabel, externalHref, sameOriginHref } from './final-output.js'
import { compareOutputs, KIND_LABEL, groupOutputs, outputKind, parseDelimited, pathInGroup, type DeliverableChange, type FilePair, type OutputGroup } from './outputs.js'
import { lineDiff } from './profile-compare.js'
import { DiffLines } from './ProfileVersions.js'

/** Above this a file is linked, not drawn: the page would hold megabytes of text it cannot show usefully. */
const DRAW_LIMIT = 4 << 20
const ROWS_SHOWN = 500
const FILES_SHOWN = 12

const pageHref = (href: string | null | undefined) => (typeof window === 'undefined' ? null : sameOriginHref(href, window.location.href))

/** A same-origin output file's text, fetched once per href. */
function useText(href: string | null) {
  const [state, setState] = useState<{ text?: string; error?: string }>({})
  useEffect(() => {
    setState({})
    if (!href) return
    const controller = new AbortController()
    fetch(href, { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'The file is no longer listed.' : `HTTP ${response.status}`)
        return response.text()
      })
      .then((text) => setState({ text }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'Unavailable' })
      })
    return () => controller.abort()
  }, [href])
  return state
}

const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** A relative link inside a delivered page, resolved against the page's folder; null when it leaves the run directory. */
function resolveLink(from: string, href: string): string | null {
  const parts = [...dirname(from).split('/').filter(Boolean)]
  for (const part of href.split('#')[0]!.split('?')[0]!.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(decodeURIComponent(part))
  }
  return parts.join('/')
}

/**
 * The run's outputs in the drawer: each deliverable the readout names with the files under it, and the selected file
 * drawn by its kind. A link inside a delivered page opens the file it names when the run delivered it.
 */
export function OutputsView({ doc, selected, onSelect, onClose }: { doc: RunDocument; selected: string | null; onSelect: (path: string | null) => void; onClose: () => void }) {
  const output = doc.finalOutput ?? null
  const groups = useMemo(() => groupOutputs(output), [output])
  const files = output?.files ?? []
  const file = selected ? files.find((item) => item.path === selected) ?? (output?.rootOutput?.path === selected ? output.rootOutput : null) : null
  const deliverables = groups.filter((group) => group.deliverable)
  const present = deliverables.filter((group) => group.deliverable?.present === true).length
  return (
    <div className="outputs-view" data-outputs>
      <div className="drawer-head">
        <div className="outputs-title">
          <h2>Outputs</h2>
          {output?.declared && <span className={`state-pill ${output.status === 'delivered' ? 'state-ok' : output.status === 'not-delivered' ? 'state-fail' : 'state-unknown'}`}>{deliveryLabel(output.status)}</span>}
          <span className="faint">
            {deliverables.length ? `${present} of ${deliverables.length} deliverables present · ` : ''}
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        </div>
        <button type="button" className="ui-button" onClick={onClose}>Close</button>
      </div>
      {output?.fallback && <Fallback output={output} />}
      {file ? (
        <OutputReader key={file.path} file={file} files={files} onBack={() => onSelect(null)} onOpen={onSelect} />
      ) : selected ? (
        <div className="outputs-body">
          <p className="chat-empty" role="alert">{selected} is not among this run's listed outputs.</p>
          <button type="button" className="ui-button" onClick={() => onSelect(null)}>← All outputs</button>
        </div>
      ) : (
        <div className="outputs-body">
          {!output || (groups.length === 0 && !output.rootOutput) ? (
            <p className="chat-empty">
              {output?.status === 'none-declared' ? 'This run declared no deliverable and its readout names none.' : 'No output file is listed for this run.'}
            </p>
          ) : null}
          {groups.map((group) => <GroupView key={group.key || 'rest'} group={group} root={output?.declared?.path ?? null} onSelect={onSelect} />)}
          {output?.rootOutput && (
            <section className="output-group" data-output-group="root-output">
              <header className="output-group-head"><h3>The root's last output</h3></header>
              <ul className="output-files"><FileButton file={output.rootOutput} name={output.rootOutput.path} onSelect={onSelect} /></ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function Fallback({ output }: { output: FinalOutput }) {
  const fallback = output.fallback!
  const link = externalHref(fallback.url)
  return (
    <div className="output-fallback" data-output-fallback>
      <b>The run ended without its deliverable.</b> Its readable result is the observer's brief {fallback.sequence}
      {fallback.generatedAt ? ` (${when(fallback.generatedAt)})` : ''}: {fallback.headline ?? 'no headline'}{' '}
      {link && <a href={link} target="_blank" rel="noopener noreferrer">Read it ↗</a>}
    </div>
  )
}

function GroupView({ group, root, onSelect }: { group: OutputGroup; root: string | null; onSelect: (path: string) => void }) {
  const [all, setAll] = useState(false)
  const deliverable = group.deliverable
  const link = externalHref(deliverable?.url)
  const shown = all ? group.files : group.files.slice(0, FILES_SHOWN)
  const runnable = group.files.filter((file) => ['code', 'json', 'csv'].includes(outputKind(file)))
  const present = deliverable?.present
  return (
    <section className="output-group" data-output-group={group.key || 'other'}>
      <header className="output-group-head">
        <h3>{deliverable ? deliverable.id : 'Other files under the declared folder'}</h3>
        {deliverable && (
          <span className={`state-pill ${present === true ? 'state-ok' : present === false ? 'state-fail' : 'state-unknown'}`}>
            {present === true ? 'present' : present === false ? 'missing' : 'not checked'}
          </span>
        )}
        {deliverable?.kind && <span className="faint">{deliverable.kind}</span>}
        {link && <a href={link} target="_blank" rel="noopener noreferrer">published copy ↗</a>}
      </header>
      {deliverable?.bar && <p className="output-bar">{deliverable.bar}</p>}
      {group.whole && <p className="faint">It names the whole declared folder, so its files are listed under the other deliverables.</p>}
      {deliverable && !group.whole && present === false && group.files.length > 0 && (
        <p className="output-note">The readout found this deliverable missing against its bar; {group.files.length} {group.files.length === 1 ? 'file is' : 'files are'} under its path.</p>
      )}
      {deliverable?.kind === 'code' && !group.whole && (
        <p className="output-note" data-runnable={runnable.length ? 'code' : 'none'}>
          {runnable.length
            ? 'Not runnable here: this page shows the code and data but never runs a run’s code, so it offers no editable inputs.'
            : 'Not runnable here: no code or data file was delivered under this path, only documents. Editable inputs need a model the page can evaluate without running the run’s code.'}
        </p>
      )}
      {group.files.length > 0 && (
        <ul className="output-files">
          {shown.map((file) => <FileButton key={file.path} file={file} name={pathInGroup(group, file, root)} onSelect={onSelect} />)}
        </ul>
      )}
      {group.files.length > FILES_SHOWN && (
        <button type="button" className="ui-button output-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${group.files.length} files`}
        </button>
      )}
      {deliverable && !group.whole && group.files.length === 0 && <p className="faint">No file is listed under {deliverable.path ?? 'its path'}.</p>}
    </section>
  )
}

function FileButton({ file, name, onSelect }: { file: OutputFile; name: string; onSelect: (path: string) => void }) {
  const kind = outputKind(file)
  return (
    <li>
      <button type="button" className="output-file" data-output-file={file.path} onClick={() => onSelect(file.path)} title={file.path}>
        <span className="mono clip">{name}</span>
        <span className="faint">{KIND_LABEL[kind]}</span>
        <span className="faint num">{byteSize(file.bytes)}</span>
      </button>
    </li>
  )
}

/** One output file drawn by its kind. Nothing a run wrote is executed: HTML and code are shown as text. */
function OutputReader({ file, files, onBack, onOpen }: { file: OutputFile; files: OutputFile[]; onBack: () => void; onOpen: (path: string) => void }) {
  const kind = outputKind(file)
  const href = pageHref(file.href)
  const tooLarge = file.bytes !== null && file.bytes > DRAW_LIMIT
  const text = useText(kind !== 'image' && !tooLarge ? href : null)
  const [source, setSource] = useState(false)
  const listed = useMemo(() => new Map(files.map((item) => [item.path, item])), [files])
  const body = (() => {
    if (!href) return <p className="chat-empty">This host cannot serve the file.</p>
    if (kind === 'image') return <img className="output-image" src={href} alt={file.path} />
    if (tooLarge) return <p className="chat-empty">At {byteSize(file.bytes)} this file is more than the page draws; open the raw file.</p>
    if (text.error) return <p className="chat-empty" role="alert">{text.error}</p>
    if (text.text === undefined) return <p className="faint">Loading…</p>
    if (source || kind === 'code' || kind === 'other') return <CodeView text={text.text} />
    if (kind === 'markdown') return <MarkdownView text={text.text} path={file.path} listed={listed} onOpen={onOpen} />
    if (kind === 'csv') return <TableView text={text.text} separator={/\.tsv$/i.test(file.path) ? '\t' : ','} />
    if (kind === 'json') return <JsonView text={text.text} />
    return (
      <>
        <p className="output-note">HTML is shown as its source: this page never runs a run’s HTML.</p>
        <CodeView text={text.text} />
      </>
    )
  })()
  return (
    <article className="output-reader" data-output-reader={file.path}>
      <header className="output-reader-head">
        <button type="button" className="ui-button" onClick={onBack}>← All outputs</button>
        <div className="output-reader-title">
          <h3 className="mono">{file.path.split('/').at(-1)}</h3>
          <p className="faint mono clip" title={file.path}>{file.path}</p>
          <p className="faint">
            {KIND_LABEL[kind]} · {byteSize(file.bytes)}
            {file.sha256 ? ` · sha256 ${file.sha256.slice(0, 12)}` : ''}
          </p>
        </div>
        <div className="output-reader-actions">
          {['markdown', 'csv', 'json'].includes(kind) && (
            <button type="button" className="ui-button" aria-pressed={source} onClick={() => setSource(!source)}>
              {source ? 'Read it' : 'View source'}
            </button>
          )}
          {href && <a className="ui-button" href={href} target="_blank" rel="noopener noreferrer">Raw ↗</a>}
        </div>
      </header>
      <div className="output-content" data-output-content={kind}>{body}</div>
    </article>
  )
}

function MarkdownView({ text, path, listed, onOpen }: { text: string; path: string; listed: Map<string, OutputFile>; onOpen: (path: string) => void }) {
  return (
    <div className="rr-markdown output-markdown">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const external = href ? externalHref(href) : null
            if (external) return <a href={external} target="_blank" rel="noopener noreferrer">{children}</a>
            const target = href && !href.startsWith('#') ? resolveLink(path, href) : null
            if (target && listed.has(target))
              return <button type="button" className="link-button" onClick={() => onOpen(target)} title={target}>{children}</button>
            return <span className="dead-link" title={href ? `${href}: not a file this run delivered` : undefined}>{children as ReactNode}</span>
          },
          img: ({ src, alt }) => {
            // Only an image the run delivered is drawn, from this host; any other source is named, never fetched.
            const target = typeof src === 'string' && !externalHref(src) ? resolveLink(path, src) : null
            const image = target ? listed.get(target) : undefined
            const href = image && outputKind(image) === 'image' ? pageHref(image.href) : null
            return href ? <img className="output-image" src={href} alt={alt ?? target ?? ''} /> : <span className="faint">[image: {alt || src || 'unnamed'}]</span>
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

function CodeView({ text }: { text: string }) {
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  return (
    <pre className="output-code">
      <code>
        {lines.map((line, i) => (
          <span key={i} className="code-line">
            <span className="line-no" aria-hidden="true">{i + 1}</span>
            {line}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  )
}

function TableView({ text, separator }: { text: string; separator: string }) {
  const rows = useMemo(() => parseDelimited(text, separator), [text, separator])
  if (!rows.length) return <p className="chat-empty">The table is empty.</p>
  const [head, ...body] = rows
  return (
    <div className="output-table-wrap">
      <table className="output-table">
        <thead><tr>{head!.map((cell, i) => <th key={i}>{cell}</th>)}</tr></thead>
        <tbody>
          {body.slice(0, ROWS_SHOWN).map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j} className={/^-?[\d,.]+%?$/.test(cell.trim()) ? 'num' : undefined}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {body.length > ROWS_SHOWN && <p className="faint">Showing the first {ROWS_SHOWN} of {body.length} rows.</p>}
    </div>
  )
}

function JsonView({ text }: { text: string }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return null
    }
  }, [text])
  if (pretty === null)
    return (
      <>
        <p className="output-note">Not one JSON document (JSON lines, or malformed): shown as written.</p>
        <CodeView text={text} />
      </>
    )
  return <CodeView text={pretty} />
}

// ------------------------------------------------------------------------------------------------ version edges

const CHANGE_LABEL: Record<FilePair['change'], string> = { added: 'added', removed: 'removed', changed: 'changed', same: 'same', unknown: 'unknown' }

/**
 * What the delivered output changed between two versions of a play: deliverable by deliverable, which files were added,
 * removed or changed, each changed text one click from its line diff and each changed image drawn before and after.
 * A comparison of the files, never a measured effect.
 */
export function OutputChanges({ api, beforeRunId, afterRunId, beforeLabel }: { api: string; beforeRunId: string; afterRunId: string; beforeLabel: string }) {
  const before = useDocument<RunDocument>(`${api}/runs/${encodeURIComponent(beforeRunId)}`)
  const after = useDocument<RunDocument>(`${api}/runs/${encodeURIComponent(afterRunId)}`)
  const changes = useMemo(
    () => (before.data && after.data ? compareOutputs(before.data.finalOutput, after.data.finalOutput) : null),
    [before.data, after.data],
  )
  if (before.error || after.error) return <p className="faint">A run's outputs are unavailable: {before.error ?? after.error}</p>
  if (!changes) return <p className="faint">Loading both runs' outputs…</p>
  if (!changes.length) return <p className="faint">Neither run lists an output file or a readout deliverable.</p>
  return (
    <div className="output-changes" data-output-changes={`${beforeRunId}..${afterRunId}`}>
      <p className="faint">The files each run delivered, compared by content with {beforeLabel}. A comparison of the outputs, not a measured effect.</p>
      {changes.map((change) => <DeliverableChangeView key={change.key || 'rest'} change={change} />)}
    </div>
  )
}

function changeSummary(change: DeliverableChange): string {
  if (change.status === 'added') return `new in this version · ${change.files.length} ${change.files.length === 1 ? 'file' : 'files'}`
  if (change.status === 'removed') return 'not named by this version’s readout'
  if (!change.files.length) return 'no file under its path in either run'
  const { added, removed, changed, same, unknown } = change.counts
  return [
    added && `${added} added`,
    removed && `${removed} removed`,
    changed && `${changed} changed`,
    same && `${same} the same`,
    unknown && `${unknown} unknown`,
  ]
    .filter(Boolean)
    .join(' · ')
}

const CHANGE_ORDER: Record<FilePair['change'], number> = { changed: 0, unknown: 1, added: 2, removed: 3, same: 4 }

function DeliverableChangeView({ change }: { change: DeliverableChange }) {
  const [all, setAll] = useState(false)
  const present = (group: DeliverableChange['before']) => (group?.deliverable ? (group.deliverable.present === true ? 'present' : group.deliverable.present === false ? 'missing' : 'not checked') : null)
  const was = present(change.before)
  const now = present(change.after)
  // Changed files first (each opens its diff), then added and removed ones.
  const changed = change.files.filter((pair) => pair.change !== 'same').sort((a, b) => CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change] || a.name.localeCompare(b.name))
  const shown = all ? changed : changed.slice(0, FILES_SHOWN)
  return (
    <details className="output-change" data-output-change={change.key || 'other'}>
      <summary>
        <b>{change.label}</b>
        {was !== null && now !== null && was !== now ? <span className="faint"> {was} → {now}</span> : now ? <span className="faint"> {now}</span> : null}
        <span className="output-change-counts"> {changeSummary(change)}</span>
      </summary>
      {changed.length ? (
        <>
          <ul className="output-change-files">
            {shown.map((pair) => <FilePairView key={pair.name} pair={pair} />)}
          </ul>
          {changed.length > FILES_SHOWN && (
            <button type="button" className="ui-button output-more" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${changed.length}`}
            </button>
          )}
        </>
      ) : (
        <p className="faint">No file changed.</p>
      )}
    </details>
  )
}

function FilePairView({ pair }: { pair: FilePair }) {
  const [open, setOpen] = useState(false)
  const file = pair.after ?? pair.before!
  const kind = outputKind(file)
  const renamed = pair.before && pair.after && pair.before.path.split('/').at(-1) !== pair.after.path.split('/').at(-1)
  const label = (
    <>
      <span className={`change-${pair.change}`}>{CHANGE_LABEL[pair.change]}</span> <span className="mono">{renamed ? `${pair.before!.path.split('/').at(-1)} → ${pair.name}` : pair.name}</span>{' '}
      <span className="faint">
        {pair.before && pair.after ? `${byteSize(pair.before.bytes)} → ${byteSize(pair.after.bytes)}` : byteSize(file.bytes)}
      </span>
    </>
  )
  if (pair.change !== 'changed' && pair.change !== 'unknown') return <li>{label}</li>
  return (
    <li>
      <details onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
        <summary>{label}</summary>
        {open && (kind === 'image' ? <ImagePair pair={pair} /> : <TextDiff before={pair.before!} after={pair.after!} />)}
      </details>
    </li>
  )
}

function ImagePair({ pair }: { pair: FilePair }) {
  return (
    <div className="output-image-pair">
      {[pair.before, pair.after].map((file, i) => {
        const href = pageHref(file?.href)
        return (
          <figure key={i}>
            {href ? <img src={href} alt={file!.path} /> : <p className="faint">not served</p>}
            <figcaption className="faint">{i === 0 ? 'before' : 'after'}</figcaption>
          </figure>
        )
      })}
    </div>
  )
}

function TextDiff({ before, after }: { before: OutputFile; after: OutputFile }) {
  const tooLarge = [before, after].some((file) => file.bytes !== null && file.bytes > DRAW_LIMIT)
  const a = useText(tooLarge ? null : pageHref(before.href))
  const b = useText(tooLarge ? null : pageHref(after.href))
  const diff = useMemo(() => (a.text !== undefined && b.text !== undefined ? lineDiff(a.text.split('\n'), b.text.split('\n')) : null), [a.text, b.text])
  if (tooLarge) return <p className="faint">Too large to compare here.</p>
  if (a.error || b.error) return <p className="faint" role="alert">{a.error ?? b.error}</p>
  if (!diff) return <p className="faint">Loading both files…</p>
  return (
    <div className="output-diff">
      <p className="faint">
        +{diff.added} −{diff.removed} lines
      </p>
      <DiffLines lines={diff.lines} />
    </div>
  )
}
