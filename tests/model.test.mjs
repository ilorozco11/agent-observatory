import test from 'node:test';
import assert from 'node:assert/strict';
import { reduceEvents } from '../plugin/lib/model.mjs';
import { createDemoEvents, createDemoSnapshot } from '../plugin/lib/demo.mjs';

const NOW = Date.parse('2026-11-23T08:00:00Z');
const event = (id, type, ms, extra = {}) => ({ id, type, sessionId: 's1', timestamp: new Date(NOW + ms).toISOString(), ...extra });
const getAgent = (snapshot, id = 'main', sessionId = 's1') => snapshot.sessions.find(session => session.id === sessionId)?.agents.find(agent => agent.id === id);

test('model phase is absent until observed, counts overlapping requests, and does not change lifecycle status', () => {
  const base = [event('session', 'session.start', 0), event('turn', 'turn.start', 1)];
  assert.equal(getAgent(reduceEvents(base)).modelActivity, null);
  const requests = [event(null, 'model.start', 10, { requestId: 'r1', model: 'reported' }), event(null, 'model.start', 10, { requestId: 'r2' })];
  const running = getAgent(reduceEvents([...base, ...requests], { now: NOW + 100 }));
  assert.equal(running.status, 'running');
  assert.equal(running.modelActivity.active, true);
  assert.equal(running.modelActivity.activeCount, 2);
  const one = getAgent(reduceEvents([...base, ...requests, event('end1', 'model.end', 20, { requestId: 'r1' })]));
  assert.equal(one.modelActivity.activeCount, 1);
  assert.equal(one.modelActivity.requestId, 'r2');
});

test('end-before-start arrival and repeated model starts cannot resurrect a completed request', () => {
  const result = reduceEvents([
    event('end', 'model.end', 20, { agentId: 'child', requestId: 'r1' }),
    event('start', 'model.start', 10, { agentId: 'child', requestId: 'r1' }),
    event('again', 'model.start', 30, { agentId: 'child', requestId: 'r1' }),
  ]);
  const activity = getAgent(result, 'child').modelActivity;
  assert.equal(activity.active, false);
  assert.equal(activity.activeCount, 0);
  assert.equal(activity.startedAt, new Date(NOW + 10).toISOString());
  assert.equal(activity.endedAt, new Date(NOW + 20).toISOString());
});

test('turn and agent termination suppress orphan active requests; late phases do not reopen agents', () => {
  for (const terminal of ['turn.end', 'agent.end']) {
    const agent = getAgent(reduceEvents([
      event('start', 'agent.start', 0),
      event('model', 'model.start', 10, { requestId: 'r1' }),
      event('close', terminal, 20),
    ]));
    assert.equal(agent.modelActivity.active, false);
    assert.equal(agent.status, terminal === 'turn.end' ? 'idle' : 'completed');
  }
  const ended = getAgent(reduceEvents([
    event('start', 'agent.start', 0), event('close', 'agent.end', 20),
    event('late', 'model.start', 30, { requestId: 'r2' }),
  ]));
  assert.equal(ended.status, 'completed');
  assert.equal(ended.modelActivity.active, false);
  const resumed = getAgent(reduceEvents([
    event('start', 'agent.start', 0), event('model', 'model.start', 10, { requestId: 'r1' }),
    event('close', 'turn.end', 20), event('resume', 'turn.start', 30),
    event('new', 'model.start', 40, { requestId: 'r2' }),
  ]));
  assert.equal(resumed.modelActivity.activeCount, 1);
  assert.equal(resumed.modelActivity.requestId, 'r2');
});

test('out-of-order arrival merges late identity and preserves only explicit parent links', () => {
  const input = [
    event('3', 'tool.end', 100, { agentId: 'child', toolId: 't1', toolName: 'Read' }),
    event('2', 'agent.start', 20, { agentId: 'child', parentId: 'main', name: 'Reviewer', agentType: 'review' }),
    event('4', 'agent.start', 30, { agentId: 'orphan' }),
    event('1', 'session.start', 0, { project: 'example' }),
  ];
  const result = reduceEvents(input, { now: NOW + 200 });
  const child = getAgent(result, 'child');
  assert.equal(child.name, 'Reviewer');
  assert.equal(child.parentId, 'main');
  assert.equal(child.startedAt, new Date(NOW + 20).toISOString());
  assert.equal(getAgent(result, 'orphan').parentId, null);
  assert.equal(child.toolCalls, 1);
  assert.equal(child.tools[0].durationMs, null, 'no duration is fabricated when start was not seen');
});

