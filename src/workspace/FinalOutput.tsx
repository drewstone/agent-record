import { useState } from 'react'
import type { FinalOutput, OutputFile, Readout } from '../workspace.js'
import { byteSize, deliveryLabel, externalHref, judgeBasis, sameOriginHref, scoreLabel, verdictView } from './final-output.js'
import { money, when } from './data.js'

function FileRow({ file, label }: { file: OutputFile; label?: string }) {
  const href = typeof window === 'undefined' ? null : sameOriginHref(file.href, window.location.href)
  return (
    <li className="final-file" data-final-file={file.path}>
      {href ? (
        <a className="mono final-path" href={href} target="_blank" rel="noopener">
          {file.path}
        </a>
      ) : (
        <span className="mono final-path">{file.path}</span>
      )}
      <span className="final-size">{byteSize(file.bytes)}</span>
      {label && <span className="final-label">{label}</span>}
      {!href && <span className="final-size">no link</span>}
    </li>
  )
}

/** Long evidence and judge reasons show three lines until the reader asks for the rest. */
const CLAMP_CHARS = 240

function Clamped({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (text.length <= CLAMP_CHARS) return <>{text}</>
  return (
    <>
      <span className={open ? undefined : 'final-clamped'}>{text}</span>{' '}
      <button type="button" className="final-more" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'less' : 'more'}
      </button>
    </>
  )
}

/** A long list stays one line until opened, so the readout above it stays in view. */
const FILES_SHOWN = 8

function DeliveredFiles({ files }: { files: OutputFile[] }) {
  if (files.length === 0) return <p className="faint final-none">No delivered file is recorded.</p>
  const list = <ul className="final-files">{files.map((file) => <FileRow key={file.path} file={file} />)}</ul>
  if (files.length <= FILES_SHOWN) return list
  return (
    <details className="final-files-all">
      <summary>{files.length} files under the declared path</summary>
      {list}
    </details>
  )
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  )
}

const READOUT_LINKS = [
  ['report', 'Report'],
  ['dossier', 'Dossier'],
] as const

