# Agent Observatory data contract (v1)

`GET /api/state` returns a snapshot. `GET /api/events` is an SSE stream with event `snapshot` and the same JSON. Demo is explicit: `?demo=1` returns labelled sample data. Missing metrics are `null`, never invented zeroes. Times are ISO UTC; display in the browser's locale/timezone. All filters apply to counts, rows and timeline together.

```js
{
  schemaVersion: 1,
  generatedAt: '2026-11-23T08:00:00.000Z',
  source: { mode: 'live', connected: true, latestEventAt: null, staleAfterMs: 90000, warnings: [] },
  sessions: [{
    id: 'session-id', project: 'sample-app', cwd: '~/projects/sample-app',
    status: 'running', // running | waiting | idle | completed | error | unknown
    startedAt: '...', lastEventAt: '...', endedAt: null,
    model: null, contextPercent: null, rateLimits: [], costUsd: null,
    costEstimated: null, costIncomplete: null,
    tokens: { input: null, output: null, cacheRead: null, cacheWrite: null },
    agents: [{
      id: 'agent-id', parentId: null, name: 'Coordinator', type: 'main', task: null,
      status: 'running', startedAt: '...', lastEventAt: '...', endedAt: null,
      model: null, costUsd: null, costEstimated: null, costIncomplete: null,
      tokens: { input: null, output: null, cacheRead: null, cacheWrite: null },
      toolCalls: 0, errors: 0, files: [],
      modelActivity: null, // v0.2 additive field; see below
      tools: [{ id: 'tool-id', name: 'Read', status: 'success', startedAt: '...', endedAt: '...', durationMs: 24, summary: 'src/dashboard.tsx' }],
      events: [{ id: 'evt-id', type: 'tool.end', timestamp: '...', agentId: 'agent-id', title: 'Read completed', detail: 'src/dashboard.tsx', status: 'success' }]
    }],
    tasks: [{ id: '1', subject: 'Check dashboard', status: 'in_progress', owner: null, blockedBy: [] }],
    events: []
  }]
}
```

Events persisted by collector are normalized, compact, no raw tool bodies, prompts, environment or credentials. Unknown parent links stay null; never guess a parent. Per-agent token counts are exact reported totals or null; never sum a session's inclusive usage into child counts. `completed` means a lifecycle ended, not tests passed. `waiting` means an observed permission/input wait. Event inactivity alone is displayed as stale, not a failure verdict.

`costEstimated` labels a reported estimate; `costIncomplete` labels partial pricing, if provided. Explicit `costUsd: null` clears an earlier known value. The native collector sets cost to null when Claude reports substituted/unknown model pricing. Session usage is displayed as session usage, never assigned to a selected child's cost.

Since 0.2, `model.start` and `model.end` carry sessionId, agentId, requestId, timestamp and optional model. The original observed timestamp is preserved across asynchronous process writes. `agent.modelActivity` stays null until observed, then has `{requestId,startedAt,endedAt,lastEventAt,model,active,activeCount}`. Overlapping requests remain separate; lifecycle boundaries suppress orphan starts. No prompt, streamed content or thought text enters this field. Office presentation can use a newer observed model request over an older idle/error phase without changing the stored lifecycle status.

`GET /api/office-demo` returns `{mode:'demo',frames:[{id,label,snapshot}]}`. This endpoint is synthetic only and never changes the live journal. Office uses the same `/api/state` and `/api/events` for real data.

Web assets live in `plugin/web/`; shared data code in `plugin/lib/`; CLI/server in `plugin/scripts/`. `AGENT_OBSERVATORY_HOME` defaults to `~/.claude/agent-observatory`; server binds only `127.0.0.1` at `47831`. Node 22+; no package install or external runtime dependencies.
