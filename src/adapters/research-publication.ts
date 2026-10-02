import { z } from 'zod'
import { parseRecord, type RunRecord } from '../record.js'

const publication = z
  .object({
    schema: z.literal('research-publication.events.v1'),
    nodes: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          parent: z.string().nullable(),
          kind: z.enum(['runtime', 'native', 'finding']),
          runtimeNodeId: z.string().optional(),
          runtimeJoin: z.string().optional(),
        })
        .catchall(z.unknown()),
    ),
  })
  .catchall(z.unknown())

/** Convert reviewed public records only. This does not sanitize raw logs for publication. */
export function fromResearchPublication(value: unknown): RunRecord {
  const input = publication.parse(value)
  return parseRecord({
    ...input,
    schema: 'agent-record.v1',
    nodes: input.nodes.map((node) => ({
      ...node,
      kind:
        node.kind === 'runtime'
          ? 'agent'
          : node.kind === 'native'
            ? 'session'
            : 'finding',
      agentId: node.runtimeNodeId,
      joinBasis: node.runtimeJoin,
      ...(node.kind === 'runtime'
        ? { role: node.parent ? 'Worker' : 'Director' }
        : {}),
      ...(node.label.startsWith('verifier-')
        ? { assignment: 'Verification' }
        : {}),
    })),
  })
}
