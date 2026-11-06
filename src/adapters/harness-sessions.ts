/**
 * Project normalized native sessions into the anchored record's viewer shape.
 * The native readers live in harness-sessions; traces supplies relationship facts.
 * fromHarnessSessions never reads native files; bundle ingestion below uses the shared readers.
 * Records from this projection have no anchor.v1 event IDs and must not be used as
 * publication inputs until source locations can be reproduced by the shared reader.
 */
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { ADAPTER_VERSION, Ingest, RunUnreadableError, SnapshotMismatchError, blankNode, finishRecord, verifySnapshot, type IngestOptions, type NodeDraft } from './agent-runtime.js'
import { ID_SCHEME } from '../anchor.js'
import { filesUnder, isoAt, num, sha, splitLines, str, type Json, type Line, type SessionReader, type WorkflowAgents } from './harness-reader.js'
import { readClaudeBundle } from './claude.js'
import { readCodexBundle } from './codex.js'
import { readOpenCodeBundle } from './opencode.js'
import { readBridgeBundle } from './bridge.js'
import { readPiBundle } from './pi.js'
import type { HarnessSession } from '@tangle-network/harness-sessions'
import { parseRecord, type RecordArtifact, type RecordClaim, type RecordPublication, type RecordProfileVersion, type RecordVerdict, type RunRecord } from '../record.js'

/** The recorded-ID subset of `@tangle-network/traces` SessionRelationship. */
export interface SessionRelationInput {
  harness: string
  relationship: { sessionId: string; parentSessionId?: string }
}

export interface SessionProjectionOptions {
  recordId: string
  title: string
  relationships?: readonly SessionRelationInput[]
  /** Relations must come from recorded identifiers in the caller's evidence, not a text search. */
  claims?: readonly RecordClaim[]
  verdicts?: readonly RecordVerdict[]
  publications?: readonly RecordPublication[]
  profileVersions?: readonly RecordProfileVersion[]
}

const key = (harness: string, id: string) => `session:${encodeURIComponent(harness)}:${encodeURIComponent(id)}`
const eventKey = (node: string, kind: string, id: string) => `${node}:${kind}:${encodeURIComponent(id)}`
const instant = (value: string | null | undefined): string | null => {
  if (!value) return null
  const at = Date.parse(value)
  return Number.isFinite(at) ? new Date(at).toISOString() : null
}
const textOf = (parts: HarnessSession['messages'][number]['parts']) =>
  parts.filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text').map((part) => part.text).join('\n')

