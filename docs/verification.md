# Verification record — 2026-11-23

This record distinguishes executed checks from checks that require the user's Claude Code environment. It is not a claim of a production installation.

Version 0.2.0 final run: **63 tests passed, 0 failed, 0 skipped** on Node.js 24.22.3. `npm run check` passed for 22 JavaScript modules and the local manifest/HTML checks. `npm run preview` generated both standalone HTML previews successfully, including 14 labelled office replay steps.

The office adds tests for model stream object/result preservation, error/cancellation cleanup, asynchronous model event ordering, overlap, honest observed/inferred phase mapping, stale/disconnected animation flags, stable actor identity, priority/overflow, module MIME/asset routes and sample/live separation. The original office SVG artwork was rendered with Sharp and visually inspected. This asset review is not a browser layout or interaction test.

## Executed in the build environment

- Node syntax and static consistency checks across JavaScript modules, manifests, hook paths and labelled HTML controls.
- Reducer tests: lifecycle ordering, duplicate events/tool IDs, session scoping, parent metadata, stale/unknown states, recovery after tool errors, cancelled tools, task patches, null metrics and late events.
- Ingest tests: metadata-only persistence, omission of prompts/shell arguments/tool results, missing teammate IDs, explicit null cost propagation, concurrent JSONL appends and malformed records.
- Transcript tests: message-ID usage deduplication, incremental updates, project-directory path boundary, per-agent scoping and no raw conversation content in the usage cache.
- Collector process → actual local event journal → HTTP snapshot → SSE integration. The server binds loopback; tests reject foreign Host/Origin, write methods and unknown file paths.
- Native pane contract tests with a mock of documented Claude Code APIs: command registration, argv launcher, session/all scope, selection and unknown metrics, headless behavior, polling cleanup, disconnect retention, `/clear`, throttled usage and agent metadata pass-through.
- A focused additional check confirmed recovery of an abandoned lock and a terminal usage read from a 9 MiB transcript, beyond the nonterminal 8 MiB cap.

Run the complete reproducible suite with `npm run check` and `npm test`. These tests create temporary directories and remove their own fixtures.

## Not verified here

1. **Real Claude Code load and native render.** No Claude Code executable is installed in this environment. API usage was checked against official documentation/types and the mock contract; `claude plugin validate ./plugin`, actual command registration and pane placement still need the user's installed runtime.
2. **Rendered browser layout and interaction flow.** Local Chromium could not launch because the execution environment denied Unix socket creation. A fallback cloud browser could not connect to this environment's loopback server; no screenshot, viewport pass or end-to-end browser interaction is claimed.
3. **Windows/macOS runtime behavior.** File paths and Node APIs avoid shell-specific launch commands, but only the Linux build/test environment was exercised.

## First-run acceptance checklist on the target machine

- Run the labelled demo and inspect overview, timeline, filters, details, light/dark mode and narrow viewport.
- Open `/office?demo=1`, play/pause all 14 sample steps, select agents and check the office on wide/narrow screens. In live mode use `/agents-office`, compare a real model/tool interval with the ordinary dashboard, and verify reconnect/paused-screen behavior.
- Stop demo, load the plugin, open `/agents-board`, issue a real Read tool call and confirm it appears.
- Launch a real subagent and confirm its lifecycle and available parent metadata.
- Open `/agents-web`, compare its selected session/tool with the native pane, then close the pane and confirm agents continue normally.
- Trigger one ordinary permission request and resolve it; confirm the wait clears after subsequent activity.
- Check reported usage only when the runtime provides it; unknown fields must remain `—`.

Sample data in the standalone HTML and `--demo` mode is synthetic and visibly labelled. It is not evidence of the user's current agents or production measurements.
