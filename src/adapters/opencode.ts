/**
 * OpenCode conversations: a `native-trajectory.json` document, or the root sessions of a captured SQLite store
 * (`.local/share/opencode/opencode.db`). Both hold session, message and part rows; each part is anchored by a JSON
 * Pointer (`/parts/<index>/data` in a document, `/part/<id>/data` in a store).
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Ingest, NodeDraft } from './agent-runtime.js'
import { categoryOf, hexOf, isoAt, num, pointerOf, sha, toolObservation, str, type Json, type SessionReader } from './harness-reader.js'

interface NativeStore { rel: string; abs: string; sessionIds: string[]; usageSessionIds: string[] }

const OPENCODE_STORE = /(^|\/)\.local\/share\/opencode\/opencode\.db$/

/**
 * The OpenCode store in a node's latest native-index copy, and the ids of its root sessions: one SQLite store holds
 * every session of its HOME (a subagent's session names its parent, and is not this node's conversation).
 */
export function nativeStore(ingest: Ingest, node: NodeDraft): (NativeStore & { stores: NativeStore[] }) | null {
  const indexed = ingest.nativeIndex().get(node.id)
  const hex = hexOf(indexed?.snapshot?.archive)
  const dir = hex ? ingest.nativeCacheDir(hex) : undefined
  const sessions = (Array.isArray(indexed?.native?.sessions) ? indexed.native.sessions : []).filter(
    (session: Json) => typeof session?.path === 'string' && OPENCODE_STORE.test(session.path) && typeof session.sandboxSessionId === 'string' && typeof session.rootScope === 'string',
  )
  if (!dir || !sessions.length) return null
  const owned = new Set<string>(sessions.filter((session: Json) => !session.parentNativeSessionId && typeof session.nativeSessionId === 'string').map((session: Json) => session.nativeSessionId))
  for (let previous = -1; previous !== owned.size;) {
    previous = owned.size
    for (const session of sessions) if (owned.has(session.parentNativeSessionId) && typeof session.nativeSessionId === 'string') owned.add(session.nativeSessionId)
  }
  const stores = [...new Set<string>(sessions.map((session: Json) => ingest.nativePath(session)))].map(relInside => {
    const held = sessions.filter((session: Json) => ingest.nativePath(session) === relInside && typeof session.nativeSessionId === 'string')
    const sessionIds = held.filter((session: Json) => !session.parentNativeSessionId).map((session: Json) => session.nativeSessionId as string)
    return { rel: `native:${hex}/${relInside}`, abs: join(dir, relInside), sessionIds, usageSessionIds: [...new Set<string>(held.filter((session: Json) => owned.has(session.nativeSessionId)).map((session: Json) => session.nativeSessionId))] }
  })
  if (!existsSync(stores[0]!.abs)) {
    ingest.gaps.push({ nodeId: node.id, code: 'no-transcript:native-file-missing', detail: `${ingest.nativePath(sessions[0])} is not in archive ${hex}` })
  }
  return { ...stores[0]!, stores }
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

/** One SQL reader for captured transcripts and standalone usage, including committed WAL rows. */
function openCodeRows(path: string, sessionIds?: string[], usageOrder = false) {
  const sqlite = process.getBuiltinModule?.('node:sqlite') as typeof import('node:sqlite') | undefined
  if (!sqlite) throw new Error('SQLite is unavailable')
  const copy = existsSync(`${path}-wal`) ? mkdtempSync(join(tmpdir(), 'agent-record-opencode-')) : null
  try {
    if (copy) for (const suffix of ['', '-wal', '-shm']) if (existsSync(path + suffix)) copyFileSync(path + suffix, join(copy, `opencode.db${suffix}`))
    const input = copy ? join(copy, 'opencode.db') : path
    const db = new sqlite.DatabaseSync(copy ? input : `${pathToFileURL(input).href}?immutable=1`, { readOnly: true })
    try {
      const ids = sessionIds === undefined ? [] : [JSON.stringify(sessionIds)]
      const where = sessionIds === undefined ? '' : 'WHERE session_id IN (SELECT value FROM json_each(?))'
      const order = (table: string) => usageOrder && db.prepare(`PRAGMA table_info(${table})`).all().some((column: Json) => column.name === 'time_updated') ? 'time_updated, id' : 'time_created, id'
      const session = db.prepare(`SELECT * FROM session ${sessionIds === undefined ? '' : 'WHERE id IN (SELECT value FROM json_each(?))'} ORDER BY time_created, id`).all(...ids)
      return {
        session, messages: db.prepare(`SELECT id, session_id, time_created, data FROM message ${where} ORDER BY ${order('message')}`).all(...ids),
        parts: db.prepare(`SELECT id, message_id, session_id, time_created, data FROM part ${where} ORDER BY ${order('part')}`).all(...ids),
        usageComplete: sessionIds === undefined || sessionIds.length > 0 && session.length === new Set(sessionIds).size,
        sha256: sha(readFileSync(input)), ...(existsSync(`${input}-wal`) ? { walSha256: sha(readFileSync(`${input}-wal`)) } : {}),
      }
    } finally { db.close() }
  } finally { if (copy) rmSync(copy, { recursive: true, force: true }) }
}

/** Read a caller-owned HOME store. Custody paths never enter the returned observations. */
export function readOpenCodeUsage(path: string, { sourcePath = 'opencode.db', sessionIds }: { sourcePath?: string; sessionIds?: string[] } = {}) {
  if (!sourcePath || sourcePath.startsWith('/') || /[?#@]/.test(sourcePath) || sourcePath.includes('\\') || sourcePath.split('/').includes('..') || /^(?!native:)[a-z][a-z0-9+.-]*:/i.test(sourcePath)) throw new Error('sourcePath must be a logical record path')
  try {
    const doc = openCodeRows(path, sessionIds, true)
    return observeUsage(doc, { path: sourcePath, sha256: doc.sha256, ...(doc.walSha256 ? { walSha256: doc.walSha256 } : {}) })
  } catch { return null }
}

/** Optional usage is independent of which conversation channel won. */
export function readOpenCodeStore(ingest: Ingest, node: NodeDraft, store: NonNullable<ReturnType<typeof nativeStore>>, usageOnly = false) {
  let served = false
  let complete = true
  for (const captured of store.stores) {
    const conversation = !usageOnly && captured.rel === store.rel && captured.sessionIds.length > 0
    try {
      const input = ingest.file(captured.rel, captured.abs)
      const rows = openCodeRows(captured.abs, captured.usageSessionIds)
      const claimed = conversation && ingest.claim(input.sha256, node.id, captured.rel)
      const doc = { ...rows, usageMessages: rows.messages, usageParts: rows.parts, usageSessions: rows.session,
        session: rows.session.filter((row: Json) => captured.sessionIds.includes(row.id)),
        messages: rows.messages.filter((row: Json) => captured.sessionIds.includes(row.session_id)),
        parts: rows.parts.filter((row: Json) => captured.sessionIds.includes(row.session_id)),
      }
      ingest.fileSource(captured.rel, captured.abs)
      projectOpenCode(ingest, node, doc, captured.rel, input.sha256, (part) => pointerOf('part', str(part.id), 'data'), !claimed)
      served ||= claimed
    } catch {
      complete = false
      ingest.gaps.push({ nodeId: node.id, code: conversation ? 'no-transcript:opencode-store-unreadable' : 'native-usage-source-unreadable', detail: `${ingest.sourcePath(captured.rel)}: captured OpenCode store could not be read` })
    }
  }
  if (!complete && node.nativeUsage) { node.nativeUsage.complete = false; node.nativeUsage.calls = null }
  return served
}

const UNPARSABLE = Symbol('unparsable OpenCode row')
function parseRows(rows: Json[]): Map<Json, Json> {
  return new Map(rows.map(row => { try { return [row, typeof row.data === 'string' ? JSON.parse(row.data) : row.data] } catch { return [row, UNPARSABLE] } }))
}

/** Responses are observations, not extra events or a claim that their prices are known. */
function observeUsage(doc: Json, source: NonNullable<NodeDraft['nativeUsage']>['sources'][number], previous?: NodeDraft['nativeUsage'], parsed = parseRows(doc.usageMessages ?? doc.messages), parts = parseRows(doc.usageParts ?? doc.parts)) {
  let complete = doc.usageComplete !== false && previous?.complete !== false
  const responses = new Map((previous?.responses ?? []).map(response => [JSON.stringify([response.sessionId, response.id]), response]))
  for (const [row, message] of parsed) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) { complete = false; continue }
    if (message.role !== 'assistant') continue
    if (typeof row.id !== 'string') { complete = false; continue }
    const session = row.session_id ?? message.sessionID ?? (Array.isArray(doc.session) ? doc.session[0]?.id : doc.session?.id)
    const tokens = message.tokens
    const count = (value: unknown) => Math.trunc(Math.max(0, num(value) ?? 0))
    const response = {
      id: row.id, sessionId: typeof session === 'string' ? session : null,
      model: typeof message.modelID === 'string' ? message.modelID : null,
      provider: typeof message.providerID === 'string' ? message.providerID : null,
      tokens: tokens && typeof tokens === 'object' && !Array.isArray(tokens) && Object.keys(tokens).length ? {
        input: count(tokens.input), output: count(tokens.output) + count(tokens.reasoning),
        cacheRead: count(tokens.cache?.read), cacheWrite: count(tokens.cache?.write),
      } : null,
      cost: num(message.cost) ?? null, start: num(message.time?.created) ?? null, end: num(message.time?.completed) ?? null, at: num(message.time?.completed || message.time?.created) ?? null,
      failed: Boolean(message.error && (typeof message.error !== 'object' || Object.keys(message.error).length)), source,
    }
    if (response.sessionId === null) complete = false
    const key = JSON.stringify([response.sessionId, response.id]), held = responses.get(key)
    if (held && JSON.stringify({ ...held, source }) !== JSON.stringify(response)) complete = false
    else responses.set(key, response)
  }
  const tools = new Map((previous?.tools ?? []).map(tool => [JSON.stringify([tool.sessionId, tool.id]), tool]))
  for (const [row, part] of parts) {
    if (!part || typeof part !== 'object') { complete = false; continue }
    if (part.type !== 'tool') continue
    if (typeof row.id !== 'string') { complete = false; continue }
    const session = row.session_id ?? part.sessionID ?? (Array.isArray(doc.session) ? doc.session[0]?.id : doc.session?.id)
    const tool = { id: row.id, sessionId: typeof session === 'string' ? session : null, ...toolObservation(part.tool, part.state), source }
    const key = JSON.stringify([tool.sessionId, tool.id]), held = tools.get(key)
    if (held && JSON.stringify({ ...held, source }) !== JSON.stringify(tool)) complete = false
    else tools.set(key, tool)
    if (tool.sessionId === null) complete = false
  }
  const sources = new Map([...(previous?.sources ?? []), source].map(item => [JSON.stringify(item), item]))
  const sessions = doc.usageSessions ?? (Array.isArray(doc.session) ? doc.session : [doc.session])
  const sessionIds = [...new Set<string>([...(previous?.sessionIds ?? []), ...sessions.flatMap((row: Json) => typeof row?.id === 'string' ? [row.id] : [])])]
  const clocks = [previous?.opened, ...sessions.map((row: Json) => num(row?.time_created))].filter((at): at is number => typeof at === 'number' && Number.isFinite(at))
  return { complete, calls: complete ? responses.size : null, sources: [...sources.values()], responses: [...responses.values()], tools: [...tools.values()], sessionIds, opened: clocks.length ? Math.min(...clocks) : null }
}

/** Project an OpenCode trajectory's rows (session, messages, parts) onto `node`; `pointer` anchors each part. */
function projectOpenCode(ingest: Ingest, node: NodeDraft, doc: Json, rel: string, sha256: string, pointer: (part: Json, index: number) => string, usageOnly = false) {
  const parsed = parseRows(doc.usageMessages ?? doc.messages), parsedParts = parseRows(doc.usageParts ?? doc.parts)
  node.nativeUsage = observeUsage(doc, { path: ingest.sourcePath(rel), sha256, ...(doc.walSha256 ? { walSha256: doc.walSha256 } : {}) }, node.nativeUsage, parsed, parsedParts)
  if (usageOnly) return
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
  const roles = new Map<string, Json>(doc.messages.map((message: Json) => [message.id, parsed.get(message) ?? {}]))
  const parts = doc.parts
    .map((part: Json, index: number) => ({ part, index }))
    .sort((a: Json, b: Json) => (a.part.time_created ?? 0) - (b.part.time_created ?? 0) || a.index - b.index)
  const lastOfMessage = new Map<string, Json>()
  let unparsable = 0
  let untimed = 0
  for (const { part, index } of parts) {
    const data = parsedParts.get(part)
    if (data === UNPARSABLE) { unparsable++; continue }
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