/** One browser-renderable record from sessions already read by the shared package. */
export function fromHarnessSessions(sessions: readonly HarnessSession[], options: SessionProjectionOptions): RunRecord {
  const byNativeId = new Map<string, string[]>()
  for (const session of sessions) {
    const id = key(session.harness, session.nativeSessionId)
    byNativeId.set(session.nativeSessionId, [...(byNativeId.get(session.nativeSessionId) ?? []), id])
  }
  const exactParent = (nativeId: string | null | undefined) => {
    if (!nativeId) return null
    const candidates = byNativeId.get(nativeId) ?? []
    return candidates.length === 1 ? candidates[0]! : null
  }
  const relationship = new Map((options.relationships ?? []).map(({ harness, relationship }) => [key(harness, relationship.sessionId), relationship]))
  const nodes: RunRecord['nodes'] = []
  const events: RunRecord['events'] = []
  const artifacts: RecordArtifact[] = []
  const gaps: Array<{ nodeId: string; code: string; detail: string }> = []
  const sourceFiles = new Map<string, { path: string; sha256?: string; bytes: number }>()
  for (const session of sessions) {
    const id = key(session.harness, session.nativeSessionId)
    const rel = relationship.get(id)
    const parentNativeId = rel?.parentSessionId ?? session.parentNativeSessionId
    const parent = exactParent(parentNativeId)
    if (parentNativeId && !parent)
      gaps.push({ nodeId: id, code: 'parent-unjoined', detail: `No unique session with recorded ID ${parentNativeId}` })
    const captureStatus = session.integrity.unparsedRecords || session.integrity.truncated || session.integrity.gaps.length ? 'lossy' : 'complete'
    const lastServed = [...session.modelCalls].reverse().find((call) => call.servedModel)?.servedModel ?? null
    nodes.push({
      id,
      label: `${session.harness} ${session.nativeSessionId.slice(0, 12)}`,
      kind: 'session',
      parent,
      nativeSessionId: session.nativeSessionId,
      harness: session.harness,
      model: lastServed,
      servedModel: lastServed,
      modelSource: session.modelSource,
      ...(instant(session.startedAt) ? { start: instant(session.startedAt)! } : {}),
      ...(instant(session.endedAt) ? { end: instant(session.endedAt)! } : {}),
      status: session.ending.status,
      ...(parent ? { joinBasis: 'recorded-session-id', joinProof: { parentNativeSessionId: parentNativeId } } : {}),
      capture: { channel: 'harness-sessions', status: captureStatus, reason: captureStatus === 'complete' ? null : 'native-session-integrity' },
    })
    for (const source of session.integrity.sourceFiles) {
      // harness-sessions uses a prefixed digest; agent-record's source contract stores bare hex.
      const digest = /^sha256:([0-9a-f]{64})$/.exec(source.sha256)?.[1]
      sourceFiles.set(`${source.path}\0${source.sha256}`, { path: source.path, ...(digest ? { sha256: digest } : {}), bytes: source.bytes })
      if (!digest) gaps.push({ nodeId: id, code: 'source-digest-unavailable', detail: `No valid digest for ${source.path}` })
    }
    for (const item of session.integrity.gaps)
      gaps.push({ nodeId: id, code: 'native-session-gap', detail: item })
    if (session.integrity.unparsedRecords)
      gaps.push({ nodeId: id, code: 'native-session-unparsed', detail: `${session.integrity.unparsedRecords} records could not be parsed` })
    if (session.integrity.truncated)
      gaps.push({ nodeId: id, code: 'native-session-truncated', detail: 'The retained copy ended before the session did' })
    for (const message of session.messages) {
      const at = instant(message.at)
      if (!at) {
        gaps.push({ nodeId: id, code: 'message-untimed', detail: `Message ${message.id} has no recorded time` })
        continue
      }
      const eventId = eventKey(id, 'message', message.id)
      const body = textOf(message.parts)
      events.push({ id: eventId, node: id, at, kind: 'message', category: 'other', label: message.role, source: null,
        detail: { role: message.role, ...(body ? { publicText: body } : {}), nativeMessageId: message.id, actor: message.actor, modelCallId: message.modelCallId } })
      for (const [index, part] of message.parts.entries()) if (part.type === 'attachment')
        artifacts.push({ id: `${eventId}:attachment:${index}`, kind: part.mediaType, title: part.ref, sessionNodeId: id, eventId })
    }
    for (const call of session.toolCalls) {
      const at = instant(call.startedAt ?? call.endedAt)
      if (!at) {
        gaps.push({ nodeId: id, code: 'tool-untimed', detail: `Tool call ${call.id} has no recorded time` })
        continue
      }
      events.push({ id: eventKey(id, 'tool', call.id), node: id, at, kind: 'tool-call', category: 'other', label: call.name, source: null,
        detail: { toolCallId: call.id, toolNames: [call.name], isError: call.status === 'error', responseStatus: call.status,
          ...(call.inputText ? { publicText: call.inputText } : {}),
          ...(call.result?.text ? { resultText: call.result.text } : {}) } })
    }
  }
  const complete = gaps.length === 0 && sessions.every((session) => session.integrity.sourceFiles.length > 0)
  return parseRecord({
    schema: 'agent-record.v1', runId: options.recordId, title: options.title, idScheme: 'shared-session.v1', nodes, events, artifacts,
    claims: options.claims ? [...options.claims] : undefined,
    verdicts: options.verdicts ? [...options.verdicts] : undefined,
    publications: options.publications ? [...options.publications] : undefined,
    profileVersions: options.profileVersions ? [...options.profileVersions] : undefined,
    sources: [...sourceFiles.values()],
    terminal: null,
    coverage: { completeOriginalCapture: complete, publicContent: 'Raw shared-session projection; review before publication', categoryMethod: 'unclassified native events', cost: 'Unknown', gaps },
  })
}

/** Each node's first and last event times. */
function spans(events: Ingest['events']) {
  const span = new Map<string, [string, string]>()
  for (const event of events) {
    const current = span.get(event.node)
    if (!current) span.set(event.node, [event.at, event.at])
    else {
      if (event.at < current[0]) current[0] = event.at
      if (event.at > current[1]) current[1] = event.at
    }
  }
  return span
}

