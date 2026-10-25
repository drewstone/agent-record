import type { ReactNode } from 'react'
import type { RunDocument } from '../workspace-model.js'
import { RunArtifacts } from './RunArtifacts.js'
import { artifactNavigation, useSearch } from './navigation.js'

/**
 * Code branches and retained research artifacts share the run's one files pane. Without code the Code choice is disabled
 * and says why (the workspace's own reason), so it can never open a blank pane.
 */
export function RunFilesPane({ api, doc, code, codeUnavailable }: { api: string; doc: RunDocument; code: ReactNode; codeUnavailable: string | null }) {
  const [params, update] = useSearch()
  const source = codeUnavailable || params.get('fileSource') === 'artifacts' ? 'artifacts' : 'code'
  const navigation = artifactNavigation(params, update)
  return <div className="run-files-pane" data-run-files-pane>
    <div className="rw-file-modes run-file-sources" role="group" aria-label="File source">
      <button type="button" aria-pressed={source === 'code'} disabled={Boolean(codeUnavailable)} title={codeUnavailable ?? undefined} onClick={() => update({ fileSource: 'code', file: null, fileIdentity: null, fileView: null })}>Code</button>
      <button type="button" aria-pressed={source === 'artifacts'} onClick={() => update({ fileSource: 'artifacts', file: null, fileIdentity: null, fileView: null })}>Retained artifacts</button>
    </div>
    {source === 'code' ? code : <RunArtifacts api={api} doc={doc} selected={params.get('file')} onSelect={(file) => update({ file, fileSource: 'artifacts', fileIdentity: null })} navigation={navigation} embedded />}
  </div>
}
