import { resolveFilePreviewKind } from '@tangle-network/sandbox-ui/files'
import { DiffView } from '@tangle-network/sandbox-ui/workbench'
import { useDocument } from './data.js'
import { useFileText } from './use-file-text.js'

/**
 * One file of the run's code at a ref (a release tag or branch), read the way the root's 10478 review asked: the tree is
 * read first and its commit bound to the blob request (`expectedCommit`, answered by `X-Workspace-Commit`), so a moved
 * ref is an error, not another version under the old name. A file is absent only when the complete tree at that ref
 * lacks it; a failed read, an incomplete tree or an unverified answer is an error and never an empty file.
 */
export type RefFile = { state: 'idle' | 'loading' } | { state: 'error'; error: string } | { state: 'absent'; commit: string } | { state: 'binary'; href: string; commit: string } | { state: 'ready'; text: string; commit: string }

/** Kinds the shared previews classify as not text: the blob route answers text/plain for every file, so the kind decides. */
const BINARY = new Set(['image', 'pdf', 'video', 'audio', 'spreadsheet', 'binary'])

export type RefTree = { commit: string; paths: string[]; cut: boolean }

/**
 * `pinned` is the tree the caller already shows: the file is read at that tree's commit, never at a second read of a
 * ref that may have moved in between, so the bytes always belong to the visible listing.
 */
export function useRefFile(runUrl: string, ref: string | null, path: string | null, pinned?: RefTree | null): RefFile {
  const fetched = useDocument<RefTree>(!pinned && ref && path ? `${runUrl}/tree?ref=${encodeURIComponent(ref)}` : null)
  const tree = pinned ? { data: pinned, error: undefined } : fetched
  const listed = Boolean(tree.data && path && tree.data.paths.includes(path))
  const href = tree.data && listed && ref && path ? `${runUrl}/blob?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}&expectedCommit=${tree.data.commit}` : null
  const binary = Boolean(path && BINARY.has(resolveFilePreviewKind(path)))
  const file = useFileText(binary ? null : href, tree.data?.commit)
  if (!ref || !path) return { state: 'idle' }
  if (tree.error) return { state: 'error', error: `The code at ${ref} is unavailable: ${tree.error}` }
  if (!tree.data) return { state: 'loading' }
  if (!listed) return tree.data.cut ? { state: 'error', error: `The file list at ${ref} is incomplete, so this file's absence there cannot be shown.` } : { state: 'absent', commit: tree.data.commit }
  if (binary) return { state: 'binary', href: href!, commit: tree.data.commit }
  if (file.error) return { state: 'error', error: file.error }
  if (file.text === undefined) return { state: 'loading' }
  // A NUL or an undecodable byte means it is not UTF-8 text, whatever its name says: no garbled preview or text diff.
  if (/[\u0000\uFFFD]/.test(file.text)) return { state: 'binary', href: href!, commit: tree.data.commit }
  return { state: 'ready', text: file.text, commit: tree.data.commit }
}

/** A file's change between two refs; `base` null means there is no earlier release, so every line is new. */
export function RefDiff({ runUrl, base, head, path, headTree }: { runUrl: string; base: string | null; head: string; path: string; headTree?: RefTree | null }) {
  const before = useRefFile(runUrl, base, path)
  const after = useRefFile(runUrl, head, path, headTree)
  const failed = [before, after].find((side): side is { state: 'error'; error: string } => side.state === 'error')
  if (failed) return <p className="rj-muted" role="alert">{failed.error}</p>
  if (after.state === 'loading' || before.state === 'loading' || after.state === 'idle') return <p className="rj-muted" role="status">Reading {path}…</p>
  // Deletion or addition is claimed only against a side that has the file; absent from both is said plainly.
  if (after.state === 'absent' && (before.state === 'absent' || before.state === 'idle')) return <p className="rj-muted" role="alert">This file is in neither {base ?? 'an earlier release'} nor {head}.</p>
  const binary = [before, after].find((side): side is { state: 'binary'; href: string; commit: string } => side.state === 'binary')
  if (binary) return <p className="rj-muted">A binary file has no text diff. <a href={binary.href} download={path.split('/').pop()}>Download it at {binary.commit.slice(0, 12)}</a>.</p>
  const added = !base || before.state === 'absent'
  const removed = after.state === 'absent'
  return (
    <>
      {(added || removed) && <p className="rj-muted">{removed ? `Not in ${head}: removed since ${base}.` : base ? `Not in ${base}: added in ${head}.` : `No earlier release: every line is new in ${head}.`}</p>}
      <div className="rj-diff"><DiffView filename={path} baseline={before.state === 'ready' ? before.text : ''} current={after.state === 'ready' ? after.text : ''} defaultWrap /></div>
    </>
  )
}
