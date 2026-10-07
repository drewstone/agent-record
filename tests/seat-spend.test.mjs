import assert from 'node:assert/strict'
import test from 'node:test'
import { runDocumentSchema, spendSchema } from '../dist/workspace.js'

const spend = {
  paidUsd: null, sandboxUsd: null, routerUsd: null, costBasisUsd: null, listUsd: null,
  tokens: null, sandboxHours: null, paidKnown: false, sources: [], gaps: [],
}

test('seat allowance values and provenance keep measured, partial, and unknown distinct', () => {
  const segment = {
    seat: 'opaque-seat-id', provider: 'anthropic', model: 'claude-opus-5-5',
    startedAt: '2026-10-04T06:00:00Z', endedAt: '2026-10-04T06:04:00Z',
    seatWeeks: 0.1, seatWeeksKnown: true,
  }
  const node = { ...spend, account: { kind: 'subscription', rateLimit: null }, sandboxes: [],
    seatWeeks: 0.1, seatWeeksKnown: true, segments: [segment] }
  const runSpend = { ...spend, seatWeeks: 0.1, seatWeeksKnown: true,
    bySeat: [{ seat: segment.seat, provider: segment.provider, model: segment.model, seatWeeks: 0.1, known: true }],
    nodes: { root: node } }
  assert.equal(runDocumentSchema.shape.spend.parse(runSpend).nodes.root.segments[0].seat, segment.seat)
  assert.equal(runDocumentSchema.shape.spend.parse({ ...runSpend, seatWeeks: null, seatWeeksKnown: false,
    nodes: { root: { ...node, segments: [{ ...segment, seatWeeks: null, seatWeeksKnown: false }] } } }).nodes.root.segments[0].seatWeeks, null)
  assert.equal(spendSchema.safeParse({ ...spend, seatWeeks: -0.1 }).success, false)
  assert.equal(runDocumentSchema.shape.spend.safeParse({ ...runSpend, nodes: { root: { ...node,
    segments: [{ ...segment, seatWeeks: -0.1 }] } } }).success, false)
})
