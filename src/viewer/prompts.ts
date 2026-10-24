import type { RunRecord } from '../record.js'

/** The conversation needs an opening prompt even when the provider did not retain its first user turn. */
export function withPrompts(record: RunRecord): RunRecord {
  const events = record.events.map((event) => ({ ...event, detail: { ...event.detail } }))
  for (const node of record.nodes.filter((item) => item.kind === 'agent')) {
    const own = events.filter((event) => event.node === node.id)
    const firstReply = own.find((event) => event.detail.role === 'assistant')?.at
    const userTurns = own.filter((event) => event.detail.role === 'user' &&
      typeof event.detail.publicText === 'string' &&
      !event.detail.publicText.trimStart().startsWith('<task-notification>'))
    const initial = userTurns.find((event) => event.detail.promptKind !== 'steering' && (!firstReply || event.at <= firstReply))
    if (initial) {
      initial.detail.promptKind = 'initial'
    } else if (node.assignment?.trim()) {
      const at = node.start ?? own[0]?.at
      if (at) events.push({
        id: `prompt:${node.id}`,
        node: node.id,
        at,
        kind: 'message',
        category: 'other',
        label: 'Prompt',
        source: null,
        detail: { role: 'user', publicText: node.assignment, promptKind: 'initial', promptReconstructed: true, promptSource: 'node.assignment' },
      })
    }
    for (const event of userTurns) {
      if (event === initial || event.detail.promptKind === 'initial') continue
      event.detail.promptKind ??= 'steering'
    }
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || Number(b.detail.promptKind === 'initial') - Number(a.detail.promptKind === 'initial'))
  return { ...record, events }
}
