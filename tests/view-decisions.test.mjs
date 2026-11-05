import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runDocumentSchema } from '../dist/workspace.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/view-decisions.json', import.meta.url), 'utf8'))
const viewSchema = runDocumentSchema.shape.view.unwrap()
const needSchema = viewSchema.shape.needsYou.element

test('the actual Tools UNKNOWN view preserves the operator decision through the public parser', () => {
  const view = viewSchema.parse(fixture.unknownView)
  assert.deepEqual(view, fixture.unknownView)
  const [need] = view.needsYou
  assert.equal(need.kind, 'infra')
  assert.equal(need.actor.role, 'operator')
  assert.equal(need.action, 'Fix the check runner, then re-run the check')
  assert.equal(need.urgent, false)
  assert.equal(need.dispute, null)
  assert.equal(need.consequence, null)
})

test('a producer dispute choice retains both commands, ruling values and consequences', () => {
  const need = { text: 'The referees disagree', dispute: 'c309bb08b9af', ...fixture.disputeChoice }
  assert.deepEqual(needSchema.parse(need), need)
  assert.deepEqual(need.options.map(option => option.verdict), ['upheld', 'rejected'])
  for (const option of need.options) {
    assert.ok(option.command.endsWith(`--verdict ${option.verdict}`))
    assert.ok(option.consequence)
  }
})

test('older decisions stay valid without inventing urgency, action or a ruling', () => {
  const legacy = { text: 'Please review', options: [{ label: 'Review', command: 'disco review' }] }
  assert.deepEqual(needSchema.parse(legacy), legacy)
  assert.equal(needSchema.safeParse({ ...legacy, urgent: 'false' }).success, false)
  assert.equal(needSchema.safeParse({ ...legacy, action: { command: 'disco review' } }).success, false)
})
