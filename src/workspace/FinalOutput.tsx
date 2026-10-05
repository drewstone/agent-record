import type { FinalOutput, OutputFile } from '../workspace.js'
import { byteSize, deliveryLabel, sameOriginHref } from './final-output.js'
import { when } from './data.js'

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
      {declared ? (
        <>
          <p className="final-declared">
            {declared.path && <span className="mono final-path">{declared.path}</span>}
            {declared.description && <span className="final-description">{declared.description}</span>}
            {!declared.path && !declared.description && <span className="faint">Declared in {declared.field}, without a path or description.</span>}
            <span className="faint final-source">declared by the {declared.source === 'deliverable-check' ? 'deliverable check' : 'run input'} ({declared.field})</span>
          </p>
          {output.files.length > 0 ? (
            <ul className="final-files">{output.files.map((file) => <FileRow key={file.path} file={file} />)}</ul>
          ) : (
            <p className="faint final-none">No delivered file is recorded.</p>
          )}
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
