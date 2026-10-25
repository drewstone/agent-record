import { type ReactNode, useState } from 'react'
import type { RunDocument } from '../workspace-model.js'
import { RunArtifacts } from './RunArtifacts.js'

/**
 * Code branches and retained research artifacts share the run's one editor frame. Without code the Code choice is gone
 * and the artifacts open (the answer first). Which source and which file are open is this pane's state, not the route: a
 * file click stays on the page (lead 2026-10-25 gate 3), and so do an artifact's version, comparison and view.
 */
export function RunFilesPane({ api, doc, code, codeUnavailable }: { api: string; doc: RunDocument; code: ReactNode; codeUnavailable: string | null }) {
  const [picked, setSource] = useState<'code' | 'artifacts'>('code')
  const [file, setFile] = useState<string | null>(null)
  const source = codeUnavailable ? 'artifacts' : picked
  return <div className="run-files-pane" data-run-files-pane>
    {/* One source is no choice: without code the switch was a 69 px row above the answer (root 2026-10-25, phone). */}
    {!codeUnavailable && <div className="rw-file-modes run-file-sources" role="group" aria-label="File source">
      <button type="button" aria-pressed={source === 'code'} onClick={() => setSource('code')}>Code</button>
      <button type="button" aria-pressed={source === 'artifacts'} onClick={() => setSource('artifacts')}>Retained artifacts</button>
    </div>}
    {source === 'code' ? code : <RunArtifacts api={api} doc={doc} selected={file} onSelect={setFile} embedded />}
  </div>
}
