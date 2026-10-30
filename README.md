# Agent Record

Validated records, research reports, adapters, and command-line ingest/export for recorded agent work. React views live in [Sandbox UI](https://github.com/tangle-network/sandbox-ui); chart geometry and playback live in [Charts](https://github.com/tangle-network/charts).

## Install

```sh
pnpm add "$(gh release view --repo drewstone/agent-record --json assets --jq '.assets[] | select(.name | endswith(".tgz")) | .url')"
```

The ESM package and TypeScript declarations are distributed through GitHub Releases. This package is not published to npm. Use an immutable release asset when pinning a consumer.

```ts
import { parseRecord } from '@drewstone/agent-record/record'

const record = parseRecord(await response.json())
```

`agent-record.v1` contains a run ID, nodes, and timestamped events. Parsing preserves metadata and rejects duplicate identities, invalid timestamps, parent cycles, invalid session joins, and duplicate call IDs within an event. Missing capture, unresolved parents, and unknown measurements remain explicit; a recorded zero stays zero. See [the record format](docs/record-format.md).

## Retained views

```tsx
import { AgentRecord, RecordWorkGraph } from '@tangle-network/sandbox-ui/record'
import '@tangle-network/sandbox-ui/styles'

export function RunPage({ record }) {
  return <><AgentRecord records={[record]} /><RecordWorkGraph record={record} /></>
}
```

Sandbox UI owns the retained hierarchy, transcript, source inspector, measured usage, authored report views, and evidence graph. Hosts supply validated records and control selection/URLs. Charts owns waterfall playback, speed, zoom, and the time cursor. Renderers preserve original event/call identities and never infer missing captures or relationships from names or timing.

The graph model remains available from this package’s `/record` entry. It links only recorded parent IDs, source hashes, claim IDs, reviewer sessions, citations, and profile digests. Missing targets remain unlinked.

Version3 retires this package’s React view exports and stylesheet; import their maintained owners above. Version2 retires Discovery workspace/page exports, its browser bundle, and standalone receipt renderer. Discovery composition lives in the [Tools viewer](https://github.com/drewstone/tangle-tools/tree/main/fleet/discovery_workspace_parts/viewer). Immutable earlier releases and records remain readable.

`runCheckSchema`, `calibrationSchema`, `RunCheck` and `Calibration` expose the existing canonical check model through the root and workspace entries. Optional native provenance and calibration references preserve missing/null metadata as unknown; the writer owns explicit identity evidence and per-amendment binding.


## Adapters and ingest

```ts
import { fromResearchPublication } from '@drewstone/agent-record/adapters/research-publication'

const record = fromResearchPublication(publication)
```

The adapter preserves `research-publication.events.v1` event/source references. It does not review, redact, or sanitize private logs.

```sh
agent-record-ingest RUN_DIR --out record.json --run-id RUN_ID
agent-record-ingest BUNDLE_DIR --out record.json
```

The ingester reads Runtime directories or native-session bundles without writing to them or using the network. Optional `--manifest` verifies input identity; `--native` supplies retained native captures. Anchored event IDs identify source bytes, line/JSON pointers, and items. Repeated conversion of identical inputs produces identical output. See [the ingest contract](docs/record-format.md#agent-runtime-run-directories).

Use `fromHarnessSessions` with the maintained `@tangle-network/harness-sessions` reader for Claude Code, Codex, OpenCode, Pi, Kimi, and Factory sessions. Supply recorded relationships from `@tangle-network/traces`; labels and timestamps do not establish parentage. `fromTraceSpans` and `fromStoryboardSpans` preserve their distinct upstream contracts and do not claim original capture completeness.

## Reports and historical readers

`/report` exports the research-report validator, report-option validator, report types, and LaTeX export. Authored claims and assessments remain distinct from immutable execution records.

```sh
agent-record-report REPORT.json OUTPUT.html
agent-record-report REPORT.json OUTPUT.html --source-search-endpoint /api/sources
```

The CLI uses Sandbox UI’s maintained report assets to write a self-contained interactive report and LaTeX document. Offline reports make no network requests. An optional source-search endpoint must be same-origin. The CLI preserves input-overwrite protection, private output permissions, script hashing, and its restrictive content policy. See [the report contract](docs/research-reports.md).

`/workspace`, `/assessment`, `/publication`, trace projections, and `/schemas/*` remain data contracts. Historical formats keep readers; retiring a view does not rewrite stored records. The immutable source revision/digests in [sources.json](docs/evidence/sources.json) describe archived evidence, including paths that existed in that revision.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:example
node --test tests/example.browser.mjs
pnpm pack
```

Run these through the repository’s native gate. Preserve generated JSON schemas byte-for-byte across renderer moves. Retained-view browser proof lives with Sandbox UI; this repository keeps adapter, wire-format, ingest, CLI/report, and example consumer proof. [Consumer evidence](docs/evidence/README.md) records the checked revisions.

This repository is public. Keep captures in private evidence storage; never commit private logs, tailnet addresses, or recordings. Example checks fetch the original publication bytes at their immutable source revision and verify their recorded digests.

Code is MIT licensed. Original research papers and excerpts retain their source references and rights.

Recorded checker versions in `RunCheck.checkerNames` can carry their own optional provenance and calibration through the same canonical schemas as the current checker. Omitted or null metadata stays unknown; consumers bind metadata to its checker digest and never borrow another version's source or authorship.
