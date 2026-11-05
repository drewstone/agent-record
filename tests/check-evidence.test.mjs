import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// Node 24, as used by this package's build workflow, validates the owner directly without frontend dependencies.
import { checkEvidenceSchema, runCheckSchema } from '../src/run-check-model.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/check-evidence-projection.json', import.meta.url), 'utf8'))
const evidence = () => structuredClone(fixture.withOutputs.latest.evidence)

test('synthetic summaries with absent and incomplete output receipts conform to the canonical check schema', () => {
  for (const value of [fixture.withoutOutputs, fixture.withOutputs]) assert.deepEqual(runCheckSchema.parse(value), value)
  assert.equal(fixture.withoutOutputs.latest.evidence.checkerSha256.slice(0, 12), fixture.withoutOutputs.latest.checker)
  assert.equal(fixture.withoutOutputs.latest.evidence.outputs, null)
  assert.equal(fixture.withoutOutputs.latest.verdict, 'not-solved')
  assert.equal(fixture.withOutputs.latest.verdict, 'unknown')
  assert.equal(fixture.withOutputs.latest.evidence.outputs.status, 'incomplete')
})

test('legacy check rows remain valid and missing bindings are never synthesized', () => {
  const legacy = { latest: { at: null, commit: null, checker: null, verdict: 'unknown' }, best: null }
  assert.deepEqual(runCheckSchema.parse(legacy), legacy)
  assert.equal(Object.hasOwn(runCheckSchema.parse(legacy).latest, 'evidence'), false)
})

test('the public binding rejects hidden inputs, raw outputs, private locators and custody locations', () => {
  for (const addPrivateField of [
    value => { value.seed = 'hidden' },
    value => { value.inputs.content = 'holdout bytes' },
    value => { value.execution.box = { input: 'private manifest' } },
    value => { value.outputs.source = { kind: 'local', path: '/private/check' } },
    value => { value.outputs.files[0].artifact.locator = { kind: 's3', url: 'https://private' } },
    value => { value.outputs.files[0].content = 'raw evaluation' },
    value => { value.outputs.missing[0].diagnostic = 'private error' },
  ]) {
    const value = evidence()
    addPrivateField(value)
    assert.equal(checkEvidenceSchema.safeParse(value).success, false)
  }
})

test('output references are bounded and links use only the existing same-origin digest route', () => {
  const value = evidence()
  const file = value.outputs.files[0]
  file.path = '.benchmark/evaluation.json'
  assert.equal(checkEvidenceSchema.safeParse(value).success, true)
  for (const path of ['../evaluation.json', 'out/./evaluation.json', '.git/config', 'out/.sidecar/key']) {
    file.path = path
    assert.equal(checkEvidenceSchema.safeParse(value).success, false)
  }
  file.path = 'evaluation.json'
  file.href = `/api/discovery/runs/fixture-run/source/${file.artifact.sha256.slice(7)}`
  assert.equal(checkEvidenceSchema.safeParse(value).success, true)
  for (const href of ['https://private/secret', '/api/discovery/runs/../source/' + 'a'.repeat(64)]) {
    file.href = href
    assert.equal(checkEvidenceSchema.safeParse(value).success, false)
  }
  file.href = null
  value.outputs.files = Array(17).fill(file)
  assert.equal(checkEvidenceSchema.safeParse(value).success, false)
})

test('unrecorded measurements and retention facts stay null, never zero or success', () => {
  const value = {
    contentHash: null, checkerSha256: null, inputs: { sha256: null, count: null }, execution: null,
    outputs: { executionId: null, inputDigest: null, status: null, files: null, missing: null, omitted: null },
  }
  assert.deepEqual(checkEvidenceSchema.parse(value), value)
  value.outputs.status = 'success'
  assert.equal(checkEvidenceSchema.safeParse(value).success, false)
})