export type AssemblyOptions = { title?: string; assignment?: Json; terminal?: Json; format?: string; input?: Record<string, unknown> }

/** Assemble the record from what convert() (or a bundle) read. */
export function assembleRecord(ingest: Ingest, extra: AssemblyOptions = {}) {
  const root = ingest.nodes.get(ingest.rootId)
  const result = ingest.result
  const task = ingest.runInput?.task
  // Results inherit their call's category; durations come from the pair when the source lacks them.
  const calls = new Map<string, Ingest['events'][number]>()
  for (const event of ingest.events)
    for (const call of (event.detail.publicToolCalls as { id: string }[] | undefined) ?? []) calls.set(`${event.node}\0${call.id}`, event)
  for (const event of ingest.events) {
    const callId = event.detail.toolCallId
    if (typeof callId !== 'string') continue
    const call = calls.get(`${event.node}\0${callId}`)
    if (!call) continue
    if (event.category === 'other') event.category = call.category
    if (event.detail.durationMs === undefined) {
      const duration = Date.parse(event.at) - Date.parse(call.at)
      if (duration >= 0 && event.detail.atBasis !== 'carried') event.detail.durationMs = duration
    }
  }

  // Node start and end fall back to their first and last recorded events.
  const nodeOrder = new Map([...ingest.nodes.keys()].map((id, i) => [id, i]))
  const span = spans(ingest.events)
  for (const node of ingest.nodes.values()) {
    const bounds = span.get(node.id)
    if (!node.start && bounds) node.start = bounds[0]
    if (!node.end && bounds && node.kind === 'session') node.end = bounds[1]
  }
  // A root never settles in its own journal; the run's result is its terminal state.
  if (root && result && !root.status && typeof result.kind === 'string') {
    root.status = result.kind
    root.end ??= span.get(root.id)?.[1]
  }

  ingest.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : (nodeOrder.get(a.node)! - nodeOrder.get(b.node)!) || a.order - b.order))
  // anchor.v1 ids are unique by construction; a repeat means two events claim the same bytes.
  const ids = new Set<string>()
  for (const event of ingest.events) {
    if (ids.has(event.id)) throw new SnapshotMismatchError(`duplicate anchor ${event.id} (${event.source.path}${event.source.line ? `:${event.source.line}` : event.source.pointer ?? ''})`)
    ids.add(event.id)
  }
  // A 12-hex object prefix names exactly one object among the record's sources.
  const objects = new Map<string, string>()
  for (const source of ingest.sources.values()) {
    if (!source.sha256 || source.line !== undefined || source.pointer !== undefined) continue
    const prefix = source.sha256.slice(0, 12)
    const known = objects.get(prefix)
    if (known && known !== source.sha256) throw new SnapshotMismatchError(`object prefix ${prefix} names two objects`)
    objects.set(prefix, source.sha256)
  }

  const captures = [...ingest.nodes.values()].map((node) => ({ nodeId: node.id, ...node.capture }))
  const counts = { complete: 0, lossy: 0, absent: 0 }
  for (const capture of captures) counts[capture.status]++
  // The original capture is complete only when there are agents and every one of them is fully captured: finding
  // pages alone (a finding-only run) are what an agent wrote, not the agent's record.
  const agents = captures.filter((capture) => ingest.nodes.get(capture.nodeId)?.kind !== 'finding')
  // "Served" needs an observed response: a node with no successful assistant message keeps its declared model only.
  const answered = new Set(
    ingest.events.filter((event) => event.kind === 'message' && event.detail.role === 'assistant' && event.detail.responseStatus !== 'error').map((event) => event.node),
  )
  const priced = ingest.events.some((event) => num(event.detail.costListUsd) !== undefined)
  const asText = (value: Json) => (typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : '')
  const knowledge = asText(task?.knowledge)
  const completion = asText(task?.completion)
  const record = {
    schema: 'agent-record.v1',
    runId: ingest.runId,
    title: extra.title ?? ingest.runId,
    producer: { name: '@drewstone/agent-record/adapters/agent-runtime', version: ADAPTER_VERSION },
    idScheme: ID_SCHEME,
    input: {
      ...(ingest.options.manifestSha256 ? { snapshot: `sha256:${ingest.options.manifestSha256}` } : {}),
      runIdBasis: ingest.runIdBasis,
      ...extra.input,
    },
    format: extra.format ?? ingest.format,
    nodes: [...ingest.nodes.values()].map((node) => ({
      id: node.id,
      label: node.label,
      parent: node.parent,
      kind: node.kind,
      role: node.role,
      ...(node.assignment ? { assignment: node.assignment } : {}),
      model: node.model,
      ...(node.modelSource ? { modelSource: node.modelSource } : {}),
      servedModel: answered.has(node.id) ? node.servedModel : null,
        ...(node.nativeUsage ? { nativeUsage: node.nativeUsage } : {}),
      harness: node.harness,
      ...(node.start ? { start: node.start } : {}),
      ...(node.end ? { end: node.end } : {}),
      ...(node.status ? { status: node.status } : {}),
      ...(node.nativeSessionId ? { nativeSessionId: node.nativeSessionId } : {}),
      ...(node.agentId ? { agentId: node.agentId } : {}),
      ...(node.joinBasis ? { joinBasis: node.joinBasis } : {}),
      ...(node.joinProof ? { joinProof: node.joinProof } : {}),
      sandboxes: node.sandboxes,
      capture: node.capture,
    })),
    events: ingest.events.map(({ order: _order, ...event }) => event),
    sources: [...ingest.sources.values()].map(({ sha256, ...source }) => (sha256 ? { ...source, sha256 } : source)).sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0) || (a.pointer ?? '').localeCompare(b.pointer ?? ''),
    ),
    assignment: extra.assignment ?? {
      objective: str(task?.objective),
      instruction: str(task?.instruction ?? (typeof task === 'string' ? task : '')),
      knowledge,
      completion,
      suppliedKnowledge: knowledge,
      deliverables: completion,
      constraints: '',
      source: ingest.runInputRel ? { path: ingest.sourcePath(ingest.runInputRel), sha256: ingest.file(ingest.runInputRel, ingest.runInputRel.startsWith('../') ? join(dirname(ingest.runDir), ingest.runInputRel.slice(3)) : undefined).sha256, pointer: '/task' } : null,
    },
    terminal: extra.terminal !== undefined
      ? extra.terminal
      : result
        ? {
            kind: typeof result.kind === 'string' ? result.kind : null,
            reason: typeof result.reason === 'string' ? result.reason : null,
            ...(typeof result.error?.message === 'string' ? { error: ingest.clip(result.error.message, null).text } : {}),
          }
        : null,
    coverage: {
      completeOriginalCapture: agents.length > 0 && agents.every((capture) => capture.status === 'complete'),
      publicContent: '',
      categoryMethod: 'Activity types are keyword matches on tool names and commands. They do not measure research value or show independent verification.',
      cost: priced ? 'List price from recorded usage; not billed.' : 'Not recorded',
      nodes: captures,
      gaps: ingest.gaps.map((gap) => ({ runId: ingest.runId, ...gap })),
    },
  }
  return { record, counts }
}

