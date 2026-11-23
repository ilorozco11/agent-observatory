// Tests of our observer and presentation against a mocked official host contract.
// This does not replace loading the module in an installed Claude Code runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from '../plugin/hooks/register.mjs';
import { agentRows, numberText, snapshotOf } from '../plugin/hooks/view.mjs';
import { normalizeHook, normalizeUsage } from '../plugin/lib/ingest.mjs';
import { reduceEvents } from '../plugin/lib/model.mjs';

const NOW = Date.parse('2026-11-23T08:00:00.000Z');
const settle = () => new Promise(resolve => setImmediate(resolve));
const agent = (id, patch = {}) => ({
  id, parentId: null, name: id, type: 'main', status: 'running',
  startedAt: new Date(NOW - 10000).toISOString(), lastEventAt: new Date(NOW - 1000).toISOString(),
  model: null, costUsd: null, tokens: { input: null, output: null, cacheRead: null, cacheWrite: null },
  toolCalls: 2, errors: 0, tools: [], events: [], files: [], ...patch,
});
const session = (id, name, patch = {}) => ({
  id, project: name, agents: [agent(`${id}-main`)], events: [], tasks: [],
  contextPercent: null, costUsd: null, rateLimits: [], ...patch,
});
const snapshot = () => ({
  schemaVersion: 1, generatedAt: new Date(NOW).toISOString(),
  source: { mode: 'live', connected: true, latestEventAt: new Date(NOW - 1000).toISOString(), warnings: [] },
  sessions: [session('s1', 'PROJECT ONE'), session('s2', 'PROJECT TWO')],
});

function makeHost() {
  const handlers = [];
  const calls = { register: [], run: [], fetch: [], open: [], close: [], redraw: [], log: [], after: [], every: [] };
  const config = { now: NOW, sessionId: 's1', root: '/plugin with spaces', port: undefined, data: snapshot(), fetchError: null, runError: null, placement: { isPlaced: true } };
  const props = {
    Box: ['key', 'flexDirection', 'marginBottom', 'paddingLeft', 'marginTop', 'columnGap', 'padding', 'rowGap', 'borderStyle', 'children'],
    Text: ['bold', 'children', 'dimColor'],
    Button: ['key', 'plain', 'label', 'onPress', 'hotkey', 'role', 'children'],
    Link: ['href', 'label', 'children'],
  };
  const ui = Object.fromEntries(Object.entries(props).map(([type, allowed]) => [type, value => {
    for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `${type} rejects undeclared prop ${key}`);
    return { type, props: value };
  }]));
  const timer = (collection, ms, fn) => {
    const handle = { ms, fn, cancelled: false, fired: false, cancel() { this.cancelled = true; } };
    collection.push(handle);
    return handle;
  };
  const $ = {
    command: { register: async value => { calls.register.push(value); } },
    session: { id: async () => config.sessionId },
    plugin: { root: async () => config.root },
    env: { get: async key => { assert.equal(key, 'AGENT_OBSERVATORY_PORT'); return config.port; } },
    process: { run: async (argv, init) => {
      calls.run.push({ argv, init });
      if (config.runError) throw config.runError;
      return { exitCode: 0, stdout: 'http://127.0.0.1:47831\n', stderr: '' };
    } },
    http: { fetch: async (url, init) => {
      calls.fetch.push({ url, init });
      if (config.fetchError) throw config.fetchError;
      return { status: 200, ok: true, headers: {}, text: JSON.stringify(config.data) };
    } },
    clock: {
      now: async () => config.now,
      after: (ms, fn) => timer(calls.after, ms, fn),
      every: (ms, fn) => timer(calls.every, ms, fn),
    },
    ui: {
      resolve: async () => ui,
      open: async value => { calls.open.push(value); return config.placement; },
      close: async value => { calls.close.push(value); },
      invalidate: value => { calls.redraw.push(value); },
      log: value => { calls.log.push(value); },
    },
  };
  register((name, matcher, fn) => {
    if (typeof matcher === 'function') { fn = matcher; matcher = {}; }
    handlers.push({ name, matcher, fn });
  });
  async function invoke(name, event = {}, result = { preserved: true }) {
    const handler = handlers.find(item => item.name === name && Object.entries(item.matcher).every(([key, value]) => event[key] === value));
    if (!handler) return result;
    return handler.fn($, event, e => { assert.equal(e, event, `${name} must pass the original event unchanged`); return Promise.resolve(result); });
  }
  const render = () => invoke('ui.render', { component: 'Pane', requestId: 'agent-observatory', surface: 'terminal' });
  const runCommand = (command, args = '') => invoke('command.run', { command, args });
  const runTimer = async handle => { assert.equal(handle.cancelled, false); handle.fired = true; handle.fn(); await settle(); };
  const pendingTimers = () => calls.after.filter(handle => !handle.cancelled && !handle.fired);
  const stream = (event, chunks, result, error = null) => {
    const handler = handlers.find(item => item.name === 'turn.step');
    assert.ok(handler, 'turn.step observer registered');
    return handler.fn($, event, async function* (received) {
      assert.equal(received, event, 'model request passed unchanged');
      for (const chunk of chunks) yield chunk;
      if (error) throw error;
      return result;
    });
  };
  return { calls, config, invoke, render, runCommand, runTimer, pendingTimers, stream };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children : [children]).flatMap(nodes)];
}
function textOf(tree) {
  return nodes(tree).flatMap(node => [typeof node.props.children === 'string' ? node.props.children : '', node.props.label ?? '']).join('\n');
}
function button(tree, key) {
  const value = nodes(tree).find(node => node.type === 'Button' && node.props.key === key);
  assert.ok(value, `button ${key} exists`);
  return value.props.onPress;
}
async function opened() {
  const host = makeHost();
  await host.invoke('session.start');
  await host.runCommand('agents-board');
  return host;
}

