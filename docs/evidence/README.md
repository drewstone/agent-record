# Release evidence: 0.1.0

Checked October 2, 2026, using the built package and actual published research records.
No generated conversations or mock execution data were used.

## Sources and preservation

The five example records were copied from Drew Stone’s blog at `95e0aaf65b6c36fc51717869d92637fd4f5c4b88`.
Their SHA-256 hashes and the checked source hashes are in [sources.json](sources.json).
All 1,054 original event objects and all source references survive conversion unchanged.
The adapter translates node identity fields and retains the original metadata.
[Import and server-rendering receipt](import.json).

The six-session August 5 campaign contains 400 published tool calls and 399 retained results.
Some published results contain labeled redactions or excerpts.
One result is missing; the viewer does not infer its outcome.
The original capture is incomplete.

## Browser usage

[24 completed browser checks](browser.json) cover real tool input/output, attribution, future-content cutoffs, search, charts, downloads, mobile navigation, and invalid imports.
Two viewers mounted under React StrictMode with independent state and unique DOM IDs.
The browser reported no exceptions.

[Uncut interaction recording](walkthrough.webm) was replayed at its original speed before release.
The recording follows the browser checks; it is intentionally fast, rather than a narrated tutorial.

| View | Before extraction | Reusable component |
| --- | --- | --- |
| Desktop | [Blog at 95e0aaf](before-desktop.png) | [React example](desktop.png) |
| Phone | [Blog at 95e0aaf](before-phone.png) | [React example](phone.png) |

[Dark theme](dark.png) · [Expanded tool](tool.png).

## First external consumer

The blog installs the packed release and embeds it as an Astro React island.
Its small wrapper owns URLs; there is no second viewer implementation.
[Browser receipt](blog.json) covers all three research pages, mathematics, tool output, source-link reload, unresolved session attribution, mobile width, and essay navigation.
[Desktop](blog-desktop.png) · [Phone](blog-phone.png).

Library type checks, example type checks, NodeNext declaration imports, server rendering, and production builds passed.
Server rendering produced no warnings; empty records also rendered.
The blog build produced 120 pages and its affected React wrapper typechecked.
Full blog typechecking encounters a preexisting syntax error in unchanged `tools/install-hooks.mjs:34`.
That unrelated file was not modified.

## Limits

Verification used React 19.3, Chromium, Node 24.21, and pnpm 10.23 on a beelink build host.
React 18.3 is within the peer dependency range but was not separately exercised.
The selected conversation is rendered without virtualization.
This evidence establishes behavior for the supplied records, not unbounded scale or universal raw-log support.
