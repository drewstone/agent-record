import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parseResearchReport, reportToLatex } from '../dist/report.js'
import { fromResearchPublication } from '../dist/research-publication.js'
import { readReportLocation, reportLocationSearch } from '../src/report-selection.ts'
import { advancePlayback } from '../src/viewer/playback.ts'
import { renderReportHtml } from '../tools/render-report.mjs'

const raw = () => ({
  schema: 'agent-research-report.v1',
  id: 'unit-fixture',
  title: 'Unit fixture',
  generatedAt: '2026-10-02T12:00:00Z',
  summary: 'Synthetic boundary fixture, never published as research.',
  plays: [
    {
      id: 'play',
      title: 'Unobserved play',
      summary: 'No trace supplied',
      updatedAt: null,
      status: null,
      claims: [
        {
          id: 'question',
          statement: 'Unanswered question',
          status: 'unresolved',
          evidence: [],
        },
      ],
    },
  ],
})

test('unknown state and absent trace remain unknown through rendering and export', () => {
  const data = parseResearchReport(raw())
  const html = renderReportHtml(data, { css: '', script: '' })
  assert.match(html, /No event record was supplied/)
  assert.match(html, /State unknown/)
  assert.match(reportToLatex(data), /State: Unknown · Updated: Unknown/)
  assert.match(
    reportToLatex(data),
    /Topology, activity, and cost are unknown/,
  )
})

test('assessed claims and observed answers require evidence', () => {
  const claim = raw()
  claim.plays[0].claims[0].status = 'supported'
  assert.throws(() => parseResearchReport(claim), /needs evidence/)
  const question = raw()
  question.questionCoverage = [
    {
      id: 'C01',
      question: 'What happened?',
      status: 'observed',
      evidence: [],
    },
  ]
  assert.throws(() => parseResearchReport(question), /needs evidence/)
})

test('source inspection cannot bind to another play or a fabricated event', () => {
  const data = raw()
  data.plays[0].claims[0].evidence = [{ eventId: 'absent' }]
  assert.throws(
    () => parseResearchReport(data),
    /must exist in this play record/,
  )
  data.plays[0].claims[0].evidence = [
    { path: 'source.md', url: 'javascript:alert(1)' },
  ]
  assert.throws(() => parseResearchReport(data), /HTTP or HTTPS/)
})

test('duplicate identities and inverted reporting windows are rejected', () => {
  const data = raw()
  data.plays.push(data.plays[0])
  assert.throws(() => parseResearchReport(data), /Play IDs must be unique/)
  data.plays.pop()
  data.window = { from: '2026-10-02T12:00:00Z', to: '2026-10-01T12:00:00Z' }
  assert.throws(() => parseResearchReport(data), /end after it starts/)
})