// ---------------------------------------------------------------------------------------------------------
// Bundles: one record from several native sessions, workflow journals, agent-runtime runs and finding pages.
// bundle.json (agent-record.bundle.v1) sits at the bundle root; every path is relative to it.
// ---------------------------------------------------------------------------------------------------------
export const BUNDLE_SCHEMA = 'agent-record.bundle.v1'
export type BundleHarness = 'claude-code' | 'codex' | 'opencode' | 'opencode-bridge' | 'pi'
export interface BundleSession {
  path: string
  harness: BundleHarness
  sessionId?: string
  /** The session that launched this one; the converter records it only when the file layout proves it. */
  parentPath?: string
  agentId?: string
  label?: string
  /** Physical line windows, inclusive; lines outside them are out of the record's scope. */
  lines?: [number, number][]
}
export interface Bundle {
  schema: typeof BUNDLE_SCHEMA
  recordId: string
  title?: string
  sessions: BundleSession[]
  journals?: { path: string; kind: 'claude-workflow'; workflow?: string; parentPath?: string; label?: string }[]
  runs?: { path: string; kind: 'agent-runtime'; runId?: string }[]
  findings?: { path: string }[]
}

/** The reader of each harness a bundle session may name. */
const SESSION_READERS: Record<BundleHarness, SessionReader> = {
  'claude-code': readClaudeBundle,
  codex: readCodexBundle,
  opencode: readOpenCodeBundle,
  'opencode-bridge': readBridgeBundle,
  pi: readPiBundle,
}

