/**
 * Project normalized native sessions into the anchored record's viewer shape.
 * The native readers live in harness-sessions; traces supplies relationship facts.
 * This entrypoint neither reads native files nor invents a join from labels or time.
 * Records from this projection have no anchor.v1 event IDs and must not be used as
 * publication inputs until source locations can be reproduced by the shared reader.
 */
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
