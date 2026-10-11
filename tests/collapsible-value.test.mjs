// A profile value is never cut without a way to see it whole: it shows a preview and "show full (N chars)", expands in
// place, and the page's expand all / collapse all reaches every one. These tests render the components on the server
// and test the rules the browser's clicks follow; the clicks themselves are proven in a browser (README, Release checks).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CollapsibleValue,
  InputView,
  ProfileCanvas,
  ProfileDetail,
  VALUE_PREVIEW,
  ValueControls,
  ValueScope,
  followCommand,
  playInputSchema,
  profileGraphDocumentSchema,
  valueChars,
  valuePreview,
} from '../dist/index.js'
import { sampleProfileGraph } from './fixtures/profile-graph.mjs'

const render = (element) => renderToStaticMarkup(element)
const words = (count) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ')

test('a value of at most the preview shows whole; a longer one shows its first characters on one line', () => {
  assert.equal(VALUE_PREVIEW, 240)
  assert.equal(valuePreview('x'.repeat(240)), null)
  const long = `${'a'.repeat(100)}\n\n   ${'b'.repeat(300)}`
  const head = valuePreview(long)
  assert.equal(head.length, 240)
  assert.equal(head, `${'a'.repeat(100)} ${'b'.repeat(139)}`, 'whitespace runs become one space')
  assert.equal(valuePreview('sha256:' + 'ab'.repeat(32), 23), 'sha256:abababababababab')
  const emoji = `${'x'.repeat(239)}😀${'y'.repeat(50)}`
  assert.equal(valuePreview(emoji), 'x'.repeat(239), 'a surrogate pair is never split')
  assert.equal(valueChars('x'.repeat(5072)), '5,072 chars')
})

test('a short value is plain text and a blank one says why', () => {
  assert.equal(render(createElement(CollapsibleValue, { value: 'claude-opus-5-5', className: 'mono' })), '<span class="mono">claude-opus-5-5</span>')
  assert.equal(render(createElement(CollapsibleValue, { value: null })), '<span class="faint">not set</span>')
  assert.equal(render(createElement(CollapsibleValue, { value: '  \n', empty: 'absent' })), '<span class="faint">absent</span>')
})

test('a long value collapses to a preview with its length, and the whole value is not in the page until it is opened', () => {
  const text = `START ${words(120)} END`
  const html = render(createElement(CollapsibleValue, { value: text }))
  assert.ok(html.includes(`show full (${valueChars(text)})`))
  assert.ok(html.includes('aria-expanded="false"'))
  assert.ok(html.includes('START word0 word1'))
  assert.ok(!html.includes(' END<'), 'the end of the value is not shown while collapsed')
  assert.ok(!html.includes('cv-full'))
  assert.ok(html.includes('…'))
})

test('an opened value is the whole text in a pre-wrap block with its collapse toggle', () => {
  const text = `line one\n  indented line two\n${words(120)}`
  const html = render(createElement(ValueScope, { defaultOpen: true }, createElement(CollapsibleValue, { value: text })))
  assert.ok(html.includes('aria-expanded="true"'))
  assert.ok(html.includes(`collapse (${valueChars(text)})`))
  assert.ok(html.includes(`<span id="`) && html.includes('class="cv-full">line one\n  indented line two\nword0'), 'newlines and indentation are kept for pre-wrap')
  assert.ok(html.includes('word119</span>'), 'the last word is there: nothing is cut')
  assert.ok(!html.includes('cv-head'))
})

test('a command makes a value follow it once, then the reader decides again', () => {
  const state = { open: false, seen: 0 }
  assert.equal(followCommand(state, { openAll: true, epoch: 0 }), state, 'no new command: the value keeps its own state')
  assert.deepEqual(followCommand(state, { openAll: true, epoch: 1 }), { open: true, seen: 1 })
  const readerClosed = { open: false, seen: 1 }
  assert.equal(followCommand(readerClosed, { openAll: true, epoch: 1 }), readerClosed, 'a click after the command is kept')
  assert.deepEqual(followCommand({ open: true, seen: 1 }, { openAll: false, epoch: 2 }), { open: false, seen: 2 }, 'collapse all reaches an opened value')
  assert.deepEqual(followCommand({ open: false, seen: 1 }, { openAll: true, epoch: 2 }), { open: true, seen: 2 }, 'expand all again reaches a value the reader closed')
})

test('the page controls expand and collapse every long value, and are hidden until the page has one', () => {
  const html = render(createElement(ValueScope, null, createElement(ValueControls)))
  assert.ok(html.includes('data-value-command="expand"') && html.includes('>Expand all<'))
  assert.ok(html.includes('data-value-command="collapse"') && html.includes('>Collapse all<'))
  assert.ok(/<div class="cv-bar"[^>]* hidden=""/.test(html), 'nothing long is registered, so the bar is hidden')
})

// ---------------------------------------------------------------------------------- the run page's profile values

const sha = (letter) => `sha256:${letter.repeat(64)}`
const systemPrompt = `SYSTEM-START ${words(300)} SYSTEM-END`
const longInstruction = `INSTRUCTION-START ${words(200)} INSTRUCTION-END`
const tools = Array.from({ length: 24 }, (_, i) => `agent_runtime_coordination_tool_${i}`)

