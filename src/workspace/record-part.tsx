import { useMemo } from 'react'
import { Conversation } from '../viewer/Conversation.js'
import { indexRecord, type RecordIndex } from '../viewer/model.js'
import { withPrompts } from '../viewer/prompts.js'
import { readRecord, useDocument } from './data.js'
import type { NodeStats } from './RunTable.js'

/** A record part (agent-record.v1) read for drawing; `nodeStats` only on the `nodes` part. */
export function useRecordPart(url: string | null) {
  const doc = useDocument<unknown>(url, undefined, true)
  const parsed = useMemo(() => {
    if (!doc.data) return { record: null, index: null, stats: {} as Record<string, NodeStats>, error: undefined as string | undefined }
    try {
      const record = withPrompts(readRecord(doc.data))
      const stats = ((doc.data as { nodeStats?: Record<string, NodeStats> }).nodeStats ?? {}) as Record<string, NodeStats>
      return { record, index: indexRecord(record), stats, error: undefined }
    } catch (error) {
      return { record: null, index: null, stats: {} as Record<string, NodeStats>, error: error instanceof Error ? error.message : 'Invalid record' }
    }
  }, [doc.data])
  return { ...parsed, loading: doc.loading, fetchError: doc.error, pending: !!url && doc.data === undefined && !doc.error }
}

/** One agent's conversation from the record, for the run workspace's centre pane: its events load when it is selected. */
export function AgentConversation({ runUrl, version, index, actor }: { runUrl: string; version: string; index: RecordIndex; actor: string }) {
  const agent = useRecordPart(`${runUrl}/record?node=${encodeURIComponent(actor)}${version}`)
  if (!agent.index) return <p className="ws-status" role={agent.fetchError || agent.error ? 'alert' : 'status'}>{agent.fetchError || agent.error ? `This agent's record is unavailable: ${agent.fetchError ?? agent.error}` : `Loading ${index.nodes.get(actor)?.label ?? 'the agent'}'s conversation…`}</p>
  return <Conversation index={agent.index} actor={actor} cutoff={agent.index.end} query="" category="all" inspect={() => undefined} lifecycle={false} />
}

