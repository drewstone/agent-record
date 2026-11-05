// Package release only: qualify elsewhere, bind these bytes to that exact source, and never replace a tag or asset.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repository = 'drewstone/agent-record'
const packageName = '@drewstone/agent-record'
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const command = (name, args) => execFileSync(name, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim()

export function releaseIdentity(manifest, commit) {
  if (manifest.name !== packageName || !stableVersion.test(manifest.version ?? '') ||
      manifest.version.split('.').some((part) => !Number.isSafeInteger(Number(part))))
    throw new Error('Release requires @drewstone/agent-record with a stable numeric major.minor.patch version')
  if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('Release requires a full source commit SHA')
  return { repository, packageName, version: manifest.version, tag: `v${manifest.version}`, commit,
    archive: `drewstone-agent-record-${manifest.version}.tgz` }
}

export function archiveReceipt(directory, manifest, commit) {
  const info = releaseIdentity(manifest, commit)
  const archive = join(directory, info.archive)
  const packed = JSON.parse(command('tar', ['-xOf', archive, 'package/package.json']))
  if (packed.name !== info.packageName || packed.version !== info.version)
    throw new Error('Packed package identity differs from the qualified source')
  const sha256 = hash(readFileSync(archive))
  return { ...info, sha256, checksum: `${info.archive}.sha256` }
}

const checksumText = (info) => `${info.sha256}  ${info.archive}\n`
const assetsOf = (info) => [
  { name: info.archive, sha256: info.sha256 },
  { name: info.checksum, sha256: hash(checksumText(info)) },
]

/** A retry may finish its matching draft; a published release must already match completely. */
export function publicationPlan(info, tagCommit, release) {
  if (tagCommit !== null && tagCommit !== info.commit) throw new Error('Tag already names different source; bump the version')
  if (release && release.tag_name !== info.tag) throw new Error('Release tag does not match the package version')
  if (release && tagCommit === null && (!release.draft || release.target_commitish !== info.commit))
    throw new Error('Existing release cannot be bound to this exact source')
  const expected = assetsOf(info), existing = release?.assets ?? []
  if (existing.some((asset) => !expected.some((item) => item.name === asset.name)))
    throw new Error('Existing release has unrecognized assets; refusing to publish or change them')
  const upload = []
  for (const asset of expected) {
    const matches = existing.filter((item) => item.name === asset.name)
    if (matches.length > 1 || (matches.length === 1 && matches[0].sha256 !== asset.sha256))
      throw new Error(`Existing asset differs: ${asset.name}; never replace published bytes`)
    if (matches.length === 0) {
      if (release && !release.draft) throw new Error(`Published release is missing ${asset.name}; refusing to change it`)
      upload.push(asset.name)
    }
  }
  return { createTag: tagCommit === null, createDraft: release === null, upload,
    publish: release === null || release.draft, alreadyPublished: release !== null && !release.draft }
}

export function assertReleaseSource(context, commit, dirty) {
  if (context.GITHUB_REPOSITORY !== repository || context.GITHUB_REF !== 'refs/heads/main' || context.GITHUB_SHA !== commit)
    throw new Error('Release must run for the exact main checkout in the canonical repository')
  if (dirty) throw new Error('Tracked source changed after checkout')
}

function checkedSource() {
  const commit = command('git', ['rev-parse', 'HEAD'])
  assertReleaseSource(process.env, commit, command('git', ['status', '--porcelain', '--untracked-files=no']))
  return { manifest: JSON.parse(readFileSync('package.json', 'utf8')), commit }
}

function stage(directory, source) {
  const info = archiveReceipt(directory, source.manifest, source.commit)
  writeFileSync(join(directory, info.checksum), checksumText(info))
  writeFileSync(join(directory, 'release.json'), `${JSON.stringify(info, null, 2)}\n`)
  return info
}

export function verifyReleaseArtifact(directory, source) {
  const info = archiveReceipt(directory, source.manifest, source.commit)
  const saved = JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8'))
  if (JSON.stringify(info) !== JSON.stringify(saved) || readFileSync(join(directory, info.checksum), 'utf8') !== checksumText(info))
    throw new Error('Downloaded release artifact does not match the qualified commit and archive digest')
  return info
}

function api(path, args = [], missing = false) {
  try { return JSON.parse(command('gh', ['api', `repos/${repository}/${path}`, ...args])) }
  catch (error) {
    if (missing && /\(HTTP 404\)/.test(String(error.stderr))) return null
    throw error
  }
}

function tagSource(tag) {
  let value = api(`git/ref/tags/${tag}`, [], true)?.object
  for (let depth = 0; value?.type === 'tag' && depth < 8; depth++) value = api(`git/tags/${value.sha}`).object
  if (value && value.type !== 'commit') throw new Error('Release tag does not resolve to a commit')
  return value?.sha ?? null
}

// Native gh also finds pending drafts; the REST releases/tags endpoint returns published releases only.
export function readRelease(tag, run = command) {
  try {
    const value = JSON.parse(run('gh', ['release', 'view', tag, '--repo', repository, '--json', 'tagName,targetCommitish,isDraft,assets']))
    if (typeof value.tagName !== 'string' || typeof value.isDraft !== 'boolean' || !Array.isArray(value.assets))
      throw new Error('GitHub returned an incomplete release snapshot')
    return { tag_name: value.tagName, target_commitish: value.targetCommitish, draft: value.isDraft, assets: value.assets }
  } catch (error) {
    if (String(error.stderr ?? '').trim() === 'release not found') return null
    throw error
  }
}

function releaseState(info) {
  const tagCommit = tagSource(info.tag)
  const release = readRelease(info.tag)
  if (!release) return { tagCommit, release: null }
  const directory = mkdtempSync(join(tmpdir(), 'agent-record-verify.'))
  try {
    for (const asset of release.assets) {
      if (!assetsOf(info).some((expected) => expected.name === asset.name)) continue
      command('gh', ['release', 'download', info.tag, '--repo', repository, '--pattern', asset.name, '--dir', directory])
      asset.sha256 = hash(readFileSync(join(directory, asset.name)))
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
  return { tagCommit, release }
}

function publish(directory, info) {
  const current = releaseState(info), plan = publicationPlan(info, current.tagCommit, current.release)
  if (plan.alreadyPublished) return { status: 'already-published', ...info }
  if (plan.createTag) api('git/refs', ['--method', 'POST', '-f', `ref=refs/tags/${info.tag}`, '-f', `sha=${info.commit}`])
  if (plan.createDraft) {
    const notes = join(directory, 'notes.md')
    writeFileSync(notes, `Qualified package from source commit ${info.commit}.\n\nArchive SHA256: \`${info.sha256}\`.\n\nThe frozen dependency install, native build, typecheck, tests and pack completed before publication.\n`)
    command('gh', ['release', 'create', info.tag, '--repo', repository, '--verify-tag', '--draft', '--target', info.commit,
      '--title', `Agent Record ${info.version}`, '--notes-file', notes])
  }
  if (plan.upload.length) command('gh', ['release', 'upload', info.tag, '--repo', repository, ...plan.upload.map((name) => join(directory, name))])
  const uploaded = releaseState(info), ready = publicationPlan(info, uploaded.tagCommit, uploaded.release)
  if (ready.createTag || ready.createDraft || ready.upload.length) throw new Error('Release assets are not complete')
  if (ready.publish) command('gh', ['release', 'edit', info.tag, '--repo', repository, '--verify-tag', '--draft=false'])
  const finished = releaseState(info), done = publicationPlan(info, finished.tagCommit, finished.release)
  if (!done.alreadyPublished) throw new Error('Release publication was not confirmed')
  return { status: 'published', ...info }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, directory] = process.argv.slice(2)
  if (!['stage', 'publish'].includes(mode) || !directory) throw new Error('Usage: node tools/release.mjs <stage|publish> <artifact-directory>')
  const source = checkedSource()
  const result = mode === 'stage' ? stage(directory, source) : publish(directory, verifyReleaseArtifact(directory, source))
  console.log(JSON.stringify(result, null, 2))
}
