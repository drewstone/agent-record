import type { FinalOutput, OutputFile, ProgressBrief, Readout } from '../workspace.js'

/**
 * A run's outputs, read for the outputs view and the version comparison: each file the run delivered by its kind,
 * grouped under the readout deliverable that names it, and two runs' outputs compared deliverable by deliverable.
 *
 * Types only, so the node tests load this file directly. Nothing here runs a run's output: files are read as text or
 * drawn as images, never executed.
 */

export type OutputKind = 'markdown' | 'image' | 'csv' | 'json' | 'html' | 'code' | 'other'
export type Deliverable = Readout['deliverables'][number]

const EXTENSIONS: Record<string, OutputKind> = {
  md: 'markdown', markdown: 'markdown',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image',
  csv: 'csv', tsv: 'csv',
  json: 'json', jsonl: 'json',
  html: 'html', htm: 'html',
  py: 'code', ts: 'code', tsx: 'code', js: 'code', mjs: 'code', jsx: 'code', sh: 'code', rs: 'code', go: 'code', sql: 'code',
  r: 'code', jl: 'code', toml: 'code', yaml: 'code', yml: 'code', txt: 'code', ipynb: 'json', tex: 'code', c: 'code', h: 'code',
  cpp: 'code', java: 'code', rb: 'code', lean: 'code', m: 'code',
}

/** A file's kind from its name; the server's `kind`, when it sent one, wins. */
export function outputKind(file: Pick<OutputFile, 'path'> & { kind?: unknown }): OutputKind {
  if (typeof file.kind === 'string' && file.kind in KIND_LABEL) return file.kind as OutputKind
  const name = file.path.split('/').at(-1) ?? ''
  const extension = name.includes('.') ? name.split('.').at(-1)!.toLowerCase() : ''
  return EXTENSIONS[extension] ?? 'other'
}

export const KIND_LABEL: Record<OutputKind, string> = {
  markdown: 'document', image: 'image', csv: 'table', json: 'data', html: 'HTML', code: 'code', other: 'file',
}

const isFolder = (path: string | null | undefined): path is string => !!path && path.endsWith('/')
const trimSlash = (path: string) => path.replace(/\/+$/, '')

/** One readout deliverable with the files that fall under it, or the files no deliverable names (`deliverable` null). */
export interface OutputGroup {
  key: string
  deliverable: Deliverable | null
  /** The deliverable names a folder; its files are the ones under it. */
  folder: boolean
  /** The deliverable names the whole declared folder, so it claims no file of its own. */
  whole: boolean
  files: OutputFile[]
}

/**
 * The outputs grouped for reading: each deliverable the readout names, in its order, holding the files under it (a file
 * goes to the most specific deliverable that names it), then the declared folder's other files. A deliverable that names
 * the whole declared folder (a bar like "runnable code files") claims none, so its verdict is not read as a list of files.
 */
export function groupOutputs(output: FinalOutput | null | undefined): OutputGroup[] {
  if (!output) return []
  const files = output.files
  const deliverables = output.readout?.status !== 'pending' ? (output.readout?.deliverables ?? []) : []
  const root = output.declared?.path ? trimSlash(output.declared.path) : null
  const groups: OutputGroup[] = deliverables.map((deliverable) => ({
    key: deliverable.id,
    deliverable,
    folder: isFolder(deliverable.path),
    whole: isFolder(deliverable.path) && root !== null && trimSlash(deliverable.path) === root,
    files: [],
  }))
  const claimants = groups.filter((group) => group.deliverable?.path && !group.whole)
  const rest: OutputFile[] = []
  for (const file of files) {
    let best: OutputGroup | null = null
    let depth = -1
    for (const group of claimants) {
      const path = group.deliverable!.path!
      const matches = group.folder ? file.path.startsWith(path) : file.path === path
      const length = group.folder ? path.length : Number.MAX_SAFE_INTEGER
      if (matches && length > depth) {
        best = group
        depth = length
      }
    }
    if (best) best.files.push(file)
    else rest.push(file)
  }
  if (rest.length) groups.push({ key: '', deliverable: null, folder: true, whole: false, files: rest })
  return groups
}

