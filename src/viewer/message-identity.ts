import type { RecordEvent } from '../record.js'
import type { RecordIndex } from './model.js'

/** A message's conversation role and recorded sender are different facts. Missing authorship stays unknown. */
export function messageIdentity(index: RecordIndex, event: RecordEvent) {
  const coordination = event.detail.coordination as { fromNode?: unknown } | undefined
  const senderId = typeof event.detail.promptSenderNodeId === 'string' ? event.detail.promptSenderNodeId : typeof coordination?.fromNode === 'string' ? coordination.fromNode : null
  const sender = senderId ? index.nodes.get(index.canonical(senderId)) : null
  const raw = typeof event.detail.promptSender === 'string' ? event.detail.promptSender : null
  const label = sender ? [sender.role, sender.label].filter((value, i, all) => value && all.indexOf(value) === i).join(' · ')
    : raw && !['Coordinator', 'Parent agent'].includes(raw) ? raw : 'Sender not captured'
  const recipient = index.nodes.get(index.canonical(event.node))
  return { senderId, sender, label, recipient, reconstructed: event.detail.promptReconstructed === true }
}