test('duplicate event IDs and repeated tool starts do not inflate calls or resurrect completed tools', () => {
  const start = event('start', 'tool.start', 20, { toolId: 't1', toolName: 'Read' });
  const input = [event('session', 'session.start', 0), start, { ...start },
    event('end', 'tool.end', 100, { toolId: 't1', toolName: 'Read' }),
    event('duplicate-start-new-id', 'tool.start', 150, { toolId: 't1', toolName: 'Read' })];
  const main = getAgent(reduceEvents(input, { now: NOW + 200 }));
  assert.equal(main.toolCalls, 1);
  assert.equal(main.tools.length, 1);
  assert.equal(main.tools[0].status, 'success');
  assert.equal(main.tools[0].durationMs, 80);
  assert.equal(main.events.filter(item => item.id === 'start').length, 1);
});

test('missing usage stays null and usage snapshots replace rather than add', () => {
  const input = [event('s', 'session.start', 0), event('a', 'agent.start', 10, { agentId: 'a1' }),
    event('u1', 'usage', 20, { agentId: 'a1', scope: 'agent', tokens: { input: 100, output: 20 } }),
    event('u2', 'usage', 30, { agentId: 'a1', scope: 'agent', tokens: { input: 150, output: 35 } }),
    event('su', 'usage', 40, { scope: 'session', tokens: { input: 900, output: 100 }, contextPercent: 40, costUsd: 0.2 })];
  const result = reduceEvents(input, { now: NOW + 50 });
  assert.equal(getAgent(result, 'a1').tokens.input, 150);
  assert.equal(getAgent(result, 'a1').tokens.output, 35);
  assert.equal(getAgent(result, 'a1').tokens.cacheRead, null);
  assert.equal(getAgent(result).tokens.input, null);
  assert.equal(getAgent(result).costUsd, null);
  assert.equal(result.sessions[0].tokens.input, 900);
  assert.equal(result.sessions[0].contextPercent, 40);
});

test('cost is labelled estimated and incomplete independently for session and agent', () => {
  const result = reduceEvents([
    event('s', 'session.start', 0),
    event('su', 'usage', 10, { scope: 'session', costUsd: 0.42, costIncomplete: true }),
    event('au', 'usage', 20, { scope: 'agent', agentId: 'a1', costUsd: 0.15 }),
    event('nu', 'usage', 30, { scope: 'agent', agentId: 'a2', tokens: { output: 25 } }),
  ], { now: NOW + 40 });
  assert.equal(result.sessions[0].costEstimated, true);
  assert.equal(result.sessions[0].costIncomplete, true);
  assert.equal(getAgent(result, 'a1').costEstimated, true);
  assert.equal(getAgent(result, 'a1').costIncomplete, false);
  assert.equal(getAgent(result, 'a2').costEstimated, null);
  assert.equal(getAgent(result, 'a2').costIncomplete, null);
});

test('usage and late tool events do not reopen ended agents', () => {
  const result = reduceEvents([
    event('a', 'agent.start', 0, { agentId: 'a1' }),
    event('end', 'agent.end', 100, { agentId: 'a1' }),
    event('usage', 'usage', 120, { agentId: 'a1', scope: 'agent', tokens: { output: 48 } }),
    event('tool-late', 'tool.end', 140, { agentId: 'a1', toolId: 't1', toolName: 'Bash' }),
  ], { now: NOW + 200 });
  assert.equal(getAgent(result, 'a1').status, 'completed');
  assert.equal(getAgent(result, 'a1').endedAt, new Date(NOW + 100).toISOString());
  assert.equal(getAgent(result, 'a1').tokens.output, 48);
});

test('metadata enriches an ended agent without changing work timestamps or lifecycle', () => {
  const result = reduceEvents([
    event('a', 'agent.start', 0, { agentId: 'a1' }),
    event('read', 'tool.end', 50, { agentId: 'a1', toolId: 't1', toolName: 'Read' }),
    event('end', 'agent.end', 100, { agentId: 'a1' }),
    event('details', 'agent.metadata', 200, { agentId: 'a1', parentId: 'main', name: 'Logic reviewer', agentType: 'review', model: 'example-model', task: 'Inspect retry logic' }),
  ], { now: NOW + 300 });
  const agent = getAgent(result, 'a1');
  assert.equal(agent.name, 'Logic reviewer');
  assert.equal(agent.parentId, 'main');
  assert.equal(agent.type, 'review');
  assert.equal(agent.model, 'example-model');
  assert.equal(agent.task, 'Inspect retry logic');
  assert.equal(agent.status, 'completed');
  assert.equal(agent.startedAt, new Date(NOW).toISOString());
  assert.equal(agent.endedAt, new Date(NOW + 100).toISOString());
  assert.equal(agent.lastEventAt, new Date(NOW + 100).toISOString());
  assert.equal(result.sessions[0].lastEventAt, agent.lastEventAt);
  assert.equal(agent.toolCalls, 1);
});