test('session.start only registers immediate commands and preserves the next result', async () => {
  const host = makeHost();
  const result = { original: true };
  assert.equal(await host.invoke('session.start', {}, result), result);
  assert.deepEqual(host.calls.register.map(item => [item.name, item.immediate]), [['agents-board', true], ['agents-web', true], ['agents-office', true]]);
  assert.equal(host.calls.run.length + host.calls.fetch.length + host.calls.after.length + host.calls.every.length, 0);
});

test('explicit board command starts the local server with argv, scopes data, and supports details', async () => {
  const host = await opened();
  assert.deepEqual(host.calls.run[0].argv, ['node', '/plugin with spaces/scripts/start.mjs']);
  assert.deepEqual(host.calls.fetch[0], { url: 'http://127.0.0.1:47831/api/state', init: { method: 'GET' } });
  let tree = await host.render();
  assert.match(textOf(tree), /PROJECT ONE/);
  assert.doesNotMatch(textOf(tree), /PROJECT TWO/);
  await button(tree, 'select-s1:s1-main')();
  tree = await host.render();
  assert.match(textOf(tree), /Tokens in \/ out: — \/ —/);
  assert.match(textOf(tree), /Chi phí ước tính: —/);
  assert.match(textOf(tree), /Tool calls: 2/);
  await button(tree, 'scope')();
  assert.match(textOf(await host.render()), /PROJECT TWO/);
  assert.equal(host.calls.every[0].ms, 2000);
});

test('the web command returns a URL without opening a browser or pane', async () => {
  const host = makeHost();
  host.config.port = '48123';
  await host.invoke('session.start');
  const result = await host.runCommand('agents-web');
  assert.match(result.text, /http:\/\/127\.0\.0\.1:48123/);
  assert.equal(host.calls.run.length, 1);
  assert.equal(host.calls.open.length + host.calls.fetch.length + host.calls.every.length, 0);
});

test('the office command starts the server and returns its separate window URL', async () => {
  const host = makeHost();
  await host.invoke('session.start');
  const result = await host.runCommand('agents-office');
  assert.match(result.text, /http:\/\/127\.0\.0\.1:47831\/office/);
  assert.equal(host.calls.run.length, 1);
  assert.equal(host.calls.open.length + host.calls.fetch.length + host.calls.every.length, 0);
});

