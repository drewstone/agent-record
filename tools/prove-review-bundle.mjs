#!/usr/bin/env node
/** Reproduce the 2026-10-07 multi-harness review record without guessing provenance. */
import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { gunzipSync, gzipSync } from 'node:zlib'
import { basename, dirname, join, resolve } from 'node:path'
import { readSessionInput } from '@tangle-network/harness-sessions'
import { fromHarnessSessions } from '../dist/harness-sessions.js'
import { parseRecord } from '../dist/record.js'

const [runRecordPath, reviewManifestPath, piSessionsDir, claimsPath, verdictsPath, outputDir] = process.argv.slice(2)
if (![runRecordPath, reviewManifestPath, piSessionsDir, claimsPath, verdictsPath, outputDir].every(Boolean)) {
  console.error('Usage: node tools/prove-review-bundle.mjs RUN_RECORD.json.gz REVIEW_MANIFEST.json PI_SESSIONS_DIR CLAIMS.json VERDICTS.jsonl OUTPUT_DIR')
  process.exit(2)
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const jsonl = (text) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
const inputBytes = {
  runRecord: await readFile(runRecordPath), reviewManifest: await readFile(reviewManifestPath),
  claims: await readFile(claimsPath), verdicts: await readFile(verdictsPath),
}
const runRecord = parseRecord(JSON.parse(gunzipSync(inputBytes.runRecord)))
const reviewManifest = JSON.parse(inputBytes.reviewManifest)
const claims = JSON.parse(inputBytes.claims).filter((item) => item.run === runRecord.runId)
const verdicts = jsonl(inputBytes.verdicts.toString('utf8')).filter((item) => item.run === runRecord.runId)
const gaps = [...(runRecord.coverage.gaps ?? [])]
const files = []
const skipped = []
const coalesced = []
const sessionIds = new Map()
const verdictBySession = new Map(verdicts.map((item) => [item.id, item]))

const reviewGroups = new Map()
for (const [relative, entry] of Object.entries(reviewManifest.files)) {
  const match = basename(relative).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)
  if (!match) throw new Error(`Review copy has no recorded UUID in its filename: ${relative}`)
  const list = reviewGroups.get(match[1]) ?? []
  list.push({ path: resolve(dirname(reviewManifestPath), relative), relative, ...entry })
  reviewGroups.set(match[1], list)
}
for (const [id, copies] of reviewGroups) {
  const hashes = new Set(copies.map((copy) => copy.sha256))
  if (hashes.size > 1) {
    const ordered = [...copies].sort((a, b) => b.bytes - a.bytes)
    const longest = await readFile(ordered[0].path)
    if (digest(longest) !== ordered[0].sha256) throw new Error(`Review manifest digest mismatch: ${ordered[0].relative}`)
    let exactPrefixes = true
    for (const copy of ordered.slice(1)) {
      const bytes = await readFile(copy.path)
      if (digest(bytes) !== copy.sha256) throw new Error(`Review manifest digest mismatch: ${copy.relative}`)
      if (!longest.subarray(0, bytes.length).equals(bytes)) exactPrefixes = false
    }
    if (exactPrefixes) {
      coalesced.push({ nativeSessionId: id, retained: ordered[0].relative,
        exactPrefixes: ordered.slice(1).map(({ relative, sha256 }) => ({ relative, sha256 })) })
      files.push({ ...ordered[0], expectedId: id, harness: ordered[0].harness, copyCount: copies.length })
      continue
    }
    skipped.push({ code: 'conflicting-native-copies', nativeSessionId: id, copies: copies.map(({ relative, sha256 }) => ({ relative, sha256 })) })
    gaps.push({ nodeId: null, code: 'conflicting-native-copies', detail: `Session ${id} has ${copies.length} non-prefix copies with different digests; none was chosen` })
    continue
  }
  files.push({ ...copies[0], expectedId: id, harness: copies[0].harness, copyCount: copies.length })
}
for (const name of await readdir(piSessionsDir)) {
  if (!name.endsWith('.jsonl')) continue
  const id = name.replace(/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z_/, '').replace(/\.jsonl$/, '')
  if (!verdictBySession.has(id)) {
    skipped.push({ code: 'other-run-or-unassigned-pi-session', nativeSessionId: id, path: name })
    continue
  }
  files.push({ path: resolve(piSessionsDir, name), relative: name, harness: 'pi', expectedId: id, copyCount: 1 })
}

const projected = { nodes: [], events: [], artifacts: [], sources: [], gaps: [] }
for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
  const bytes = await readFile(file.path)
  const sha256 = digest(bytes)
  if (file.sha256 && sha256 !== file.sha256) throw new Error(`Review manifest digest mismatch: ${file.relative}`)
  const session = readSessionInput(file.harness, { text: bytes.toString('utf8') }, { label: file.path })
  if (session.nativeSessionId !== file.expectedId) throw new Error(`Native session ID differs from retained filename: ${file.relative}: ${session.nativeSessionId}`)
  if (sessionIds.has(session.nativeSessionId)) throw new Error(`Duplicate selected native session ID: ${session.nativeSessionId}`)
  const part = fromHarnessSessions([session], { recordId: runRecord.runId, title: runRecord.title })
  projected.nodes.push(...part.nodes)
  projected.events.push(...part.events)
  projected.artifacts.push(...(part.artifacts ?? []))
  projected.sources.push(...part.sources)
  projected.gaps.push(...(part.coverage.gaps ?? []).filter((gap) => gap.code !== 'parent-unjoined'))
  sessionIds.set(session.nativeSessionId, {
    nodeId: part.nodes[0].id,
    parentNativeSessionId: session.parentNativeSessionId,
    path: file.path,
    sha256,
    harness: session.harness,
    messages: session.messages.length,
    tools: session.toolCalls.length,
    events: part.events.length,
    captureStatus: part.nodes[0].capture.status,
    copyCount: file.copyCount,
  })
}

