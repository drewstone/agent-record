/**
 * OpenCode conversations: a `native-trajectory.json` document, or the root sessions of a captured SQLite store
 * (`.local/share/opencode/opencode.db`). Both hold session, message and part rows; each part is anchored by a JSON
 * Pointer (`/parts/<index>/data` in a document, `/part/<id>/data` in a store).
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Ingest, NodeDraft } from './agent-runtime.js'
import { categoryOf, hexOf, isoAt, num, pointerOf, str, type Json, type SessionReader } from './harness-reader.js'

const OPENCODE_STORE = /(^|\/)\.local\/share\/opencode\/opencode\.db$/

/**
 * The OpenCode store in a node's latest native-index copy, and the ids of its root sessions: one SQLite store holds
 * every session of its HOME (a subagent's session names its parent, and is not this node's conversation).
 */
export function nativeStore(ingest: Ingest, node: NodeDraft): { rel: string; abs: string; sessionIds: string[] } | null {
  const indexed = ingest.nativeIndex().get(node.id)
  const hex = hexOf(indexed?.snapshot?.archive)
  const dir = hex ? ingest.nativeCacheDir(hex) : undefined
  const sessions = (Array.isArray(indexed?.native?.sessions) ? indexed.native.sessions : []).filter(
    (session: Json) => typeof session?.path === 'string' && OPENCODE_STORE.test(session.path) && typeof session.sandboxSessionId === 'string' && typeof session.rootScope === 'string',
  )
  if (!dir || !sessions.length) return null
  const relInside = ingest.nativePath(sessions[0])
  const abs = join(dir, relInside)
  if (!existsSync(abs)) {
    ingest.gaps.push({ nodeId: node.id, code: 'no-transcript:native-file-missing', detail: `${relInside} is not in archive ${hex}` })
    return null
  }
  const sessionIds = sessions.filter((session: Json) => ingest.nativePath(session) === relInside && !session.parentNativeSessionId && typeof session.nativeSessionId === 'string').map((session: Json) => session.nativeSessionId as string)
  return { rel: `native:${hex}/${relInside}`, abs, sessionIds }
}

/** A bundle's OpenCode trajectory, one node per session id (or the trajectory's directory). */
export const readOpenCodeBundle: SessionReader = (main, session) => {
  const id = `opencode:${session.sessionId ?? basename(dirname(session.path))}`
  const node = main.ensureNode(id, { label: session.label ?? id })
  readOpenCode(main, node, session.path)
  return node
}

/** A native-trajectory.json document: false when it is not one, or another node already holds it. */
export function readOpenCode(ingest: Ingest, node: NodeDraft, rel = 'native-trajectory.json') {
  let doc: Json
  let entry
  try {
    entry = ingest.file(rel)
    doc = JSON.parse(entry.text)
  } catch {
    return false
  }
  if (!Array.isArray(doc?.messages) || !Array.isArray(doc?.parts)) return false
  if (!ingest.claim(entry.sha256, node.id, rel)) return false
  ingest.fileSource(rel)
  projectOpenCode(ingest, node, doc, rel, entry.sha256, (_, index) => pointerOf('parts', index, 'data'))
  return true
}

/** Read captured root-session rows without changing their bytes; part anchors name `/part/<id>/data`.
 * A WAL needs a private copy; a checkpointed database can be opened as immutable. */
export function readOpenCodeStore(ingest: Ingest, node: NodeDraft, store: { rel: string; abs: string; sessionIds: string[] }) {
  const entry = ingest.file(store.rel, store.abs)
  if (!store.sessionIds.length || !ingest.claim(entry.sha256, node.id, store.rel)) return false
  const sqlite = process.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined
  if (!sqlite) {
    ingest.gaps.push({ nodeId: node.id, code: 'no-transcript:opencode-store-unreadable', detail: 'this Node has no node:sqlite' })
    return false
  }
  const copy = existsSync(`${store.abs}-wal`) ? mkdtempSync(join(tmpdir(), 'agent-record-opencode-')) : null
  let doc: Json
  try {
    if (copy) for (const suffix of ['', '-wal', '-shm']) if (existsSync(store.abs + suffix)) copyFileSync(store.abs + suffix, join(copy, `opencode.db${suffix}`))
    const db = new sqlite.DatabaseSync(copy ? join(copy, 'opencode.db') : `${pathToFileURL(store.abs).href}?immutable=1`, { readOnly: true })
    try {
      const ids = JSON.stringify(store.sessionIds)
      const where = 'session_id IN (SELECT value FROM json_each(?))'
      doc = {
        session: db.prepare('SELECT * FROM session WHERE id IN (SELECT value FROM json_each(?)) ORDER BY time_created, id').all(ids),
        messages: db.prepare(`SELECT id, session_id, time_created, data FROM message WHERE ${where} ORDER BY time_created, id`).all(ids),
        parts: db.prepare(`SELECT id, message_id, session_id, time_created, data FROM part WHERE ${where} ORDER BY time_created, id`).all(ids),
      }
    } finally {
      db.close()
    }
  } catch (error) {
    ingest.gaps.push({ nodeId: node.id, code: 'no-transcript:opencode-store-unreadable', detail: `${ingest.sourcePath(store.rel)}: ${String((error as Error)?.message ?? error).slice(0, 200)}` })
    return false
  } finally {
    if (copy) rmSync(copy, { recursive: true, force: true })
  }
  ingest.fileSource(store.rel, store.abs)
  projectOpenCode(ingest, node, doc, store.rel, entry.sha256, (part) => pointerOf('part', str(part.id), 'data'))
  return true
}

