# Research report browser evidence

Checked October 2, 2026, against the existing published viewer and the local React example. The screenshots contain only the five previously reviewed public records. Their 1,054 events and original source references remain unchanged; [source hashes](../sources.json).

The primary workflow is now a source-linked assessment: choose a play, read its claim and limitations, inspect the evidence, then open the exact recorded event. Authored assessments remain separate from recorded execution. The public example marks the retained claims unresolved because this rendering change does not reverify their scientific content.

| View | Published 0.1.0 | Research report |
| --- | --- | --- |
| Desktop, 1280 × 900 | [Before](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/before-desktop.png) | [After](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/after-desktop.png) |
| Phone, 390 × 844 | [Before](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/before-phone.png) | [After](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/after-phone.png) |

[Phone workspace](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/after-phone-workspace.png) · [Phone dark theme](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/after-phone-dark.png) · [Exact event source](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/source-event.png) · [Keyboard focus](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/keyboard-source.png) · [Reduced motion](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/reduced-motion.png).

[Browser check receipt](browser-checks.json) covers empty search, assessment filtering, source inspection, event cutoffs, replay/pause, reduced motion, keyboard tabs, phone fit, play selection, dark theme, and a real per-play LaTeX download. The download-event observer timed out, but the exported 3,709-byte file was found in Downloads and its contents inspected.

[Recorded replay and pause](https://github.com/drewstone/agent-record/blob/2312a793b814e403d675d7fe277362ea54a1cee6/docs/evidence/research-reports/replay-pause.mp4) preserves the actual browser screenshot sequence at its measured intervals ([timestamps](replay-timestamps.json)). It is a sampled capture, not a full-frame-rate animation recording. The viewer advances from supplied event timestamps, at a user-selected speed, and ends paused. Browser capture latency leaves gaps between frames; no intermediate activity was synthesized.

The private standalone renderer was also opened locally: its server-rendered content hydrated under the inline script hash policy, play selection updated the report, and the browser reported no errors. Private research contents and screenshots are not included here. The public development server had an older duplicate-root warning during hot reload; the standalone production output did not.

The beelink gate merged current main, used a frozen install, built the library and example, passed type checks, and passed all ten tests. The packed renderer was separately installed with React 19.3.0 and invoked through its package executable to create HTML and TeX. This consumer check found and fixed a symlink-entry bug that direct source execution did not reveal. A separate stdin-import regression protects the pure renderer exports.

LaTeX text escaping and output content were tested; no TeX engine was installed on the build host, so PDF compilation is unverified. Reduced motion was exercised through the component's explicit control; the operating-system preference was not changed. This evidence covers Chromium and the retained examples, not arbitrary trace scale or other browsers.
