# One type scale, the default filter, selections that show

Before: production `drew-gtr-pro:8769`, renderer 0.13.1-41ddc5a0, 2026-10-06 00:27 UTC.
After: the same live stores served by the tangle-tools branch with this renderer on `drew-gtr-pro:8779`, 2026-10-06 00:38 UTC.
Both captured from beelink1-wsl with Playwright 1.63 (`evidence.mjs`) at 1920×1080 and 390×844 (device scale 2), dark theme.
The play and run pages scale with the screen height (tangle-tools `wall-scale.js`), so 1080 px desktops show them at 1.16×.

| Pair | What changed |
| --- | --- |
| `plays-*` | Text on the 15/17/26 px scale. 155 of 413 plays hidden by default, named by reason with failures first; runs shown "of" all. |
| `play-research-math-desktop` | The header keeps the true latest run (driver failed). 5 of 6 failed runs are hidden and counted; the lineage shows what is left. |
| `play-terraform-desktop` | Sizes; no runs hidden on this play. |
| `profile-click-desktop` | After expanding f's authored profiles and clicking director-model, its detail is beside the graph. Before, it sat at y = 1198, below the 1080 px fold. |
| `run-f-child-*` | Clicking a child agent selects it; graph labels are 15 px with a whole-row hit area. The run's purpose is under its title. |
| `run-a-empty-desktop` | A root with no recorded event says what is missing instead of an empty pane: "no terminal state recorded · no usage recorded; capture missing". |
