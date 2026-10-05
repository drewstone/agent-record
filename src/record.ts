import { z } from 'zod'

const time = z.iso.datetime({ offset: true })
const metadata = z.record(z.string(), z.unknown())
const sourceSchema = z
  .object({
    path: z.string(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    line: z.number().int().positive().optional(),
    /** JSON Pointer into a JSON file; the hash covers the resolved value. */
    pointer: z.string().startsWith('/').optional(),
  })
  .catchall(z.unknown())
const capture = z
  .object({
    channel: z.string(),
    status: z.enum(['complete', 'lossy', 'absent']),
    reason: z.string().nullable(),
  })
  .catchall(z.unknown())
const gap = z
  .object({
    runId: z.string().optional(),
    nodeId: z.string().nullable().optional(),
    code: z.string(),
    detail: z.string(),
  })
  .catchall(z.unknown())

export const recordSchema = z
  .object({
    schema: z.literal('agent-record.v1'),
    runId: z.string().min(1),
    title: z.string(),
    nodes: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.string(),
          parent: z.string().nullable().default(null),
          kind: z.enum(['agent', 'session', 'finding']),
          role: z.string().optional(),
          assignment: z.string().optional(),
          model: z.string().nullable().optional(),
          start: time.optional(),
          end: time.optional(),
          status: z.string().optional(),
          nativeSessionId: z.string().optional(),
          agentId: z.string().optional(),
          joinBasis: z.string().optional(),
          joinProof: metadata.optional(),
          modelSource: z.string().optional(),
          servedModel: z.string().nullable().optional(),
          harness: z.string().nullable().optional(),
          /** Execution environments, in first-seen order. */
          sandboxes: z.array(z.string()).optional(),
          capture: capture.optional(),
          /** A reviewer's statement of what this agent's capture lacks and why. */
          captureNote: z.string().optional(),
        })
        .catchall(z.unknown()),
    ),
    events: z.array(
      z
        .object({
          id: z.string().min(1),
          node: z.string().min(1),
          at: time,
          kind: z.string(),
          category: z.string().default('other'),
          label: z.string(),
          source: sourceSchema.nullable().optional(),
          detail: z
            .object({
              role: z.string().optional(),
              publicText: z.string().optional(),
              publicationNote: z.string().nullish(),
              contentOmitted: z.string().optional(),
              publicToolCalls: z
                .array(
                  z
                    .object({
                      id: z.string(),
                      name: z.string(),
                      /** Absent when the source holds no arguments for the call; the viewer says so. */
                      input: z.string().optional(),
                      publicationNote: z.string().nullish(),
                    })
                    .catchall(z.unknown()),
                )
                .optional(),
              toolCallIds: z.array(z.string()).optional(),
              toolNames: z.array(z.string()).optional(),
              toolCallId: z.string().optional(),
              isError: z.boolean().optional(),
              responseStatus: z.string().optional(),
              recordedClaim: z.string().optional(),
              assessment: z.string().optional(),
              usage: z
                .object({
                  input: z.number().nonnegative().optional(),
                  output: z.number().nonnegative().optional(),
                  cacheRead: z.number().nonnegative().optional(),
                  cacheWrite: z.number().nonnegative().optional(),
                })
                .catchall(z.unknown())
                .nullish(),
              reasoning: z.string().optional(),
              durationMs: z.number().nonnegative().optional(),
              /** List-price estimate from recorded usage. Not a bill. */
              costListUsd: z.number().nonnegative().optional(),
              usdKnown: z.boolean().optional(),
              rateLimit: z
                .object({
                  window: z.string().nullable(),
                  utilization: z.number().nullable(),
                  status: z.string().nullable(),
                })
                .catchall(z.unknown())
                .optional(),
              /** The body was shortened; the full text is the source entry with this hash. */
              clip: z
                .object({
                  bytes: z.number().int().nonnegative(),
                  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
                })
                .catchall(z.unknown())
                .optional(),
            })
            .catchall(z.unknown()),
        })
        .catchall(z.unknown()),
    ),
    sources: z
      .array(
        sourceSchema.extend({ bytes: z.number().nonnegative().optional() }),
      )
      .default([]),
    assignment: z
      .object({
        objective: z.string(),
        suppliedKnowledge: z.string(),
        deliverables: z.string(),
        constraints: z.string(),
        source: sourceSchema.nullable(),
      })
      .catchall(z.unknown())
      .default({
        objective: '',
        suppliedKnowledge: '',
        deliverables: '',
        constraints: '',
        source: null,
      }),
    terminal: z
      .object({ kind: z.string().nullable(), reason: z.string().nullable() })
      .catchall(z.unknown())
      .nullable()
      .default(null),
    coverage: z
      .object({
        completeOriginalCapture: z.boolean(),
        publicContent: z.string(),
        categoryMethod: z.string(),
        cost: z.string(),
        nodes: z
          .array(capture.extend({ nodeId: z.string() }))
          .optional(),
        gaps: z.array(gap).optional(),
      })
      .catchall(z.unknown())
      .default({
        completeOriginalCapture: false,
        publicContent: '',
        categoryMethod: '',
        cost: 'Unknown',
      }),
  })
  .catchall(z.unknown())
  .superRefine((record, ctx) => {
    const nodes = new Map(record.nodes.map((node) => [node.id, node]))
    if (nodes.size !== record.nodes.length)
      ctx.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: 'Node IDs must be unique within a run',
      })
    if (
      new Set(record.events.map((event) => event.id)).size !==
      record.events.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Event IDs must be unique within a run',
      })
    for (const [i, node] of record.nodes.entries()) {
      if (
        node.agentId &&
        (node.kind !== 'session' || nodes.get(node.agentId)?.kind !== 'agent')
      )
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'agentId'],
          message: 'A proven session join must reference an existing agent',
        })
      const seen = new Set<string>([node.id])
      let parent = node.parent
      while (parent && nodes.has(parent)) {
        if (seen.has(parent)) {
          ctx.addIssue({
            code: 'custom',
            path: ['nodes', i, 'parent'],
            message: 'Parent relationships must not contain a cycle',
          })
          break
        }
        seen.add(parent)
        parent = nodes.get(parent)!.parent
      }
    }
    for (const [i, event] of record.events.entries()) {
      if (!nodes.has(event.node))
        ctx.addIssue({
          code: 'custom',
          path: ['events', i, 'node'],
          message:
            'An event must reference an existing node, even when that node has unresolved identity',
        })
      const calls = event.detail.publicToolCalls ?? []
      if (new Set(calls.map((call) => call.id)).size !== calls.length)
        ctx.addIssue({
          code: 'custom',
          path: ['events', i, 'detail', 'publicToolCalls'],
          message: 'Published tool call IDs must be unique within an event',
        })
    }
  })

export type RunRecord = z.infer<typeof recordSchema>
export type RecordCapture = z.infer<typeof capture>
export type RecordGap = z.infer<typeof gap>
export type RecordNode = RunRecord['nodes'][number]
export type RecordEvent = RunRecord['events'][number]
export interface RecordSelection {
  runId: string
  nodeId?: string
  eventId?: string
  /** UTC timestamp at the playback cursor. Omitted means the complete record. */
  at?: string
  view?: 'chat' | 'source' | 'usage'
}

/** Validate at the import boundary. Unknown metadata is preserved. */
export function parseRecord(value: unknown): RunRecord {
  return recordSchema.parse(value)
}
