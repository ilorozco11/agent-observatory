# Browser dashboard

The frontend is dependency-free HTML, CSS and JavaScript in `plugin/web/`. It makes read-only requests to `/api/state` and `/api/events` (SSE event `snapshot`). `?demo=1` is passed to both requests; no sample data is substituted for a failed live connection.

## Decisions

- The primary work surface is a parent/child agent list; the default selected agent is one waiting for the user, then an active child. A right-hand inspector provides tool calls, file paths, recent events, tokens and reported costs.
- Project, session, status and text filters affect agent counts, tool-call totals, timeline rows and the activity stream together. Session count means sessions represented by the matching agents.
- The timeline maps actual timestamps to one common scale. Thin lines indicate agent lifetimes; segments indicate observed tools. Missing times are omitted. A minimum visible width marks very short tool calls.
- Agent completion is explicitly described as lifecycle completion, not evidence that tests passed. Missing token/cost/context fields remain unavailable. Estimated or incomplete costs are labelled.
- The inspector separates the containing session's reported context, estimated cost and rate-limit windows from the selected agent's token/cost metrics. Session totals are never attributed to a child agent; unknown session costs remain unavailable.
- Pausing updates affects this screen only. Incoming snapshots are buffered and the newest snapshot appears on resume; agents continue working. The header and notice explicitly say this.
- Grayscale status text and shapes, not color alone. Light/dark themes, visible focus, labelled controls, `/` to search, arrow-key inspector tabs, reduced-motion handling. Under 890 px, the inspector stacks below the work surface.

## Standalone preview

An exporter may inline the stylesheet and JavaScript and assign `window.__AGENT_OBSERVATORY_SNAPSHOT__` before the script. This suppresses network access and forces the visible sample-data banner. The embedded snapshot should come from `createDemoSnapshot()`.

`window.AgentObservatory.setSnapshot(snapshot)` and `.getState()` support deterministic browser tests. They do not mutate persisted data or agent execution.

## Verification by UI implementation agent

- Passed `node --check plugin/web/app.js`.
- Passed static HTML checks for duplicate IDs, label targets and names for all search/filter inputs.
- Inspected: no dynamic `innerHTML`, `outerHTML`, `insertAdjacentHTML` or eval; source values are inserted using textContent and DOM attributes.
- Visual browser verification was not completed. Local Chromium could not launch because the execution sandbox denied its Unix socket creation (`process_singleton_posix.cc`, EPERM). The fallback cloud browser could not reach the local server at `127.0.0.1` (`ERR_CONNECTION_REFUSED`); the subsequent error page was blocked by URL policy. No rendered UI, responsive-layout, screenshot or browser-interaction success is claimed.

The intended browser check sequence is: load labelled demo; select a waiting agent; filter one project; search a task; inspect tools/files; clear filters; switch timeline/activity views; pause and feed a new snapshot; resume; switch theme; check keyboard focus; inspect 1440, 1024 and 390 px widths; then repeat the empty/disconnected states against the real server.