test('a new successful tool recovers current error state without erasing failed-call evidence', () => {
  const result = reduceEvents([
    event('a', 'agent.start', 0, { agentId: 'a1' }),
    event('bad', 'tool.error', 20, { agentId: 'a1', toolId: 't1', toolName: 'Bash' }),
    event('next', 'tool.start', 30, { agentId: 'a1', toolId: 't2', toolName: 'Read' }),
    event('ok', 'tool.end', 40, { agentId: 'a1', toolId: 't2', toolName: 'Read' }),
  ], { now: NOW + 50 });
  const agent = getAgent(result, 'a1');
  assert.equal(agent.status, 'running');
  assert.equal(agent.errors, 1);
  assert.equal(agent.toolCalls, 2);
});

test('an interrupted tool is cancelled, does not count as a failure, and leaves its agent idle', () => {
  const result = reduceEvents([
    event('a', 'agent.start', 0, { agentId: 'a1' }),
    event('start', 'tool.start', 20, { agentId: 'a1', toolId: 't1', toolName: 'Bash' }),
    event('cancel', 'tool.error', 50, { agentId: 'a1', toolId: 't1', toolName: 'Bash', status: 'cancelled' }),
  ], { now: NOW + 60 });
  const agent = getAgent(result, 'a1');
  assert.equal(agent.status, 'idle');
  assert.equal(agent.errors, 0);
  assert.equal(agent.tools[0].status, 'cancelled');
  assert.equal(agent.tools[0].durationMs, 30);
  assert.match(agent.events[0].title, /interrupted/);
});

test('input wait clears only on activity of that agent; another child remains independent', () => {
  const input = [event('s', 'session.start', 0),
    event('a', 'agent.start', 5, { agentId: 'a1' }), event('b', 'agent.start', 6, { agentId: 'b1' }),
    event('w', 'waiting', 10, { agentId: 'a1' }),
    event('bt', 'tool.start', 20, { agentId: 'b1', toolId: 'tb', toolName: 'Read' })];
  const before = reduceEvents(input, { now: NOW + 30 });
  assert.equal(getAgent(before, 'a1').status, 'waiting');
  assert.equal(before.sessions[0].status, 'waiting');
  input.push(event('at', 'tool.start', 25, { agentId: 'a1', toolId: 'ta', toolName: 'Read' }));
  assert.equal(getAgent(reduceEvents(input, { now: NOW + 30 }), 'a1').status, 'running');
});

test('turn end is idle, session end is completed, unfinished children are unknown', () => {
  const input = [event('s', 'session.start', 0), event('turn', 'turn.start', 10), event('end-turn', 'turn.end', 100)];
  assert.equal(getAgent(reduceEvents(input, { now: NOW + 200 })).status, 'idle');
  input.push(event('child', 'agent.start', 150, { agentId: 'child' }));
  input.push(event('end-session', 'session.end', 200));
  const result = reduceEvents(input, { now: NOW + 300 });
  assert.equal(result.sessions[0].status, 'completed');
  assert.equal(getAgent(result, 'child').status, 'unknown');
  assert.ok(getAgent(result, 'child').endedAt);
});

test('inactivity alone never changes running to success or error', () => {
  const result = reduceEvents([event('a', 'agent.start', 0, { agentId: 'a1' })], { now: NOW + 86_400_000 });
  assert.equal(getAgent(result, 'a1').status, 'running');
  assert.equal(getAgent(result, 'a1').endedAt, null);
  assert.equal(result.source.latestEventAt, new Date(NOW).toISOString());
});

