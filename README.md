# Agent Record

A React component for reading what an agent team did: conversations, tool inputs and outputs, topology, timelines, and recorded token usage.

[Live example](https://drewstone.github.io/agent-record/) · [Research using the viewer](https://drewstone.github.io/research/bcww/#agent-record)

![Agent Record with a real research run](docs/screenshot.png)

## Install

```sh
pnpm add "$(gh release view --repo drewstone/agent-record --json assets --jq '.assets[] | select(.name | endswith(".tgz")) | .url')" react react-dom
```

The command resolves the package tarball from the latest GitHub release. It is an ESM package with TypeScript declarations and CSS.
It is distributed through GitHub Releases; this version is not published to the npm registry.
React 18.3 and 19 are supported peer versions; release verification uses React 19.

```tsx
import { AgentRecord, parseRecord } from '@drewstone/agent-record'
import '@drewstone/agent-record/styles.css'

const record = parseRecord(await response.json())

export function RunPage() {
  return <AgentRecord records={[record]} />
}
```

Load the renderer stylesheet in the host's main stylesheet before its Tailwind utilities, rather than from a lazy route, so the host's responsive layout keeps precedence.


Your application loads the data and decides which content may be displayed.
Sandbox UI owns the retained agent hierarchy and conversation. The host owns record selection and URLs. The component makes no network requests, stores no data, or starts agents.
It can render on the server; hydration enables the interactive controls.
Use a client component when embedding it in a React Server Components application.

## Research reports

Use `ResearchReport` to read authored claims, limitations, checks, and source references alongside each play’s recorded events.
A compact play navigation opens Results, Activity, or Sources in one reading area. Search retained activity across agents, inspect readable tool inputs/results, and open exact source citations. Missing conversation capture remains explicit.
The offline `agent-record-report REPORT.json OUTPUT.html` command creates a self-contained interactive report and LaTeX document.
Reports remain separate from immutable execution records. Source search can optionally use one commissioned same-origin endpoint; offline reports make no network requests.
See [the report contract and exports](docs/research-reports.md).

## Input

`agent-record.v1` contains a run ID, title, nodes, and timestamped events.
`parseRecord(unknown)` validates the record and preserves additional metadata.
It rejects duplicate node/event IDs, invalid timestamps, parent cycles, invalid session joins, and duplicate published call IDs within an event.

Nodes distinguish agents, native sessions, and findings.
An importer can join a session to an agent with `agentId`; the viewer never infers that relationship from names or timing.
Roles and assignments are independent fields.
A parent missing from a partial capture remains unresolved.

Events carry messages, tool inputs/results, usage, or lifecycle information.
Source paths, hashes, original IDs, timestamps, publication notes, and unknown metadata remain in the downloadable record.
Missing measurements remain unknown.
An explicit zero remains zero.

See [the record format](docs/record-format.md) for the complete input rules and an example.

### Existing blog records

```ts
import { fromResearchPublication } from '@drewstone/agent-record/adapters/research-publication'

const record = fromResearchPublication(reviewedPublication)
```

This adapter accepts the blog's `research-publication.events.v1` files.
It preserves their events and source references while translating node identities into the reusable format.
It does not review, redact, or sanitize private logs.

### Agent-runtime run directories

`node tools/ingest.mjs <dir> --out record.json [--run-id <id>] [--manifest <snapshot.json>] [--native <dir>]` converts an agent-runtime run directory, including Claude Code, OpenCode, pi, Codex and Kimi conversations where the run retained them, or a bundle of native sessions (`bundle.json`). Event IDs are anchored to the stored bytes they came from (`anchor.v1`, see [the record format](docs/record-format.md#event-ids-idscheme-anchorv1)).
Each node's capture channel and every missing transcript are recorded in the output.
See [the record format](docs/record-format.md#agent-runtime-run-directories).

### Shared native sessions

Use `@tangle-network/harness-sessions` to read native Claude Code, Codex, OpenCode, Pi, Kimi and Factory sessions. Pass its normalized sessions to `fromHarnessSessions` for a browser-renderable record; pass recorded relationship facts from `@tangle-network/traces` when a workflow should draw parent edges. This projection does not parse a second native format or infer joins from names or time.

```ts
import { readerFor } from '@tangle-network/harness-sessions'
import { fromHarnessSessions } from '@drewstone/agent-record/adapters/harness-sessions'

const session = await readerFor('pi').read(ref)
const record = fromHarnessSessions([session], { recordId: 'review-1', title: 'Review' })
```

Session projection event IDs use `shared-session.v1`, not publication `anchor.v1`. Keep the existing anchored converter for published research records until the shared readers expose equivalent source locations and publication verification passes. Review raw text and paths before serving the projection publicly.

### Live native activity

Browser hosts import the existing `projectPartEvents` projection from `@drewstone/agent-record/record`. It shares retained ingest's native-part interpretation; the host supplies source anchors, clipping, classification and the event sink. The record entry uses no Node APIs.

`node tools/ingest.mjs <home> --activity --since <ISO> --out activity.json` reads Codex account session roots and the default Codex/Claude homes. Resolved roots and recorded session identities are deduplicated. The importer writes `agent-record.activity.v1`: sessions grouped by native identity, with classified tool/model/idle intervals, mixed activities, edit method and target category, and capture coverage. Command text and tool output are used for static classification but omitted from this metadata export; lane names, cwd and seat still require review before public use.

The model interval immediately before an action is charged to that action. Codex per-step `token_usage_record` values support an **estimated** split into overhead, reading uncached context, writing and reasoning. The fitted weights and their limitations are recorded once at `modelSplitMethod`; parts sum to the observed interval. Missing per-step usage, including Claude's unavailable reasoning breakdown, stays unknown. This is elapsed capture time, not a measurement of cognition.

`--audit <JSON>` replays the same classifier against `{calls: [{id, name, input, expected, expectedAlternatives?}]}`. Output reports strict primary-label accuracy separately from accepted alternatives. Retain the frozen labels, classifier hash, selection rule and population beside any reported audit score; an inspected sample is development data on subsequent runs.

```js
import { activityToRecord } from './tools/activity/sessions.mjs'
// Feed this projection to the existing RecordViewer / Timeline.
const record = activityToRecord(activity)
```

The existing Timeline draws imported intervals on a linear elapsed-time axis with activity colors. Ordinary point-event records keep their existing axis and event clustering. Classification happens in the importer, never in the viewer.

### Normalized trace spans

`fromTraceSpans` projects OpenInference/OTLP spans already emitted by `@tangle-network/traces` or the ChatGPT fleet into the same record model. `fromStoryboardSpans` projects the separate `@tangle-network/agent-eval` `Span[]` shape used by `@tangle-network/run-capsule`. Both retain recorded trace/run, span and parent-span IDs on events. Each trace or run is one session node; span containment is not treated as agent delegation. The caller can supply exact retained source locations and claim/verdict/publication references. Missing parents, conflicting session IDs and untimed spans become coverage gaps.

```ts
import { fromTraceSpans } from '@drewstone/agent-record/adapters/trace-spans'

const record = fromTraceSpans(spans, { recordId: 'fleet-review', title: 'Fleet review' })
```

OTLP projection uses `trace-span.v1` IDs; the storyboard projection uses `storyboard-span.v1` IDs. Neither claims original capture completeness. Review content and source paths before public serving. They do not replace the anchored research-publication converter. The two upstream span formats remain different; this package does not convert ChatGPT OTLP spans into run-capsule's storyboard input.

The Overview, run progress, and play charts use the live React renderers from `@tangle-network/charts`. Agent-record supplies the data, state colors, labels, links, and theme tokens; the shared package owns chart geometry, interaction, and CSS. The distributed `styles.css` includes the package's live chart stylesheet for hosts that load one renderer CSS file.

`RecordWorkGraph` draws a validated `RunRecord` as one interactive entity and evidence graph. It shows the run, agents, sessions, artifacts, precise claims, verdicts, publications, and profile versions. A dashed container edge attaches each root node to its record without claiming execution parentage. Other edges use only recorded parent IDs, page SHA-256 and claim IDs, reviewer session IDs, publication citations, and profile digests; absent targets remain unlinked. Events stay in the record viewer rather than becoming thousands of graph cards. The live run Work graph and this bundle graph share the profile canvas's pan, zoom, pinch, and keyboard engine.

```tsx
import { RecordWorkGraph, type RunRecord } from '@drewstone/agent-record'
import '@drewstone/agent-record/styles.css'

export function BundleGraph({ record }: { record: RunRecord }) {
  return <RecordWorkGraph record={record} />
}
```

## Discovery application

Discovery's workspace, run pages and standalone receipts are owned by the [Tools viewer](https://github.com/drewstone/tangle-tools/tree/main/fleet/discovery_workspace_parts/viewer). Version2 retires the workspace browser bundle, receipt renderer and Discovery page exports. Existing immutable1.x releases remain historical artifacts.

The workspace wire schemas, exported models, record adapters, ingest and research-report CLI remain here. Retained record and evidence views continue to use their shared Charts and Sandbox UI owners.

## Interaction and embedding

The viewer includes a recursive agent tree, scrollable activity timeline, conversation, source inspector, and usage plots.
Tool inputs and results are paired by the original node ID and call ID, within one run.
Repeated call identities are marked ambiguous; a missing result is not treated as success.
A result returned before its call's recorded timestamp stays visible, with its timing discrepancy labeled.

Replay supports adjustable speed, recorded time, event steps, and reduced motion.
The time cursor hides future content in conversation, source details, and tooltips.
Usage plots distinguish input, output, cache read, and cache write counters.
Tool return time is the observed call/result interval, including queue and tool time; it is not model latency.
Recorded order follows the supplied event array.

```tsx
import { useState } from 'react'
import { AgentRecord, type RecordSelection, type RunRecord } from '@drewstone/agent-record'

function ControlledViewer({ records }: { records: readonly RunRecord[] }) {
  const [selection, setSelection] = useState<RecordSelection>({
    runId: records[0].runId,
    eventId: 'an-original-event-id',
    view: 'source',
  })
  return <AgentRecord records={records} selection={selection}
    onSelectionChange={setSelection} theme="dark" />
}
```

| Prop | Meaning |
| --- | --- |
| `records` | Readonly array of validated `RunRecord` objects; run IDs must be unique. |
| `selection` | Controlled run, node, event, time cursor, and tab. |
| `defaultSelection` | Initial selection when the component owns its state. |
| `onSelectionChange` | User selection callback; use it to implement URLs or persistence. |
| `theme` | `auto`, `light`, or `dark`; defaults to the system theme. |
| `className` | Additional class for host styles. |

`RecordSelection` has `runId`, optional `nodeId`, `eventId`, `at`, and `view` (`chat`, `source`, or `usage`).
Omit `at` to show the complete record.
Pass new immutable record objects when evidence changes.
Several viewers can share a page without sharing state or DOM IDs.
The example includes a second-instance toggle.

Import CSS once.
All selectors are scoped to `.agent-record`; it does not restyle the surrounding page.
Override `--ar-background`, `--ar-foreground`, `--ar-font`, and `--ar-mono`, or the semantic tokens in [styles.css](src/styles.css).
A host with a sticky header of its own sets `--ar-sticky-top` (default 8px) so the topology column and the profile detail stick below it.
Text uses one scale of three sizes: `--ar-text-s` (15px: labels, chips, axes, table headers), `--ar-text-m` (17px: body, tabs, table cells) and `--ar-text-l` (26px: titles); override them together to scale the viewer.

## Run the example

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

The example and publication checks read the original research repository at the immutable revision and digests in [sources.json](docs/evidence/sources.json). The duplicate captures are retained in the [archive](https://github.com/drewstone/agent-record/tree/archive/record-examples-20261029/examples/react/public/records). Local uploads and the report CLI continue to read supplied files.
Redactions and excerpts are labeled; the original discovery capture is incomplete.
Open a record file to inspect your own data entirely in the browser.

## Release checks

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm build:example
pnpm exec playwright install chromium
node --test tests/record-usage.browser.mjs tests/example.browser.mjs
pnpm pack
```

This repository is public. Keep evidence screenshots and recordings in private storage and describe them in the pull request; never commit them under `docs/evidence`. Never commit a tailnet address (a Tailscale `100.x` IP or a `ts.net` name). `tests/public-repo.test.mjs` refuses both.

[Consumer evidence](docs/evidence/README.md) covers the built package, browser interactions, source preservation, server rendering, and the blog integration.
The conversation renders only the rows near its viewport.

Extracted from [Drew Stone's research site](https://github.com/drewstone/drewstone.github.io) at `95e0aaf`.
Code is MIT licensed.
Example records retain their source references and publication notes; upstream papers and excerpts retain their original rights.