const nodesByNativeId = new Map()
for (const node of projected.nodes) nodesByNativeId.set(node.nativeSessionId, [...(nodesByNativeId.get(node.nativeSessionId) ?? []), node])
for (const node of projected.nodes) {
  const parentId = sessionIds.get(node.nativeSessionId).parentNativeSessionId
  if (!parentId) continue
  const matches = nodesByNativeId.get(parentId) ?? []
  if (matches.length === 1) {
    node.parent = matches[0].id
    node.joinBasis = 'recorded-session-id'
    node.joinProof = { parentNativeSessionId: parentId }
  } else {
    projected.gaps.push({ nodeId: node.id, code: 'parent-unjoined', detail: `No unique retained session with recorded ID ${parentId}` })
  }
}

const claimById = new Map(claims.map((item) => [item.id, item]))
const claimRecords = claims.map((item) => ({ pageSha256: item.sha, claimId: item.id, statement: item.claim, runId: item.run }))
const pageRoot = join(homedir(), '.cache', 'discovery-workspace', 'api', 'findings', runRecord.runId, 'pages')
const artifactRecords = []
for (const sha of new Set(claimRecords.map((item) => item.pageSha256))) {
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`Claim page has no full SHA-256 digest: ${sha}`)
  const path = join(pageRoot, `${sha}.md`)
  const bytes = await readFile(path).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!bytes) {
    gaps.push({ nodeId: null, code: 'claim-page-missing', detail: `Claim page ${sha} is absent from the local cache` })
    continue
  }
  if (digest(bytes) !== sha) throw new Error(`Claim page digest mismatch: ${path}`)
  artifactRecords.push({ id: `page:${sha}`, kind: 'knowledge-page', title: `Research page ${sha.slice(0, 12)}`, digest: sha,
    source: { path, sha256: sha } })
  projected.sources.push({ path, sha256: sha, bytes: bytes.length })
}
const verdictRecords = []
for (const item of verdicts) {
  const claimId = item.id.replace(/^math-/, '')
  const claim = claimById.get(claimId)
  const reviewer = sessionIds.get(item.id)
  if (!claim || !reviewer || item.id !== `math-${claim.id}`) {
    gaps.push({ nodeId: reviewer?.nodeId ?? null, code: 'verdict-unjoined', detail: `No exact claim and Pi session ID for verdict ${item.id}` })
    continue
  }
  verdictRecords.push({ id: `glm:${item.id}`, subject: { pageSha256: claim.sha, claimId: claim.id }, reviewerSessionNodeId: reviewer.nodeId,
    judgment: item.glm.correct, runId: item.run, model: item.model, evidenceSufficient: item.glm.evidence_sufficient })
}
const reviewedNodeIds = new Set(verdictRecords.map((item) => item.reviewerSessionNodeId))
for (const node of projected.nodes) if (!node.parent && !reviewedNodeIds.has(node.id))
  gaps.push({ nodeId: node.id, code: 'research-run-unjoined', detail: 'No recorded parent session ID links this review to the research run' })

const sourceByKey = new Map([...runRecord.sources, ...projected.sources].map((source) => [`${source.path}\0${source.sha256 ?? ''}`, source]))
const combined = parseRecord({ ...runRecord, title: `${runRecord.title} · 2026-10-07 reviews`, idScheme: 'mixed-bundle.v1',
  nodes: [...runRecord.nodes, ...projected.nodes], events: [...runRecord.events, ...projected.events],
  sources: [...sourceByKey.values()], artifacts: [...(runRecord.artifacts ?? []), ...projected.artifacts, ...artifactRecords],
  claims: [...(runRecord.claims ?? []), ...claimRecords], verdicts: [...(runRecord.verdicts ?? []), ...verdictRecords],
  coverage: { ...runRecord.coverage, completeOriginalCapture: false,
    publicContent: 'Review transcripts are retained native copies; inspect before publication',
    gaps: [...gaps, ...projected.gaps] },
})
await mkdir(outputDir, { recursive: true, mode: 0o700 })
const recordPath = join(outputDir, `${runRecord.runId}-review-bundle.json.gz`)
const output = Buffer.from(JSON.stringify(combined))
await writeFile(recordPath, gzipSync(output), { mode: 0o600 })
const proof = {
  schema: 'agent-record.bundle-proof.v1', runId: runRecord.runId,
  inputs: { runRecordPath: resolve(runRecordPath), reviewManifestPath: resolve(reviewManifestPath), piSessionsDir: resolve(piSessionsDir), claimsPath: resolve(claimsPath), verdictsPath: resolve(verdictsPath),
    sha256: Object.fromEntries(Object.entries(inputBytes).map(([name, bytes]) => [name, digest(bytes)])) },
  record: { path: recordPath, sha256: digest(output), bytes: output.length, nodes: combined.nodes.length, events: combined.events.length,
    claims: claimRecords.length, verdicts: verdictRecords.length, pageArtifacts: artifactRecords.length },
  sessions: [...sessionIds.entries()].map(([nativeSessionId, details]) => ({ nativeSessionId, ...details })),
  coalesced, skipped, gaps: combined.coverage.gaps,
}
await writeFile(join(outputDir, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({ record: proof.record, sessions: proof.sessions.length, skipped: skipped.length, gaps: proof.gaps.length }))