test('model request observation preserves stream objects and final result without recording content', async () => {
  const host = makeHost();
  await host.invoke('session.start');
  const request = Object.freeze({ agentId: 'worker', model: 'reported-model', turnId: 't1', messages: ['PRIVATE PROMPT'] });
  const chunks = [Object.freeze({ type: 'thinking', text: 'PRIVATE THOUGHT' }), Object.freeze({ type: 'text', text: 'PRIVATE RESPONSE' })];
  const result = { text: 'PRIVATE FINAL', usage: { input_tokens: 1 } };
  const stream = host.stream(request, chunks, result);
  assert.equal((await stream.next()).value, chunks[0]);
  assert.equal(host.calls.run.length, 1);
  const start = JSON.parse(host.calls.run[0].init.stdin);
  assert.equal(start.type, 'model.start');
  assert.equal(start.agentId, 'worker');
  assert.equal(start.timestamp, new Date(NOW).toISOString());
  assert.equal((await stream.next()).value, chunks[1]);
  host.config.now += 2000;
  const done = await stream.next();
  assert.equal(done.done, true);
  assert.equal(done.value, result);
  const end = JSON.parse(host.calls.run[1].init.stdin);
  assert.equal(end.type, 'model.end');
  assert.equal(end.requestId, start.requestId);
  assert.equal(end.timestamp, new Date(NOW + 2000).toISOString());
  assert.doesNotMatch(JSON.stringify(host.calls.run), /PRIVATE|messages|thinking|input_tokens/);
  const second = host.stream({ model: 'reported-model' }, [], result);
  assert.equal((await second.next()).value, result);
  const start2 = JSON.parse(host.calls.run[2].init.stdin);
  assert.equal(start2.agentId, 'main');
  assert.notEqual(start2.requestId, start.requestId);
});

test('model observer records its end on errors and cancellation while collection fails open', async () => {
  const host = makeHost();
  await host.invoke('session.start');
  host.config.runError = new Error('collector unavailable');
  const error = new Error('original model error');
  const failed = host.stream({}, [], undefined, error);
  await assert.rejects(failed.next(), value => value === error);
  await settle();
  assert.deepEqual(host.calls.run.map(call => JSON.parse(call.init.stdin).type), ['model.start', 'model.end']);
  const cancelled = host.stream({}, [{ text: 'not collected' }], { final: true });
  await cancelled.next();
  assert.deepEqual(await cancelled.return('consumer cancelled'), { value: 'consumer cancelled', done: true });
  await settle();
  assert.equal(JSON.parse(host.calls.run.at(-1).init.stdin).type, 'model.end');
  assert.equal(host.calls.run.length, 4);
});

test('headless placement returns the web URL without a persistent poller', async () => {
  const host = makeHost();
  host.config.placement = { isPlaced: false, reason: 'no-surface' };
  await host.invoke('session.start');
  const result = await host.runCommand('agents-board');
  assert.match(result.text, /Chưa có surface/);
  assert.equal(host.calls.every.length, 0);
});

test('launcher failure is preserved without fetching a demo or occupied port', async () => {
  const host = makeHost();
  host.config.runError = new Error('The server on this port is in demo mode.');
  await host.invoke('session.start');
  const result = await host.runCommand('agents-board');
  assert.match(result.text, /Chưa khởi động được dashboard:.*demo mode/);
  assert.equal(host.calls.fetch.length + host.calls.open.length + host.calls.every.length, 0);
  host.config.runError = null;
  host.config.port = '80';
  assert.match((await host.runCommand('agents-web')).text, /127\.0\.0\.1:47831/);
});

