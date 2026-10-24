import { DiffView } from '@tangle-network/sandbox-ui/workbench'
import { SharedFileUi } from './SharedFileUi.js'
import { RunArtifacts, type ArtifactNavigation } from './RunArtifacts.js'
import { FILE_PREVIEW_BYTES as DRAW_LIMIT, useFileText } from './use-file-text.js'
import { latestNumericGrade } from './scores-model.js'
import { useMemo, useState } from 'react'
import type { FinalOutput, HumanGrade, OutputFile, RunDocument } from '../workspace-model.js'
import { useDocument, when } from './data.js'
import { byteSize, deliveryLabel, externalHref, sameOriginHref } from './final-output.js'
import { compareOutputs, KIND_LABEL, groupOutputs, outputKind, pathInGroup, type DeliverableChange, type FilePair, type OutputGroup } from './outputs-model.js'
import type { Grading } from './FinalOutput.js'
import { ChartGallery, ChartPairsView, GradeControl } from './Scores.js'

const FILES_SHOWN = 12

const pageHref = (href: string | null | undefined) => (typeof window === 'undefined' ? null : sameOriginHref(href, window.location.href))

/**
 * The run's outputs in the drawer: each deliverable the readout names with the files under it, and the selected file
 * drawn by its kind. A link inside a delivered page opens the file it names when the run delivered it.
 */
export function OutputsView({ api, doc, grading, selected, onSelect, onClose, navigation }: { api?: string; doc: RunDocument; grading?: Grading; selected: string | null; onSelect: (path: string | null) => void; onClose: () => void; navigation?: ArtifactNavigation }) {
  const output = doc.finalOutput ?? null
  const groups = useMemo(() => groupOutputs(output), [output])
  const file = output?.files.find((item) => item.path === selected)
  const currentFeedback = !navigation?.version && !navigation?.identity && !navigation?.compare
  return <div className="outputs-view" data-outputs>
    <div className="drawer-head"><h2>Files and artifacts</h2><button type="button" className="ui-button" onClick={onClose}>Back to the run</button></div>
    {output?.fallback && <Fallback output={output} />}
    <RunArtifacts api={api ?? grading?.api ?? '/api/discovery'} doc={doc} selected={selected} onSelect={onSelect} navigation={navigation} />
    {file && currentFeedback && <GradesOf grades={output?.grades?.latest} kind="file" id={file.path} />}
    {file && currentFeedback && grading && <GradeControl api={grading.api} runId={grading.runId} target={{ kind: 'file', id: file.path }} label="Your grade of this file" current={latestNumericGrade(output?.grades?.latest, { kind: 'file', id: file.path })} onSaved={grading.onSaved} />}
    {file && !currentFeedback && <p className="output-note">File feedback applies to the current primary artifact. Return to its current version to view or submit a grade.</p>}
    {output?.readout?.charts?.length ? <section className="output-group"><h3>Charts</h3><ChartGallery charts={output.readout.charts} /></section> : null}
    {groups.length > 0 && <details className="output-requirements"><summary>Deliverable requirements and grades</summary>{groups.map((group) => <GroupView key={group.key || 'rest'} group={group} root={output?.declared?.path ?? null} onSelect={onSelect} grading={grading} grades={output?.grades?.latest} />)}</details>}
  </div>
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

function GroupView({ group, root, onSelect, grading, grades }: { group: OutputGroup; root: string | null; onSelect: (path: string) => void; grading?: Grading; grades?: readonly HumanGrade[] }) {
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
          <span className="state-pill tone-neutral">
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
      {deliverable && <GradesOf grades={grades} kind="deliverable" id={deliverable.id} />}
      {deliverable && grading && (
        <GradeControl
          api={grading.api}
          runId={grading.runId}
          target={{ kind: 'deliverable', id: deliverable.id }}
          label={`Your grade of ${deliverable.id}`}
          current={latestNumericGrade(grades, { kind: 'deliverable', id: deliverable.id })}
          onSaved={grading.onSaved}
        />
      )}
    </section>
  )
}

/** People's latest grades of one output, each with its comment. */
function GradesOf({ grades, kind, id }: { grades?: readonly HumanGrade[]; kind: HumanGrade['target']['kind']; id: string }) {
  const mine = (grades ?? []).filter((grade) => grade.target.kind === kind && grade.target.id === id)
  if (!mine.length) return null
  return (
    <ul className="grades-of" data-grades-of={kind}>
      {mine.map((grade) => (
        <li key={`${grade.by}:${grade.category}`}>
          <b>{grade.score} of 100</b> <span className="faint">{grade.category === 'overall' ? '' : `${grade.category} · `}{grade.by} · {when(grade.at)}</span>
          {grade.comment && <span> {grade.comment}</span>}
        </li>
      ))}
    </ul>
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

// ------------------------------------------------------------------------------------------------ version edges

const CHANGE_LABEL: Record<FilePair['change'], string> = { added: 'added', removed: 'removed', changed: 'changed', same: 'same', unknown: 'unknown' }

/**
 * What the delivered output changed between two versions of a play: deliverable by deliverable, which files were added,
 * removed or changed, each changed text one click from its line diff and each changed image drawn before and after.
 * A comparison of the files, never a measured effect.
 */
export function OutputChanges({ api, beforeRunId, after: afterDoc, beforeLabel, afterLabel }: { api: string; beforeRunId: string; after: RunDocument | null; beforeLabel: string; afterLabel: string }) {
  const before = useDocument<RunDocument>(`${api}/runs/${encodeURIComponent(beforeRunId)}`)
  const after = { data: afterDoc ?? undefined, error: undefined as string | undefined }
  const afterRunId = afterDoc?.run.id ?? ''
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
      <details className="output-change" data-output-change="charts">
        <summary>
          <b>charts</b>
          <span className="output-change-counts"> {before.data?.finalOutput?.readout?.charts?.length ?? 0} → {after.data?.finalOutput?.readout?.charts?.length ?? 0} drawn by the readouts</span>
        </summary>
        <ChartPairsView before={before.data?.finalOutput?.readout?.charts} after={after.data?.finalOutput?.readout?.charts} beforeLabel={beforeLabel} afterLabel={afterLabel} />
      </details>
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
  const a = useFileText(tooLarge ? null : pageHref(before.href))
  const b = useFileText(tooLarge ? null : pageHref(after.href))
  if (tooLarge) return <p className="faint">Too large to compare here.</p>
  if (a.error || b.error) return <p className="faint" role="alert">{a.error ?? b.error}</p>
  if (a.text === undefined || b.text === undefined) return <p className="faint">Loading both files…</p>
  return <SharedFileUi>{(theme) => <DiffView filename={after.path} baseline={a.text!} current={b.text!} themeType={theme} defaultWrap />}</SharedFileUi>
}
