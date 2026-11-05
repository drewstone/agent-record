import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runDocumentSchema } from '../dist/workspace.js'

const executionSchema = runDocumentSchema.shape.execution.unwrap()
const legacy = {
  alive: false, lastActivityAt: null, failedAttempts: 0, settleKind: 'winner',
  endingError: null, lastAttempt: null, diagnoses: [],
  resume: { status: 'unknown', command: null, reason: null },
}
const at = '2026-10-31T00:00:00.000Z'

test('legacy execution records remain valid without new facts or invented defaults', () => {
  assert.deepEqual(executionSchema.parse(legacy), legacy)
})

test('Discovery legacy rows retain explicit null phase and runtime state', () => {
  const row = { ...legacy, final: true, phase: null, runtimeState: null }
  assert.deepEqual(executionSchema.parse(row), row)
})

test('Runtime execution and Lab overlays retain liveness separately from finality and goal outcome', () => {
  const cases = [
    ['running', true, false, { phase: 'running', holderLive: true }],
    ['down', false, false, { phase: 'down', holderLive: false }],
    ['parked', false, false, { phase: 'parked', holderLive: false }],
    ['cancelling', true, false, { phase: 'cancelling', holderLive: true }],
    ['settled', false, true, { phase: 'settled', holderLive: false }],
    ['unpressed', null, false, null],
    ['start-failed', null, false, null],
    ['trace-incomplete', false, true, { phase: 'settled', holderLive: false }],
    ['unverified', null, false, {}],
  ]
  for (const [phase, alive, final, runtimeState] of cases) {
    const row = { ...legacy, phase, alive, final, runtimeState, settleKind: final ? 'winner' : null }
    assert.deepEqual(executionSchema.parse(row), row, phase)
  }
})

test('unknown Runtime holder evidence stays absent inside the projection and null at execution.alive', () => {
  const row = { ...legacy, phase: 'unverified', alive: null, final: false,
    runtimeState: { lastActivityAt: at }, lastActivityAt: at }
  const parsed = executionSchema.parse(row)
  assert.deepEqual(parsed, row)
  assert.equal(Object.hasOwn(parsed.runtimeState, 'holderLive'), false)
  assert.equal(Object.hasOwn(parsed.runtimeState, 'phase'), false)
})

test('recorded failure and cancellation provenance survive, including legacy requests without operator', () => {
  const failure = { ...legacy, phase: 'settled', final: true, settleKind: 'driver-failed',
    runtimeState: { phase: 'settled', holderLive: false, failureCode: 'transport', lastActivityAt: at } }
  assert.deepEqual(executionSchema.parse(failure), failure)
  for (const extra of [{}, { operator: 'schema-test', reason: 'requested stop', deadlineMs: 0 }]) {
    const row = { ...legacy, phase: 'cancelling', alive: true, final: false, settleKind: null,
      runtimeState: { phase: 'cancelling', holderLive: true, lastActivityAt: at,
        cancelRequest: { operationId: 'cancel-test', at, source: 'human', ...extra } } }
    assert.deepEqual(executionSchema.parse(row), row)
  }
})

test('malformed execution facts and incomplete cancellation requests are rejected', () => {
  const invalid = [
    { alive: 'unknown' }, { final: 'false' }, { phase: 'winner' },
    { runtimeState: [] }, { runtimeState: { holderLive: 'false' } },
    { runtimeState: { phase: 'trace-incomplete' } }, { runtimeState: { failureCode: 1 } },
    { runtimeState: { lastActivityAt: false } },
    { runtimeState: { cancelRequest: { operationId: 'cancel-test' } } },
    { runtimeState: { cancelRequest: { operationId: 'cancel-test', at, source: 'human', deadlineMs: -1 } } },
  ]
  for (const fields of invalid) assert.equal(executionSchema.safeParse({ ...legacy, ...fields }).success, false, JSON.stringify(fields))
})

test('exported JSON schema retains closed objects and optional additions for non-Zod consumers', () => {
  const document = JSON.parse(readFileSync(new URL('../dist/schemas/agent-workspace.run.v1.json', import.meta.url), 'utf8'))
  const execution = document.properties.execution
  const runtime = execution.properties.runtimeState.anyOf.find((schema) => schema.type === 'object')
  const cancel = runtime.properties.cancelRequest
  assert.equal(execution.additionalProperties, false)
  assert.equal(runtime.additionalProperties, false)
  assert.equal(cancel.additionalProperties, false)
  for (const field of ['final', 'phase', 'runtimeState']) assert.equal(execution.required.includes(field), false, field)
  assert.deepEqual(execution.properties.alive.type, ['boolean', 'null'])
  assert.deepEqual(cancel.required, ['operationId', 'at', 'source'])
})