test('unrelated pane draws pass through, disconnect preserves last successful snapshot, close stops polling', async () => {
  const host = await opened();
  const untouched = { fromAnotherPane: true };
  assert.equal(await host.invoke('ui.render', { component: 'Pane', requestId: 'other-pane', surface: 'terminal' }, untouched), untouched);
  host.config.fetchError = new Error('connection refused');
  host.config.now += 2000;
  await button(await host.render(), 'refresh')();
  const text = textOf(await host.render());
  assert.match(text, /MẤT KẾT NỐI/);
  assert.match(text, /giữ lại bản đọc thành công/);
  assert.match(text, /PROJECT ONE/);
  const closeResult = { value: undefined };
  assert.equal(await host.invoke('ui.close', { id: 'agent-observatory' }, closeResult), closeResult);
  assert.equal(host.calls.every[0].cancelled, true);
});

test('session.end resets the cached session for /clear without requiring session.start', async () => {
  const host = await opened();
  await host.invoke('session.end', { reason: 'clear', sessionId: 's1' });
  assert.equal(host.calls.every[0].cancelled, true);
  host.config.sessionId = 's2';
  await host.runCommand('agents-board');
  const text = textOf(await host.render());
  assert.match(text, /PROJECT TWO/);
  assert.doesNotMatch(text, /PROJECT ONE/);
});

test('session.measure preserves the exact result and records only verified metrics, coalesced to 5s', async () => {
  const host = makeHost();
  await host.invoke('session.start');
  const event = { context: { percent: 31.5, tokens: 1234, window: 200000 }, cost: { usd: 0.123 }, rateLimits: [{ kind: 'five_hour', percentUsed: 21, resetsAt: '2026-11-23T10:00:00Z' }], changed: ['context', 'cost'] };
  const result = { changed: event.changed };
  assert.equal(await host.invoke('session.measure', event, result), result);
  await settle();
  assert.equal(host.calls.run.length, 0, 'collector runs after the observing hook returns');
  assert.equal(host.pendingTimers()[0].ms, 0);
  await host.runTimer(host.pendingTimers()[0]);
  assert.deepEqual(host.calls.run[0].argv, ['node', '/plugin with spaces/scripts/collect.mjs', '--normalized']);
  const usage = JSON.parse(host.calls.run[0].init.stdin);
  assert.equal(usage.sessionId, 's1');
  assert.equal(usage.type, 'usage');
  assert.equal(usage.contextPercent, 31.5);
  assert.equal(usage.costUsd, 0.123);
  assert.equal(usage.costEstimated, true);
  assert.equal(usage.rateLimits[0].percentUsed, 21);
  assert.ok(!('tokens' in usage), 'context occupancy is not lifetime usage');
  host.config.now += 1000;
  await host.invoke('session.measure', { ...event, context: { percent: 40 } });
  await settle();
  assert.equal(host.pendingTimers()[0].ms, 4000);
  await host.invoke('session.measure', { ...event, context: { percent: 45 } });
  await settle();
  assert.equal(host.pendingTimers().length, 1);
  host.config.now += 4000;
  await host.runTimer(host.pendingTimers()[0]);
  assert.equal(host.calls.run.length, 2);
  assert.equal(JSON.parse(host.calls.run[1].init.stdin).contextPercent, 45);
});

test('unknown model pricing remains unknown and collector failure cannot alter measurements', async () => {
  const host = makeHost();
  await host.invoke('session.start');
  host.config.runError = new Error('collector unavailable');
  const result = { changed: ['cost'] };
  assert.equal(await host.invoke('session.measure', { context: {}, cost: { usd: 18, hasUnknownPrice: true }, rateLimits: [] }, result), result);
  await settle();
  await host.runTimer(host.pendingTimers()[0]);
  assert.equal(JSON.parse(host.calls.run[0].init.stdin).costUsd, null);
});