function parseBundle(value: Json): Bundle {
  if (value?.schema !== BUNDLE_SCHEMA) throw new RunUnreadableError(`bundle.json is not ${BUNDLE_SCHEMA}`)
  if (typeof value.recordId !== 'string' || !value.recordId) throw new RunUnreadableError('bundle.json names no recordId')
  if (!Array.isArray(value.sessions)) throw new RunUnreadableError('bundle.json lists no sessions')
  const safe = (path: unknown) => typeof path === 'string' && path !== '' && !path.startsWith('/') && !path.split('/').includes('..')
  for (const item of [...value.sessions, ...(value.journals ?? []), ...(value.runs ?? []), ...(value.findings ?? [])])
    if (!safe(item?.path)) throw new RunUnreadableError(`bundle.json path ${JSON.stringify(item?.path)} leaves the bundle`)
  return value as Bundle
}

/**
 * Convert a bundle directory. Joins come from evidence only and each records its basis and proof:
 *   workflow-agent-id    a Claude workflow journal's `started` agentId is the agentId carried by a session file
 *                        `agent-<id>.jsonl` beside `agent-<id>.meta.json`
 *   session-directory    a session under `<parent session id>/subagents/` belongs to that parent session
 * A session whose join does not verify stays its own node.
 */
export function ingestBundle(dir: string, options: Omit<IngestOptions, 'runId'> = {}) {
  if (options.manifest) verifySnapshot(dir, options.manifest)
  const bundleText = readFileSync(join(dir, 'bundle.json'), 'utf8')
  const bundle = parseBundle(JSON.parse(bundleText))
  const maxText = Math.max(1024, options.maxText ?? 16384)
  const main = new Ingest(dir, options.native, maxText, { runId: bundle.recordId, manifest: options.manifest, manifestSha256: options.manifestSha256 })
  main.fileSource('bundle.json')

  // Agent-runtime runs first: their nodes and sources keep the run's own ids, under the run's path.
  for (const run of bundle.runs ?? []) {
    const sub = new Ingest(join(dir, run.path), options.native, maxText, {
      runId: run.runId ?? basename(run.path),
      manifest: options.manifest,
      prefix: `${run.path.replace(/\/+$/, '')}/`,
    })
    sub.convert()
    for (const [id, node] of sub.nodes) {
      if (main.nodes.has(id)) throw new SnapshotMismatchError(`node ${id} appears twice in the bundle`)
      main.nodes.set(id, node)
    }
    for (const event of sub.events) main.events.push({ ...event, order: main.order++ })
    for (const [key, source] of sub.sources) if (!main.sources.has(key)) main.sources.set(key, source)
    for (const gap of sub.gaps) main.gaps.push(gap)
    for (const [digest, node] of sub.claimed) main.claimed.set(digest, node)
  }

  // Workflow journals: one workflow node, one agent node per started agent.
  const journalRows: { node: string; rel: string; sha256: string; row: Line; type: string; agentId: string }[] = []
  const agentNodes: WorkflowAgents = new Map()
  for (const journal of bundle.journals ?? []) {
    const entry = main.file(journal.path)
    main.fileSource(journal.path)
    const wfId = basename(dirname(journal.path))
    let workflowStart: string | undefined
    if (journal.workflow) {
      main.fileSource(journal.workflow)
      try {
        workflowStart = isoAt(JSON.parse(main.file(journal.workflow).text)?.timestamp) ?? undefined
      } catch {
        /* the workflow file is listed as a source either way */
      }
    }
    if (!main.nodes.has(wfId))
      main.nodes.set(wfId, blankNode(wfId, { label: journal.label ?? wfId, kind: 'agent', role: 'workflow', harness: 'claude-code-workflow', start: workflowStart, capture: { channel: 'journal', status: 'complete', reason: null } }))
    for (const row of splitLines(entry.bytes)) {
      const agentId = str(row.value?.agentId)
      if (!agentId) continue
      const id = `${wfId}:${agentId}`
      if (!main.nodes.has(id)) {
        main.nodes.set(id, blankNode(id, { label: `agent ${agentId.slice(0, 8)}`, parent: wfId, kind: 'agent', role: 'workflow agent', agentId: undefined }))
        agentNodes.set(agentId, { node: id, rel: journal.path, line: row.line })
      }
      journalRows.push({ node: id, rel: journal.path, sha256: entry.sha256, row, type: str(row.value?.type) || 'row', agentId })
    }
  }

  // Sessions: each harness's reader finds or creates the session's node and reads its file onto it.
  const byPath = new Map<string, string>()
  const pending: { session: BundleSession; node: NodeDraft }[] = []
  for (const session of bundle.sessions) {
    if (!Object.hasOwn(SESSION_READERS, session.harness)) throw new RunUnreadableError(`bundle.json session ${session.path} has an unknown harness`)
    const node = SESSION_READERS[session.harness](main, session, agentNodes)
    byPath.set(session.path, node.id)
    pending.push({ session, node })
  }
  // Parents: a session stored under `<parent session id>/subagents/` belongs to that parent.
  const sessionOwner = (path: string) => /(?:^|\/)([0-9a-f-]{36})\/subagents\//.exec(path)?.[1]
  const proven = (child: string, parent: string) => {
    const owner = sessionOwner(child)
    return owner !== undefined && basename(parent, '.jsonl') === owner
  }
  for (const { session, node } of pending) {
    if (!session.parentPath) continue
    const parent = byPath.get(session.parentPath)
    if (!parent || !proven(session.path, session.parentPath)) {
      main.gaps.push({ nodeId: node.id, code: 'parent-unproven', detail: `${session.path} does not sit under ${session.parentPath}` })
      continue
    }
    const target = node.parent && main.nodes.get(node.parent)?.role === 'workflow' ? main.nodes.get(node.parent)! : node
    if (target.parent && target.parent !== parent) continue
    target.parent = parent
    target.joinBasis ??= 'session-directory'
  }
  for (const journal of bundle.journals ?? []) {
    if (!journal.parentPath) continue
    const parent = byPath.get(journal.parentPath)
    const workflow = main.nodes.get(basename(dirname(journal.path)))
    if (parent && workflow && proven(journal.path, journal.parentPath)) workflow.parent = parent
    else if (workflow) main.gaps.push({ nodeId: workflow.id, code: 'parent-unproven', detail: `${journal.path} does not sit under ${journal.parentPath}` })
  }

  // Journal rows carry no time: a started row takes its session's first event, a result row its last.
  const span = spans(main.events)
  for (const item of journalRows) {
    const bounds = span.get(item.node)
    if (!bounds) {
      main.gaps.push({ nodeId: item.node, code: 'journal-untimed-lines', detail: `${item.rel}:${item.row.line} has no time and no joined session` })
      continue
    }
    const node = main.nodes.get(item.node)!
    if (item.type === 'result') node.status ??= 'settled'
    const { type: _t, agentId: _a, ...rest } = item.row.value
    main.emit({
      node: item.node,
      at: item.type === 'started' ? bounds[0] : bounds[1],
      kind: item.type,
      category: 'lifecycle',
      label: item.type,
      source: { path: item.rel, sha256: item.sha256, line: item.row.line },
      detail: { lifecycle: item.type, atBasis: item.type === 'started' ? 'session-first-event' : 'session-last-event', data: main.compactValue(rest) },
    })
  }
  for (const node of main.nodes.values())
    if (node.role === 'workflow agent' && node.capture.status === 'absent') {
      node.capture = { channel: 'journal', status: 'absent', reason: 'no-session-joined' }
      main.gaps.push({ nodeId: node.id, code: 'no-transcript:no-session-joined', detail: 'No session file carries this workflow agent id' })
    }

  for (const finding of bundle.findings ?? []) {
    const paths = finding.path.endsWith('.md') ? [finding.path] : filesUnder(dir, finding.path.replace(/\/+$/, ''), '.md')
    main.readFindings(`finding:${bundle.recordId}`, undefined, paths)
  }

  main.rootId = ''
  const { record, counts } = main.assemble({
    title: bundle.title ?? bundle.recordId,
    format: 'bundle',
    terminal: null,
    assignment: { objective: '', instruction: '', knowledge: '', completion: '', suppliedKnowledge: '', deliverables: '', constraints: '', source: null },
    input: { bundle: `sha256:${sha(bundleText)}` },
  })
  return finishRecord(record, counts)
}