const input = (profile) => ({
  runId: 'sample-20261011a',
  schema: 'discovery.run-input',
  digest: 'd'.repeat(64),
  source: { path: '/runs/sample-20261011a/run-input.json', sha256: 'e'.repeat(64) },
  objective: 'Find it.',
  instruction: null,
  completion: null,
  knowledge: null,
  acceptance: null,
  budget: null,
  continuation: null,
  profile,
  files: [],
})

const profile = {
  name: 'sample-root',
  version: null,
  digest: sha('a'),
  harness: 'claude-code',
  model: 'anthropic/claude-opus-5-5',
  reasoningEffort: 'high',
  credentialSource: 'subscription',
  tools,
  skills: ['research-director'],
  systemPromptSha256: 'f'.repeat(64),
  systemPrompt,
  instructions: [longInstruction, 'Short instruction.'],
}

test('the run input carries the whole system prompt and every instruction beside the hash', () => {
  const parsed = playInputSchema.parse(input(profile))
  assert.equal(parsed.profile.systemPrompt, systemPrompt)
  assert.deepEqual(parsed.profile.instructions, [longInstruction, 'Short instruction.'])
  assert.equal(playInputSchema.parse(input({ ...profile, systemPrompt: undefined, instructions: undefined })).profile.systemPrompt, undefined, 'a document composed before the text was sent still reads')
})

test('the Input page shows every profile value collapsed with its length, and its digest and tools are no longer cut', () => {
  const html = render(createElement(InputView, { input: input(profile), api: '/api/discovery' }))
  const profileBlock = html.slice(html.indexOf('data-input="profile"'), html.indexOf('data-input="files"'))
  assert.ok(profileBlock.includes(`show full (${valueChars(systemPrompt)})`), 'system prompt')
  assert.ok(profileBlock.includes(`show full (${valueChars(longInstruction)})`), 'the long instruction')
  assert.ok(profileBlock.includes('Short instruction.') && !profileBlock.includes('Short instruction.</span> <button'), 'a short instruction is whole')
  assert.ok(profileBlock.includes('Instructions (2)'))
  assert.ok(profileBlock.includes('sha256:aaaaaaaaaaaaaaaa…'), 'the digest keeps its short form')
  assert.ok(profileBlock.includes(`show full (${valueChars(sha('a'))})`), 'and says it is 71 chars')
  assert.ok(profileBlock.includes(`show full (${valueChars(tools.join(', '))})`), 'tools')
  assert.ok(profileBlock.includes('Tools (24)'))
  assert.ok(!profileBlock.includes('SYSTEM-END') && !profileBlock.includes('INSTRUCTION-END'), 'collapsed values do not show their ends')
  assert.ok(profileBlock.includes('research-director'), 'a short list is whole')
  assert.ok(html.includes('data-value-controls'), 'the page has its expand all / collapse all')
})

test('a run input without prompt text still shows the hash and the rest', () => {
  const html = render(createElement(InputView, { input: input({ ...profile, systemPrompt: undefined, instructions: undefined }), api: '/api/discovery' }))
  assert.ok(html.includes('System prompt sha256'))
  assert.ok(!html.includes('data-profile-value="system-prompt"'))
  assert.ok(!html.includes('data-profile-value="instructions"'))
})

test("a profile's detail shows its prompt, instructions and tools with previews instead of one closed fold", () => {
  const doc = profileGraphDocumentSchema.parse(sampleProfileGraph())
  const base = doc.nodes.find((node) => node.kind !== 'root' && node.instructions.length > 0)
  const node = { ...base, systemPrompt, instructions: [longInstruction, ...base.instructions], tools: [...tools], model: { ...base.model, id: 'm'.repeat(300) } }
  const html = render(createElement(ProfileDetail, { doc, node, heading: false, onSelect: () => undefined }))
  assert.ok(!html.includes('<details'), 'no fold hides the prompt')
  assert.ok(html.includes(`show full (${valueChars(systemPrompt)})`))
  assert.ok(html.includes(`show full (${valueChars(longInstruction)})`))
  assert.ok(html.includes(`show full (${valueChars(tools.join(', '))})`))
  assert.ok(html.includes(`show full (${valueChars('m'.repeat(300))})`), 'a long model id is collapsed too')
  assert.ok(html.includes(base.instructions[0]), 'a short instruction is whole')
  assert.ok(html.includes(`${node.digest.slice(0, 19)}…`) && html.includes(`show full (${valueChars(node.digest)})`), 'the digest')
  assert.ok(!html.includes('SYSTEM-END'))
})

test('the profile canvas lists the names a collapsed card sums up, whole and expandable', () => {
  const doc = profileGraphDocumentSchema.parse(sampleProfileGraph())
  const html = render(createElement(ProfileCanvas, { api: '/api/discovery', doc, scope: { kind: 'play', play: 'sample-study', runs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => `sample-study-20261005${x}`) }, selected: null, onSelect: () => undefined }))
  assert.ok(html.includes('data-profile-cluster='), 'the sample play collapses runtime-written profiles into a card')
  const list = html.slice(html.indexOf('data-profile-clusters'))
  assert.ok(list.includes(' wrote '), 'the list says whose profiles they are')
  assert.ok(list.includes('data-value-chars=') || /director/.test(list), 'their names are listed, collapsed past the preview')
  assert.ok(html.includes('data-value-controls'))
})