/** A file's path inside its group: under a folder deliverable, relative to it; otherwise relative to the declared folder. */
export function pathInGroup(group: OutputGroup, file: OutputFile, root: string | null): string {
  const base = group.folder && group.deliverable?.path ? group.deliverable.path : root ? `${trimSlash(root)}/` : ''
  return base && file.path.startsWith(base) ? file.path.slice(base.length) : file.path
}

export type FileChange = 'added' | 'removed' | 'changed' | 'same' | 'unknown'

export interface FilePair {
  /** The file's name inside the deliverable; a single-file deliverable keeps one row even when its file was renamed. */
  name: string
  before: OutputFile | null
  after: OutputFile | null
  change: FileChange
}

export interface DeliverableChange {
  key: string
  label: string
  status: 'both' | 'added' | 'removed'
  before: OutputGroup | null
  after: OutputGroup | null
  files: FilePair[]
  counts: Record<FileChange, number>
}

function pairChange(before: OutputFile | null, after: OutputFile | null): FileChange {
  if (!before) return 'added'
  if (!after) return 'removed'
  if (before.sha256 && after.sha256) return before.sha256 === after.sha256 ? 'same' : 'changed'
  if (before.bytes !== null && after.bytes !== null && before.bytes !== after.bytes) return 'changed'
  return 'unknown'
}

/**
 * Two runs' outputs compared deliverable by deliverable (matched by the readout's deliverable id; the declared folder's
 * other files by their path in it): which files were added, removed or changed. A file without a hash on either side and
 * the same size is `unknown`, never `same`.
 */
export function compareOutputs(before: FinalOutput | null | undefined, after: FinalOutput | null | undefined): DeliverableChange[] {
  const left = groupOutputs(before)
  const right = groupOutputs(after)
  const rootOf = (output: FinalOutput | null | undefined) => output?.declared?.path ?? null
  const keys = [...new Set([...right.map((group) => group.key), ...left.map((group) => group.key)])]
  return keys.map((key) => {
    const a = left.find((group) => group.key === key) ?? null
    const b = right.find((group) => group.key === key) ?? null
    const files: FilePair[] = []
    const single = (a && !a.folder) || (b && !b.folder)
    if (single) {
      const x = a?.files[0] ?? null
      const y = b?.files[0] ?? null
      if (x || y) files.push({ name: (y ?? x)!.path.split('/').at(-1)!, before: x, after: y, change: pairChange(x, y) })
    } else {
      const named = (group: OutputGroup | null, output: FinalOutput | null | undefined) =>
        new Map((group?.files ?? []).map((file) => [pathInGroup(group!, file, rootOf(output)), file]))
      const x = named(a, before)
      const y = named(b, after)
      for (const name of [...new Set([...y.keys(), ...x.keys()])].sort())
        files.push({ name, before: x.get(name) ?? null, after: y.get(name) ?? null, change: pairChange(x.get(name) ?? null, y.get(name) ?? null) })
    }
    const counts: Record<FileChange, number> = { added: 0, removed: 0, changed: 0, same: 0, unknown: 0 }
    for (const pair of files) counts[pair.change]++
    return { key, label: key || 'other files', status: a && b ? 'both' : b ? 'added' : 'removed', before: a, after: b, files, counts }
  })
}

/** CSV or TSV text as rows of cells: quoted cells may hold the separator, quotes ("") and line breaks. */
export function parseDelimited(text: string, separator = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && cell === '') quoted = true
    else if (char === separator) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** What the observer's brief says each agent is doing, by the agent's record id. */
export function briefLines(brief: ProgressBrief | null | undefined, runId: string, ids: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  if (!brief) return out
  const known = new Set(ids)
  for (const member of brief.team) {
    if (!member.doing) continue
    const id = known.has(member.node) ? member.node : known.has(`${runId}:${member.node}`) ? `${runId}:${member.node}` : member.node === 'root' && known.has(runId) ? runId : null
    if (id) out.set(id, member.doing)
  }
  return out
}