/** The readout the Lab writes after the run settles: summary, deliverables, verdicts, judges, cost and its links. */
function ReadoutSection({ readout }: { readout: Readout }) {
  if (readout.status === 'pending') {
    return (
      <div className="final-readout" data-readout="pending">
        <h3>Readout pending</h3>
        <p className="faint">The readout is written after the run settles; none has finished for this run yet.</p>
      </div>
    )
  }
  const tone = readout.status === 'complete' ? 'state-ok' : readout.status === 'failed' ? 'state-fail' : 'state-warn'
  const gist = externalHref(readout.links.gist)
  const shownGist = gist && !READOUT_LINKS.some(([key]) => externalHref(readout.links[key]) === gist) ? gist : null
  return (
    <div className="final-readout" data-readout={readout.status}>
      <div className="final-readout-head">
        <h3>Readout</h3>
        <span className={`state-pill ${tone}`}>{readout.status}</span>
        {readout.settle && (
          <span className="faint">
            settled {readout.settle.kind.replaceAll('-', ' ')}
            {readout.settle.reason ? `, ${readout.settle.reason.replaceAll('-', ' ')}` : ''}
          </span>
        )}
        {readout.generatedAt && <span className="faint final-checked">written {when(readout.generatedAt)}</span>}
      </div>
      {readout.error && <p className="final-error" role="note">{readout.error}</p>}
      {readout.summary && <p className="final-summary">{readout.summary}</p>}
      <p className="final-links">
        {READOUT_LINKS.map(([key, label]) => {
          const href = externalHref(readout.links[key])
          return href ? <ExternalLink key={key} href={href}>{label}</ExternalLink> : <span key={key} className="faint">{label} not published</span>
        })}
        {shownGist && <ExternalLink href={shownGist}>Gist</ExternalLink>}
        <span className="final-cost">
          readout cost <b>{money(readout.cost.readoutUsd)}</b> · run cost <b>{money(readout.cost.runUsd)}</b>
        </span>
      </p>

      <h4>Deliverables</h4>
      {readout.deliverables.length === 0 ? (
        <p className="faint final-none">The run declared no deliverables.</p>
      ) : (
        <ul className="final-files" data-readout-deliverables>
          {readout.deliverables.map((item) => {
            const href = externalHref(item.url)
            return (
              <li className="final-file final-deliverable" key={item.id} data-deliverable={item.id}>
                <span className={`state-pill ${item.present === true ? 'state-ok' : item.present === false ? 'state-fail' : 'state-unknown'}`}>
                  {item.present === true ? 'present' : item.present === false ? 'missing' : 'unknown'}
                </span>
                {href ? <ExternalLink href={href}>{item.id}</ExternalLink> : <b>{item.id}</b>}
                {item.kind && <span className="final-label">{item.kind}</span>}
                {item.path && <span className="mono final-path">{item.path}</span>}
                <span className="final-size">{byteSize(item.bytes)}</span>
                {item.bar && <span className="final-bar faint">Bar: {item.bar}</span>}
              </li>
            )
          })}
        </ul>
      )}

      <h4>Hypotheses</h4>
      {readout.verdicts.length === 0 ? (
        <p className="faint final-none">No hypothesis verdicts were recorded.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table final-table" data-readout-verdicts>
            <thead>
              <tr><th>Hypothesis and evidence</th><th>Verdict</th></tr>
            </thead>
            <tbody>
              {readout.verdicts.map((item) => {
                const view = verdictView(item.verdict)
                return (
                  <tr key={item.id} data-verdict={item.id}>
                    <td>
                      <b className="mono">{item.id}</b> {item.statement}
                      {item.evidence && <div className="final-evidence faint"><Clamped text={item.evidence} /></div>}
                    </td>
                    <td className="final-nowrap"><span className={`state-pill ${view.tone}`}>{view.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <h4>Judges</h4>
      {readout.judges.length === 0 ? (
        <p className="faint final-none">No judge scored this run.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table final-table" data-readout-judges>
            <thead>
              <tr><th>Category and reasons</th><th className="num">Score</th><th>Basis</th></tr>
            </thead>
            <tbody>
              {readout.judges.map((item) => (
                <tr key={item.category} data-judge={item.category}>
                  <td>
                    <b>{item.category}</b>
                    {item.summary && <div className="final-evidence faint"><Clamped text={item.summary} /></div>}
                  </td>
                  <td className={`num${item.score === null ? ' unknown' : ''}`}>{scoreLabel(item.score, item.max)}</td>
                  <td className="final-nowrap">
                    <span className={`state-pill ${item.calibrated === true ? 'state-ok' : 'state-unknown'}`}>{judgeBasis(item.calibrated)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** What the run was asked to deliver and whether it did. Older run documents carry no field, and show nothing. */
export function FinalOutputPanel({ output }: { output: FinalOutput | null | undefined }) {
  if (!output) return null
  const declared = output.declared
  const tone = output.status === 'delivered' ? 'state-ok' : output.status === 'not-delivered' ? 'state-fail' : 'state-unknown'
  return (
    <section className="ws-final" aria-label="Final output" data-final-output={output.status}>
      <header className="ws-final-head">
        <h2>Final output</h2>
        {declared && <span className={`state-pill ${tone}`} data-final-status>{deliveryLabel(output.status)}</span>}
        {output.checkedAt && <span className="faint final-checked">checked {when(output.checkedAt)}</span>}
      </header>
      {output.readout && <ReadoutSection readout={output.readout} />}
      {declared ? (
        <>
          <p className="final-declared">
            {declared.path && <span className="mono final-path">{declared.path}</span>}
            {declared.description && <span className="final-description">{declared.description}</span>}
            {!declared.path && !declared.description && <span className="faint">Declared in {declared.field}, without a path or description.</span>}
            <span className="faint final-source">declared by the {declared.source === 'deliverable-check' ? 'deliverable check' : 'run input'} ({declared.field})</span>
          </p>
          <DeliveredFiles files={output.files} />
        </>
      ) : (
        <>
          <p className="final-declared faint">No final output declared</p>
          {output.rootOutput && (
            <ul className="final-files"><FileRow file={output.rootOutput} label="root agent's last output" /></ul>
          )}
        </>
      )}
    </section>
  )
}
