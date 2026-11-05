import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { archiveReceipt, assertReleaseSource, publicationPlan, readRelease, releaseIdentity, verifyReleaseArtifact } from '../tools/release.mjs'

const commit = 'a'.repeat(40)
const info = { ...releaseIdentity({ name: '@drewstone/agent-record', version: '3.0.8' }, commit),
  sha256: 'b'.repeat(64), checksum: 'drewstone-agent-record-3.0.8.tgz.sha256' }
const assets = [
  { name: info.archive, sha256: info.sha256 },
  { name: info.checksum, sha256: createHash('sha256').update(`${info.sha256}  ${info.archive}\n`).digest('hex') },
]
const release = { tag_name: info.tag, target_commitish: commit, draft: false, assets }

test('publication source must be the clean canonical main checkout at the workflow SHA', () => {
  const context = { GITHUB_REPOSITORY: info.repository, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: commit }
  assert.doesNotThrow(() => assertReleaseSource(context, commit, ''))
  assert.throws(() => assertReleaseSource({ ...context, GITHUB_REF: 'refs/heads/feature' }, commit, ''), /exact main/)
  assert.throws(() => assertReleaseSource({ ...context, GITHUB_REPOSITORY: 'other/agent-record' }, commit, ''), /canonical/)
  assert.throws(() => assertReleaseSource(context, 'c'.repeat(40), ''), /exact main/)
  assert.throws(() => assertReleaseSource(context, commit, ' M package.json'), /Tracked source/)
})

test('the packed manifest and actual archive bytes determine the release receipt', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-record-package-test.'))
  const manifest = { name: info.packageName, version: info.version }
  try {
    mkdirSync(join(directory, 'package'))
    const pack = (value) => {
      writeFileSync(join(directory, 'package/package.json'), JSON.stringify(value))
      execFileSync('tar', ['-czf', join(directory, info.archive), '-C', directory, 'package/package.json'])
    }
    pack(manifest)
    const receipt = archiveReceipt(directory, manifest, commit)
    assert.equal(receipt.sha256, createHash('sha256').update(readFileSync(join(directory, info.archive))).digest('hex'))
    assert.equal(receipt.commit, commit)
    const checksum = `${receipt.sha256}  ${receipt.archive}\n`
    writeFileSync(join(directory, receipt.checksum), checksum)
    writeFileSync(join(directory, 'release.json'), JSON.stringify(receipt))
    assert.deepEqual(verifyReleaseArtifact(directory, { manifest, commit }), receipt)
    assert.throws(() => verifyReleaseArtifact(directory, { manifest, commit: 'c'.repeat(40) }), /qualified commit/)
    writeFileSync(join(directory, receipt.checksum), 'changed checksum')
    assert.throws(() => verifyReleaseArtifact(directory, { manifest, commit }), /archive digest/)
    writeFileSync(join(directory, receipt.checksum), checksum)
    pack({ ...manifest, description: 'changed bytes with the same identity' })
    assert.throws(() => verifyReleaseArtifact(directory, { manifest, commit }), /archive digest/)
    pack({ ...manifest, version: '3.0.7' })
    assert.throws(() => archiveReceipt(directory, manifest, commit), /identity differs/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('native release lookup retains drafts as well as published metadata', () => {
  for (const isDraft of [true, false]) {
    const result = readRelease(info.tag, (name, args) => {
      assert.equal(name, 'gh')
      assert.deepEqual(args.slice(0, 3), ['release', 'view', info.tag])
      return JSON.stringify({ tagName: info.tag, targetCommitish: commit, isDraft, assets })
    })
    assert.deepEqual(result, { ...release, draft: isDraft })
  }
})

test('a missing release is distinct from authentication or transport failure', () => {
  const failure = (stderr) => () => { throw Object.assign(new Error('gh failed'), { stderr }) }
  assert.equal(readRelease(info.tag, failure('release not found\n')), null)
  assert.throws(() => readRelease(info.tag, failure('HTTP 403: forbidden')), /gh failed/)
  assert.throws(() => readRelease(info.tag, () => '{}'), /incomplete release/)
})

test('release identity requires the canonical package, stable version and exact source commit', () => {
  for (const version of ['', '03.0.8', '3.0', '3.0.8-beta.1', '3.0.8+build', '3.0.8\n', '9007199254740992.0.0'])
    assert.throws(() => releaseIdentity({ name: info.packageName, version }, commit))
  assert.throws(() => releaseIdentity({ name: 'different-package', version: info.version }, commit))
  for (const value of ['main', commit.slice(0, 8), `${commit}\n`])
    assert.throws(() => releaseIdentity({ name: info.packageName, version: info.version }, value))
})

test('a new release creates an exact tag and draft before uploading both immutable assets', () => {
  assert.deepEqual(publicationPlan(info, null, null), {
    createTag: true, createDraft: true, upload: assets.map((asset) => asset.name), publish: true, alreadyPublished: false,
  })
})

test('an existing matching published release is an idempotent no-op', () => {
  assert.deepEqual(publicationPlan(info, commit, release), {
    createTag: false, createDraft: false, upload: [], publish: false, alreadyPublished: true,
  })
})

test('a retry can finish only the missing asset in its matching draft', () => {
  const draft = { ...release, draft: true, assets: assets.slice(0, 1) }
  assert.deepEqual(publicationPlan(info, commit, draft), {
    createTag: false, createDraft: false, upload: [info.checksum], publish: true, alreadyPublished: false,
  })
})

test('source collisions, unknown draft source and tag mismatches cannot publish', () => {
  assert.throws(() => publicationPlan(info, 'c'.repeat(40), null), /different source/)
  assert.throws(() => publicationPlan(info, null, release), /exact source/)
  assert.throws(() => publicationPlan(info, null, { ...release, draft: true, target_commitish: 'main' }), /exact source/)
  assert.throws(() => publicationPlan(info, commit, { ...release, tag_name: 'v3.0.9' }), /tag/)
})

test('differing archive or checksum bytes are never replaced, even on an interrupted draft', () => {
  for (const draft of [false, true]) for (const changed of [0, 1]) {
    const changedAssets = assets.map((asset, index) => index === changed ? { ...asset, sha256: 'c'.repeat(64) } : asset)
    assert.throws(() => publicationPlan(info, commit, { ...release, draft, assets: changedAssets }), /never replace/)
  }
})

test('published incomplete releases and unexpected draft assets fail without modifying them', () => {
  assert.throws(() => publicationPlan(info, commit, { ...release, assets: assets.slice(0, 1) }), /missing/)
  assert.throws(() => publicationPlan(info, commit, { ...release, draft: true, assets: [...assets, { name: 'unreviewed.zip' }] }), /unrecognized/)
  assert.throws(() => publicationPlan(info, commit, { ...release, assets: [...assets, assets[0]] }), /never replace/)
})