test('all published events and source references survive attached report validation', async () => {
  const ids = [
    'ftqc-zips-2026-08-05-r1',
    'fc-audit-smoke-a',
    'q-conj-entropy-bcww-repair',
    'q-q36-lw6-unbounded-ladder',
    'q-ca-bcww-shareable-pkg',
  ]
  let count = 0
  for (const id of ids) {
    const record = fromResearchPublication(
      JSON.parse(
        await readFile(
          new URL(
            '../examples/react/public/records/' + id + '.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    )
    const data = raw()
    data.plays[0].record = record
    const parsed = parseResearchReport(data)
    assert.deepEqual(parsed.plays[0].record.events, record.events)
    assert.deepEqual(parsed.plays[0].record.sources, record.sources)
    count += record.events.length
  }
  assert.equal(count, 1054)
})

test('LaTeX treats supplied markup as text and exports every observation and source', () => {
  const data = raw()
  data.plays[0].claims[0].statement = String.raw`\input{secret} 50% & a_b $x$`
  data.plays[0].observations = [
    {
      id: 'wait',
      kind: 'wait',
      title: 'Unknown wait',
      body: 'The source did not retain a reason.',
      evidence: [{ path: 'receipt.json', sha256: 'a'.repeat(64), line: 3 }],
    },
  ]
  data.plays[0].questionCoverage = [
    {
      id: 'C01',
      question: 'Wait reason?',
      status: 'unavailable',
      evidence: [],
    },
  ]
  const tex = reportToLatex(parseResearchReport(data), 'play')
  assert.ok(
    tex.includes(
      String.raw`\textbackslash{}input\{secret\} 50\% \& a\_b \$x\$`,
    ),
  )
  assert.match(tex.replaceAll('\\allowbreak{}', ''), /SHA-256 a{64}/)
  assert.match(tex, /C01 · unavailable/)
  assert.match(tex, /Unknown wait/)
  assert.throws(
    () => reportToLatex(parseResearchReport(data), 'absent'),
    /Unknown play/,
  )
})

test('LaTeX retains Unicode math and complete long references with safe wrapping', () => {
  const data = raw()
  const math = 'x² + α ≥ 0; β ∈ ℝ, y ≈ 1/3; Δ ≤ 2 × 10−3 → ∞'
  const path =
    '/research/' + 'long_source_name-'.repeat(12) + 'proof{final}_50%.md'
  const sha256 = '0123456789abcdef'.repeat(4)
  data.plays[0].claims[0].statement = math
  data.plays[0].claims[0].evidence = [{ path, sha256 }]
  const tex = reportToLatex(parseResearchReport(data))
  assert.ok(tex.includes(math))
  assert.ok(tex.includes('\\setmainfont{DejaVuSans.ttf}'))
  assert.ok(tex.includes('\\tracinglostchars=3'))
  assert.ok(tex.includes('\\allowbreak{}'))
  const unwrapped = tex.replaceAll('\\allowbreak{}', '')
  assert.ok(
    unwrapped.includes(
      path
        .replaceAll('_', '\\_')
        .replaceAll('{', '\\{')
        .replaceAll('}', '\\}')
        .replaceAll('%', '\\%'),
    ),
  )
  assert.ok(unwrapped.includes(sha256))
})

test('standalone HTML contains escaped data and a hash-scoped script policy', () => {
  const data = raw()
  data.title = '</script><img src=x onerror=alert(1)>'
  data.summary = '<style>body{display:none}</style>'
  const script = '/* standalone test */'
  const html = renderReportHtml(parseResearchReport(data), {
    css: '',
    script,
  })
  const hash = createHash('sha256').update(script).digest('base64')
  assert.ok(html.includes("script-src 'sha256-" + hash + "'"))
  assert.ok(html.includes("connect-src 'none'"))
  assert.equal((html.match(/<script\b/g) ?? []).length, 2)
  const embedded = html.match(
    /type="application\/json">([\s\S]*?)<\/script>/,
  )[1]
  assert.equal(JSON.parse(embedded).title, data.title)
  assert.ok(!embedded.includes('<'))
})

test('the installed executable follows package symlinks and writes both exports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-record-cli-'))
  try {
    const executable = join(directory, 'agent-record-report.mjs')
    const input = join(directory, 'report.json')
    const output = join(directory, 'report.html')
    await symlink(
      fileURLToPath(new URL('../tools/render-report.mjs', import.meta.url)),
      executable,
    )
    await writeFile(input, JSON.stringify(raw()))
    const receipt = JSON.parse(
      execFileSync(process.execPath, [executable, input, output], {
        encoding: 'utf8',
      }),
    )
    assert.equal(receipt.plays, 1)
    assert.equal(receipt.html, output)
    assert.match(await readFile(output, 'utf8'), /Unobserved play/)
    assert.match(
      await readFile(join(directory, 'report.tex'), 'utf8'),
      /Unanswered question/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the renderer can be imported by a stdin module without an entry file', () => {
  const renderer = new URL('../tools/render-report.mjs', import.meta.url).href
  const result = execFileSync(
    process.execPath,
    ['--input-type=module', '-'],
    {
      input: `const { renderReportHtml } = await import(${JSON.stringify(renderer)}); process.stdout.write(typeof renderReportHtml)`,
      encoding: 'utf8',
    },
  )
  assert.equal(result, 'function')
})

test('playback uses recorded timestamps, explicit speed, and clamps at the endpoint', () => {
  const base = {
    cutoff: 1000,
    start: 1000,
    end: 301000,
    elapsedMs: 1000,
    speed: 1,
    mode: 'time',
    eventTimes: [1000, 1500, 1500, 80000, 301000],
  }
  assert.equal(advancePlayback(base), 11000)
  assert.equal(advancePlayback({ ...base, speed: 4 }), 41000)
  assert.equal(advancePlayback({ ...base, mode: 'events' }), 1500)
  assert.equal(
    advancePlayback({ ...base, mode: 'events', cutoff: 1500 }),
    80000,
  )
  assert.equal(advancePlayback({ ...base, elapsedMs: 900000 }), 301000)
  assert.equal(advancePlayback({ ...base, elapsedMs: -100 }), 1000)
})

test('retained documents and unknown measurements survive JSON and summary export', () => {
  const input = raw()
  input.plays[0].documents = [{ id:'doc', path:'notes/a.md', title:'Original notes', content:'# Finding\nBody', sha256:'a'.repeat(64), originalPath:'/private/a.md' }]
  input.plays[0].metrics = [{ id:'cost',label:'Billed cost',value:null,coverage:'No invoice join',knownness:'unmeasured',source:{path:'notes/a.md'} }]
  const parsed = parseResearchReport(input)
  assert.equal(parsed.plays[0].documents[0].originalPath, '/private/a.md')
  assert.equal(parsed.plays[0].metrics[0].knownness, 'unmeasured')
  const latex = reportToLatex(parsed)
  assert.match(latex, /Billed cost: Unknown/)
  assert.match(latex, /No invoice join/)
  assert.match(latex, /Original notes/)
  assert.match(latex, /Full document contents are retained/)
  input.plays[0].documents.push({...input.plays[0].documents[0],id:'second'})
  assert.throws(() => parseResearchReport(input), /Document paths must be unique/)
})

test('untrusted retained Markdown renders offline without executable HTML or remote images', () => {
  const input = raw()
  input.plays[0].documents = [{id:'doc',path:'test.md',title:'Untrusted document',content:'# Report\n<script>window.compromised=true</script>\n\n![remote](https://example.test/pixel)\n\n[execute](javascript:alert(1))\n\n$600/kg against $800/kW\n\n$$\nE=mc^2\n$$'}]
  const html = renderReportHtml(parseResearchReport(input), {css:'',script:''})
  const rendered = html.split('<script id="research-report-data"')[0]
  assert.doesNotMatch(rendered, /<script>|<img[^>]+example|href="javascript:/)
  assert.match(rendered, /<math /)
  assert.match(rendered, /\$600\/kg against \$800\/kW/)
  assert.match(rendered, /Source fingerprint|Untrusted document/)
})


test('standalone source citations remain in their named play and exact document', () => {
  const value = raw()
  value.plays[0].documents = [{ id: 'doc', path: 'retained/result.md', title: 'Result', content: 'one\ntwo', kind: 'knowledge' }]
  value.plays.push({ id: 'other', title: 'Other play', summary: '', updatedAt: null, status: null, claims: [], documents: [
    { id: 'private-doc', path: 'other/result.md', title: 'Other result', content: 'other', kind: 'knowledge' },
  ] })
  const report = parseResearchReport(value)
  assert.deepEqual(readReportLocation(report, '?play=play&document=retained%2Fresult.md&line=2'), {
    playId: 'play', document: { playId: 'play', path: 'retained/result.md', line: 2 },
  })
  for (const query of ['?document=retained/result.md', '?play=missing', '?play=play&document=other/result.md',
    '?play=play&document=../other/result.md', '?play=play&document=https://example.com/source',
    '?play=play&line=1', '?play=play&play=other', '?play=play&document=retained/result.md&line=-1']) {
    assert.ok(readReportLocation(report, query).error, query)
  }
  assert.equal(reportLocationSearch('?old=kept&document=old&line=5', 'other'), '?old=kept&play=other')
  const query = reportLocationSearch('', 'play', { playId: 'play', path: 'retained/result.md', line: 2 })
  assert.equal(readReportLocation(report, query).document.line, 2)
})