test('same agent, tool and event identifiers in separate sessions never collide', () => {
  const result = reduceEvents([
    event('s', 'session.start', 0), event('t', 'tool.error', 10, { toolId: 't1', toolName: 'Read' }),
    event('s', 'session.start', 20, { sessionId: 's2' }),
    event('t', 'tool.end', 30, { sessionId: 's2', toolId: 't1', toolName: 'Read' }),
  ], { now: NOW + 50 });
  assert.equal(result.sessions.length, 2);
  assert.equal(getAgent(result, 'main', 's1').errors, 1);
  assert.equal(getAgent(result, 'main', 's2').errors, 0);
});

test('history caps retain total unique call counts and latest events', () => {
  const input = [event('s', 'session.start', 0)];
  for (let i = 0; i < 10; i++) input.push(event(`t${i}`, 'tool.end', i + 1, { toolId: `call${i}`, toolName: 'Read', file: 'src/app.ts' }));
  const result = reduceEvents(input, { now: NOW + 20, maxEvents: 3, maxTools: 2 });
  const main = getAgent(result);
  assert.equal(main.toolCalls, 10);
  assert.equal(main.tools.length, 2);
  assert.equal(main.events.length, 3);
  assert.equal(main.events[0].id, 't9');
  assert.deepEqual(main.files, ['src/app.ts']);
  assert.equal(result.sessions[0].events.length, 3);
});

test('malformed events and non-finite metrics do not pollute a snapshot', () => {
  const result = reduceEvents([null, {}, event('bad-time', 'session.start', 0, { timestamp: 'invalid' }),
    event('unsupported', 'made.up', 0), event('s', 'session.start', 0),
    event('u', 'usage', 10, { scope: 'session', tokens: { input: -2, output: Infinity }, costUsd: NaN, contextPercent: -1 })], { now: NOW });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].tokens.input, null);
  assert.equal(result.sessions[0].tokens.output, null);
  assert.equal(result.sessions[0].contextPercent, null);
  assert.match(result.source.warnings[0], /4 invalid/);
});

test('task patches preserve prior fields, update dependencies, and remove deleted tasks', () => {
  const result = reduceEvents([
    event('t1', 'task.update', 0, { taskRecord: { id: '1', subject: 'Check source', status: 'pending', owner: 'a1', blockedBy: ['0'] } }),
    event('t2', 'task.update', 10, { taskRecord: { id: '1', status: 'completed', blockedBy: [] } }),
    event('t3', 'task.update', 20, { taskRecord: { id: '2', subject: 'Removed', status: 'deleted' } }),
  ], { now: NOW + 30 });
  assert.deepEqual(result.sessions[0].tasks, [{ id: '1', subject: 'Check source', status: 'completed', owner: 'a1', blockedBy: [] }]);
});

test('incremental task dependency and owner patches deduplicate while preserving subject', () => {
  const result = reduceEvents([
    event('t1', 'task.update', 0, { taskRecord: { id: '1', subject: 'Review task', blockedBy: ['a'], owner: null } }),
    event('t2', 'task.update', 10, { taskRecord: { id: '1', addBlockedBy: ['a', 'b', 'b'], owner: 'reviewer' } }),
  ], { now: NOW + 20 });
  assert.deepEqual(result.sessions[0].tasks, [{ id: '1', subject: 'Review task', status: 'pending', owner: 'reviewer', blockedBy: ['a', 'b'] }]);
});

test('empty input is a truthful empty live snapshot', () => {
  const result = reduceEvents([], { now: NOW });
  assert.deepEqual(result.sessions, []);
  assert.equal(result.source.mode, 'live');
  assert.equal(result.source.latestEventAt, null);
  assert.equal(result.generatedAt, new Date(NOW).toISOString());
});

test('demo is explicit, generated through the same reducer, and has truthful timeline metrics', () => {
  const result = createDemoSnapshot(NOW);
  assert.equal(result.source.mode, 'demo');
  assert.match(result.source.warnings[0], /minh họa/);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions.flatMap(session => session.agents).length, 8);
  const expected = reduceEvents(createDemoEvents(NOW), { now: NOW, mode: 'demo' });
  assert.deepEqual(result.sessions, expected.sessions);
  const agents = result.sessions.flatMap(session => session.agents);
  assert.ok(agents.some(agent => agent.status === 'waiting'));
  assert.ok(agents.some(agent => agent.status === 'running'));
  assert.ok(agents.some(agent => agent.status === 'completed'));
  for (const agent of agents) {
    for (const tool of agent.tools) assert.ok(tool.durationMs === null || tool.durationMs >= 0);
    assert.ok(agent.tokens.input === null || agent.tokens.input >= 0);
  }
});