/** Project an OpenCode trajectory's rows (session, messages, parts) onto `node`; `pointer` anchors each part. */
function projectOpenCode(ingest: Ingest, node: NodeDraft, doc: Json, rel: string, sha256: string, pointer: (part: Json, index: number) => string) {
  const session = Array.isArray(doc.session) ? doc.session[0] : doc.session
  if (session?.model) {
    try {
      const model = typeof session.model === 'string' ? JSON.parse(session.model) : session.model
      if (typeof model?.id === 'string') node.model ??= [model.providerID, model.id].filter(Boolean).join('/')
    } catch {
      /* keep the declared model */
    }
  }
  if (typeof session?.id === 'string') node.nativeSessionId ??= session.id
  node.harness ??= 'opencode'
  const roles = new Map<string, Json>()
  doc.messages.forEach((message: Json) => {
    try {
      roles.set(message.id, typeof message.data === 'string' ? JSON.parse(message.data) : message.data)
    } catch {
      roles.set(message.id, {})
    }
  })
  const parts = doc.parts
    .map((part: Json, index: number) => ({ part, index }))
    .sort((a: Json, b: Json) => (a.part.time_created ?? 0) - (b.part.time_created ?? 0) || a.index - b.index)
  const lastOfMessage = new Map<string, Json>()
  let unparsable = 0
  let untimed = 0
  for (const { part, index } of parts) {
    let data: Json
    try {
      data = typeof part.data === 'string' ? JSON.parse(part.data) : part.data
    } catch {
      unparsable++
      continue
    }
    const message = roles.get(part.message_id) ?? {}
    const role = message.role === 'user' ? 'user' : 'assistant'
    const anchor = pointer(part, index)
    const source = { path: rel, sha256, pointer: anchor }
    const full = () => ingest.pointerSource(rel, anchor, part.data)
    const at = isoAt(data?.time?.start ?? part.time_created) ?? node.start
    if (!at) {
      untimed++
      continue
    }
    const native = typeof part.id === 'string' ? { nativeRecordId: part.id } : {}
    if (role === 'assistant' && typeof message.modelID === 'string') node.servedModel = [message.providerID, message.modelID].filter(Boolean).join('/')
    if ((data?.type === 'text' || data?.type === 'reasoning') && (str(data.text) || data.type === 'text')) {
      ingest.emit({
        node: node.id,
        at,
        kind: 'message',
        category: role === 'user' ? 'other' : 'reasoning',
        label: role,
        source,
        detail: { role, ...native, ...ingest.shown(data.type === 'text' ? 'publicText' : 'reasoning', str(data.text), full), ...(data.synthetic ? { synthetic: true } : {}) },
      })
      lastOfMessage.set(part.message_id, ingest.events.at(-1)!)
    } else if (data?.type === 'tool') {
      const state = data.state ?? {}
      const start = isoAt(state.time?.start) ?? at
      const end = isoAt(state.time?.end)
      const category = categoryOf(str(data.tool), state.input)
      const settled = state.status === 'completed' || state.status === 'error'
      ingest.emit({
        node: node.id,
        at: start,
        kind: 'message',
        category,
        label: `assistant · ${str(data.tool)}`,
        source: settled ? { ...source, item: 0 } : source,
        detail: { role: 'assistant', ...native, publicToolCalls: [{ id: str(data.callID || part.id), name: str(data.tool), ...ingest.shown('input', JSON.stringify(state.input ?? {}), full) }] },
      })
      lastOfMessage.set(part.message_id, ingest.events.at(-1)!)
      if (settled)
        ingest.emit({
          node: node.id,
          at: end ?? start,
          kind: 'tool-result',
          category,
          label: `tool result · ${str(data.tool)}`,
          source: { ...source, item: 1 },
          detail: {
            role: 'toolResult',
            ...native,
            toolCallId: str(data.callID || part.id),
            isError: state.status === 'error',
            ...ingest.shown('publicText', state.status === 'error' ? str(state.error) : str(state.output), full),
            ...(end && state.time?.start ? { durationMs: Math.max(0, Number(state.time.end) - Number(state.time.start)) } : {}),
          },
        })
    } else {
      const target = data?.type === 'step-finish' ? lastOfMessage.get(part.message_id) : undefined
      const tokens = data?.tokens
      if (target && tokens) {
        target.detail.usage = {
          input: num(tokens.input),
          output: num(tokens.output),
          cacheRead: num(tokens.cache?.read),
          cacheWrite: num(tokens.cache?.write),
          ...(num(tokens.reasoning) !== undefined ? { reasoning: tokens.reasoning } : {}),
        }
        if (num(data.cost) !== undefined && data.cost > 0) {
          target.detail.costListUsd = data.cost
          target.detail.usdKnown = false
        }
      }
      // Step boundaries, patches, files, snapshots and empty reasoning parts stay as what they are.
      ingest.emitRecord(node, at, source, { ...data, type: str(data?.type) || 'part' }, native)
    }
  }
  if (untimed) ingest.gaps.push({ nodeId: node.id, code: 'untimed-lines', detail: `${untimed} parts of ${ingest.sourcePath(rel)} carry no time` })
  node.capture = { channel: 'oc', status: unparsable ? 'lossy' : 'complete', reason: unparsable ? 'unparsable-parts' : null }
}
