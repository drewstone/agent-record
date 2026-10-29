import { useEffect, useState } from 'react'
import { SandboxArtifactPane } from '@tangle-network/sandbox-ui/workbench'
import { useDocument } from './data.js'

type Inspection = {
  context?: { at: string; event: { text?: string } }[]
  coverage: { status: 'complete' | 'partial' | 'missing'; source: string; reason?: string }
  files?: { scope: 'workspace' | 'none'; complete: boolean; reason?: string; entries: { path: string; sha256: string; byteLength: number }[] }
  file?: { path: string; content: string; sha256: string; byteLength: number; before?: { content: string; sha256: string; byteLength: number; source: { kind: string; ref: string } } }
}

/** The graph, conversation and files share one selected agent and one product-owned API. */
export function useLiveInspection(url: string | undefined, live: boolean, fetcher?: typeof globalThis.fetch) {
  const inventory = useDocument<Inspection>(url ?? null, live ? 3000 : undefined, false, fetcher)
  const [selected, select] = useState<string>()
  const [download, setDownload] = useState<{ key: string; href: string }>()
  const files = inventory.data?.files?.entries ?? []
  const entry = files.find((file) => file.path === selected) ?? files[0]
  const fileUrl = entry && url ? `${url}/file?path=${encodeURIComponent(entry.path)}` : null
  const content = useDocument<Inspection>(fileUrl, live ? 3000 : undefined, false, fetcher)
  const file = content.data?.file
  const valid = file && entry && file.path === entry.path && file.sha256 === entry.sha256 && file.byteLength === entry.byteLength
  const fileKey = valid ? `${entry.path}:${entry.sha256}` : undefined
  useEffect(() => {
    if (!fileKey || !file) return
    const href = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }))
    setDownload({ key: fileKey, href })
    return () => URL.revokeObjectURL(href)
  }, [fileKey, file?.content])
  const coverage = inventory.data?.coverage
  const scoreboard = inventory.status === 404 ? undefined : coverage ? (
    <details className="ws-status" open={coverage.status !== 'complete'} data-capture-status={coverage.status}>
      <summary>{coverage.status === 'complete' ? 'Conversation retained' : 'Conversation incomplete'}</summary>
      <p>{coverage.reason ?? coverage.source}</p>{!!inventory.data?.context?.length && <details><summary>Recorded context</summary>{inventory.data.context.map((row, index) => <pre className="ws-code" key={`${row.at}:${index}`}>{row.event.text}</pre>)}</details>}{inventory.data?.files?.scope === 'none' && <p>{inventory.data.files.reason ?? 'No workspace inventory was captured.'}</p>}
    </details>
  ) : inventory.error ? <p className="ws-status" role="alert">Conversation inspection unavailable: {inventory.error}</p> : undefined
  return {
    scoreboard: <>{scoreboard}{inventory.data?.files && !inventory.data.files.complete && <p className="ws-status" role="alert">Workspace inventory incomplete: {inventory.data.files.reason ?? 'Some files could not be retained.'}</p>}</>,
    files: entry ? (
      <section aria-label="Retained files" className="flex min-h-0 flex-1 flex-col" data-file-scope={inventory.data?.files?.scope} data-file-complete={inventory.data?.files?.complete} data-file={entry.path} data-file-hash={entry.sha256}>
        {valid ? <>
          <SandboxArtifactPane className="min-h-0 flex-1" artifact={{ id: `${entry.path}:${entry.sha256}`, path: entry.path, filename: entry.path.split('/').at(-1) ?? entry.path, content: file.content, ...(file.before ? { baselineContent: file.before.content } : {}) }} paths={files.map((item) => item.path)} showTree onFileSelect={select} />
          <details className="ws-status"><summary>Provenance</summary><code>{entry.sha256}</code>{file.before && <p>Compared with {file.before.source.kind} <code>{file.before.source.ref}</code>: <code>{file.before.sha256}</code></p>}<p><a href={download && download.key === fileKey ? download.href : undefined} download={entry.path.split('/').at(-1)}>Download</a></p></details>
        </> : <p className="ws-status" role={content.loading ? 'status' : 'alert'}>{content.loading ? `Reading ${entry.path}…` : `This retained file is unavailable: ${content.error ?? 'its content identity did not match the inventory'}`}</p>}
      </section>
    ) : undefined,
  }
}