test('successful spawn enriches exact parent/model without raw prompts and denied spawn records nothing', async () => {
  const host = makeHost();
  await host.invoke('session.start');
  const event = { parentAgentId: 'parent-exact', subagentType: 'Explore', name: 'Explorer', prompt: 'SECRET PROMPT', description: 'SECRET DESCRIPTION', resume: { agentId: 'child' } };
  const result = { agentId: 'child', model: 'claude-example-model' };
  assert.equal(await host.invoke('agent.spawn', event, result), result);
  await settle();
  await host.runTimer(host.pendingTimers()[0]);
  const metadata = JSON.parse(host.calls.run[0].init.stdin);
  assert.equal(metadata.type, 'agent.metadata', 'resume metadata must not imply another lifecycle start');
  assert.equal(metadata.parentId, 'parent-exact');
  assert.equal(metadata.model, 'claude-example-model');
  assert.doesNotMatch(host.calls.run[0].init.stdin, /SECRET/);
  await host.invoke('agent.spawn', { subagentType: 'Explore' }, { agentId: 'root-child', model: 'claude-example-model' });
  await settle();
  await host.runTimer(host.pendingTimers()[0]);
  assert.equal(JSON.parse(host.calls.run[1].init.stdin).parentId, 'main');
  const denied = { deny: 'refused by runtime' };
  assert.equal(await host.invoke('agent.spawn', event, denied), denied);
  await settle();
  assert.equal(host.pendingTimers().length, 0);
});

test('hierarchy preserves observed edges and keeps malformed cycles and orphans visible', () => {
  const agents = [agent('main'), agent('a', { parentId: 'main' }), agent('b', { parentId: 'a' }), agent('orphan', { parentId: 'missing' }), agent('cycle1', { parentId: 'cycle2' }), agent('cycle2', { parentId: 'cycle1' })];
  const rows = agentRows([session('s', 'tree', { agents })]);
  assert.equal(rows.length, agents.length);
  assert.equal(new Set(rows.map(row => row.agent.id)).size, agents.length);
  assert.equal(rows.find(row => row.agent.id === 'b').depth, 2);
  assert.equal(rows.find(row => row.agent.id === 'orphan').agent.parentId, 'missing');
  assert.equal(snapshotOf({ schemaVersion: 2, sessions: [] }), null);
  assert.equal(numberText(null), '—');
  assert.equal(numberText(0), '0');
  assert.equal(numberText(12000), '12,000');
});

test('real ingest/reducer payload preserves null usage, metadata parent and the newest tool detail', async () => {
  const events = [];
  const hook = (hook_event_name, patch, offset) => events.push(...normalizeHook({ session_id: 's1', cwd: '/project', hook_event_name, ...patch }, { now: NOW + offset }));
  hook('SessionStart', {}, -10000);
  hook('SubagentStart', { agent_id: 'child', agent_type: 'Explore' }, -9000);
  events.push(...normalizeUsage({ type: 'agent.metadata', sessionId: 's1', agentId: 'child', parentId: 'main', model: 'known-model', name: 'Explorer' }, { now: NOW - 8000 }));
  events.push(...normalizeUsage({ type: 'usage', sessionId: 's1', scope: 'session', costUsd: 0.7, contextPercent: 30 }, { now: NOW - 7000 }));
  events.push(...normalizeUsage({ type: 'usage', sessionId: 's1', scope: 'session', costUsd: null, contextPercent: null }, { now: NOW - 6000 }));
  for (let i = 0; i < 7; i++) {
    const tool = { agent_id: 'child', tool_name: `TOOL_${i}`, tool_use_id: `tool-${i}` };
    hook('PreToolUse', tool, -5000 + i * 200);
    hook('PostToolUse', tool, -4900 + i * 200);
  }
  const state = reduceEvents(events, { now: NOW });
  assert.equal(state.sessions[0].costUsd, null);
  assert.equal(state.sessions[0].contextPercent, null);
  const child = state.sessions[0].agents.find(item => item.id === 'child');
  assert.equal(child.parentId, 'main');
  assert.equal(child.model, 'known-model');
  const host = makeHost();
  host.config.data = state;
  await host.invoke('session.start');
  await host.runCommand('agents-board');
  await button(await host.render(), 'select-s1:child')();
  const text = textOf(await host.render());
  assert.match(text, /context — · chi phí ước tính —/);
  assert.match(text, /TOOL_6/);
  assert.doesNotMatch(text, /TOOL_0/);
});
