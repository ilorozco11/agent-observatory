import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOffice, officeKey } from '../plugin/web/office-model.mjs';
import { reduceEvents } from '../plugin/lib/model.mjs';
import { normalizeUsage } from '../plugin/lib/ingest.mjs';

const NOW = Date.parse('2026-11-23T08:00:00Z');
const iso = delta => new Date(NOW + delta).toISOString();
const agent = (id, patch = {}) => ({ id, name: id, type: 'worker', status: 'running', startedAt: iso(-5000), lastEventAt: iso(-1000), tools: [], events: [], ...patch });
const session = (id, agents, patch = {}) => ({ id, project: id, agents, tasks: [], ...patch });
const snapshot = sessions => ({ schemaVersion: 1, generatedAt: iso(0), source: { mode: 'live', connected: true, staleAfterMs: 90000 }, sessions });
const scene = (agents, options = {}) => deriveOffice(snapshot([session('s1', agents)]), { now: NOW, ...options });
const runningTool = (name, patch = {}) => ({ id: name, name, status: 'running', startedAt: iso(-1000), endedAt: null, summary: 'Observed tool metadata', ...patch });

test('observed tool categories select office zones without inventing test or planning claims', () => {
  const cases = [['Read', 'reading', 'library'], ['Grep', 'reading', 'library'], ['Edit', 'editing', 'desk'], ['Bash', 'terminal', 'terminal'], ['mcp__browser__run', 'tool', 'terminal'], ['WebSearch', 'reading', 'library'], ['WebFetch', 'reading', 'library'], ['Agent', 'delegating', 'meeting']];
  for (const [name, phase, zone] of cases) {
    const actor = scene([agent(name, { tools: [runningTool(name)] })]).agents[0];
    assert.equal(actor.phase, phase);
    assert.equal(actor.zone, zone);
    assert.equal(actor.evidence.kind, 'observed');
    assert.equal(actor.animate, true);
    assert.equal(actor.activity, 'Observed tool metadata');
  }
});

test('running without phase evidence is inferred processing and never fabricated thought content', () => {
  const actor = scene([agent('a')]).agents[0];
  assert.equal(actor.phase, 'processing');
  assert.equal(actor.evidence.kind, 'inferred');
  assert.equal(actor.task, null);
  assert.match(actor.evidence.detail, /không xác định/);
});

test('actual normalized turn.step phases identify a model request and its end', () => {
  const start = normalizeUsage({ type: 'model.start', sessionId: 's1', agentId: 'a', requestId: 'r1', timestamp: iso(-1000) });
  const base = [{ id: 'agent', type: 'agent.start', sessionId: 's1', agentId: 'a', timestamp: iso(-2000) }];
  const running = deriveOffice(reduceEvents([...base, ...start], { now: NOW }), { now: NOW });
  assert.equal(running.agents[0].phase, 'model');
  assert.equal(running.agents[0].label, 'Đang gọi model');
  assert.equal(running.agents[0].evidence.kind, 'observed');
  const end = normalizeUsage({ type: 'model.end', sessionId: 's1', agentId: 'a', requestId: 'r1', timestamp: iso(-500) });
  assert.equal(deriveOffice(reduceEvents([...end, ...base, ...start], { now: NOW }), { now: NOW }).agents[0].phase, 'processing');
});

test('newer observed model work overrides idle/error office phase but retains lifecycle and waits', () => {
  for (const status of ['idle', 'error', 'waiting']) {
    const state = scene([agent('a', {
      status, modelActivity: { active: true, startedAt: iso(-500) },
      events: [{ type: status === 'idle' ? 'turn.end' : status === 'error' ? 'tool.error' : 'waiting', status, timestamp: iso(-1000) }],
    })]);
    assert.equal(state.agents[0].status, status, 'stored lifecycle remains visible');
    assert.equal(state.agents[0].phase, status === 'waiting' ? 'waiting' : 'model');
    assert.equal(state.counts.running, status === 'waiting' ? 0 : 1);
  }
  const newerError = scene([agent('a', { status: 'error', modelActivity: { active: true, startedAt: iso(-1500) }, events: [{ type: 'tool.error', status: 'error', timestamp: iso(-1000) }] })]);
  assert.equal(newerError.agents[0].phase, 'error', 'an old orphan model request cannot hide a newer error');
});

test('overlapping tool and model signals show the newer observed activity', () => {
  const newerModel = scene([agent('a', { tools: [runningTool('Bash', { startedAt: iso(-2000) })], modelActivity: { active: true, startedAt: iso(-1000) } })]);
  assert.equal(newerModel.agents[0].phase, 'model');
  const newerTool = scene([agent('a', { tools: [runningTool('Edit', { startedAt: iso(-500) })], modelActivity: { active: true, startedAt: iso(-1000) } })]);
  assert.equal(newerTool.agents[0].phase, 'editing');
});

test('waiting and ended lifecycle take precedence over orphan running tools and model requests', () => {
  const observed = { tools: [runningTool('Bash')], modelActivity: { active: true, startedAt: iso(-1000) } };
  const state = scene([
    agent('wait', { ...observed, status: 'waiting', events: [{ type: 'waiting', timestamp: iso(-500), detail: 'Chờ cấp quyền' }] }),
    agent('done', { ...observed, status: 'completed', endedAt: iso(-200) }),
    agent('unconfirmed', { ...observed, status: 'unknown', endedAt: iso(-200) }),
  ]);
  assert.equal(state.agents.find(a => a.agentId === 'wait').phase, 'waiting');
  assert.equal(state.agents.find(a => a.agentId === 'wait').activity, 'Chờ cấp quyền');
  assert.equal(state.agents.find(a => a.agentId === 'done').phase, 'completed');
  assert.equal(state.agents.find(a => a.agentId === 'unconfirmed').phase, 'unknown');
});

test('disconnected and stale scenes freeze activity without turning work into success or error', () => {
  const stale = scene([agent('a', { lastEventAt: iso(-100000), tools: [runningTool('Edit')] })]);
  assert.equal(stale.agents[0].stale, true);
  assert.equal(stale.agents[0].animate, false);
  assert.equal(stale.agents[0].status, 'running');
  assert.equal(stale.agents[0].phase, 'editing');
  const offline = scene([agent('a', { tools: [runningTool('Edit')] })], { connected: false });
  assert.equal(offline.source.connected, false);
  assert.equal(offline.agents[0].animate, false);
  assert.equal(offline.agents[0].phase, 'editing');
});

test('stable session-scoped slots survive reordered snapshots, filtering and new arrivals', () => {
  const one = snapshot([session('s1', [agent('z'), agent('same')]), session('s2', [agent('same')])]);
  const before = deriveOffice(one, { now: NOW });
  const after = deriveOffice(snapshot([session('s2', [agent('same')]), session('s1', [agent('a-new'), agent('same'), agent('z')])]), { now: NOW, previousSlots: before.slots, sessionId: 's1' });
  for (const key of Object.keys(before.slots)) assert.equal(after.slots[key], before.slots[key]);
  assert.equal(new Set(Object.values(after.slots)).size, 4);
  assert.notEqual(officeKey('s1', 'same'), officeKey('s2', 'same'));
  assert.equal(after.counts.total, 3);
});

test('map capacity preserves explicit overflow and filtering exposes matching actors', () => {
  const input = Array.from({ length: 17 }, (_, i) => agent(`agent-${String(i).padStart(2, '0')}`));
  const state = scene(input);
  assert.equal(state.agents.length, 12);
  assert.equal(state.overflow.length, 5);
  assert.equal(state.counts.total, 17);
  assert.equal(state.counts.running, 17);
  assert.deepEqual(state.agents.map(a => a.displaySeat), Array.from({ length: 12 }, (_, i) => i));
  assert.ok(state.overflow.every(a => a.displaySeat === null));
  const filtered = scene(input, { search: 'agent-16', previousSlots: state.slots });
  assert.equal(filtered.agents.length, 1);
  assert.equal(filtered.agents[0].seat, state.slots[officeKey('s1', 'agent-16')]);
  assert.equal(filtered.agents[0].displaySeat, 0);
});

test('duplicate actors and duplicate completed tools cannot inflate counts or show active work', () => {
  const running = agent('same', { tools: [runningTool('Read'), runningTool('Read', { status: 'success', endedAt: iso(-500) })] });
  const duplicate = agent('same', { status: 'completed', endedAt: iso(-200), lastEventAt: iso(-200) });
  const state = scene([running, duplicate]);
  assert.equal(state.counts.total, 1);
  assert.equal(state.agents[0].phase, 'completed');
  const tools = scene([running]);
  assert.equal(tools.agents[0].phase, 'processing');
});

test('waiting and active work remain on the map when historical completed agents fill its capacity', () => {
  const history = Array.from({ length: 12 }, (_, i) => agent(`old-${String(i).padStart(2, '0')}`, { status: 'completed', endedAt: iso(-2000) }));
  const before = scene(history);
  const state = scene([...history, agent('new-running'), agent('new-waiting', { status: 'waiting' })], { previousSlots: before.slots });
  assert.equal(state.agents.length, 12);
  assert.deepEqual(state.agents.slice(0, 2).map(a => a.agentId), ['new-waiting', 'new-running']);
  assert.equal(state.overflow.length, 2);
  assert.ok(state.overflow.every(a => a.phase === 'completed'));
  assert.equal(state.counts.total, 14);
  assert.equal(state.counts.completed, 12);
  assert.equal(state.counts.running, 1);
  assert.equal(state.counts.waiting, 1);
  for (const [key, seat] of Object.entries(before.slots)) assert.equal(state.slots[key], seat);
  const visibleHistory = state.agents.filter(a => a.phase === 'completed');
  assert.deepEqual(visibleHistory.map(a => a.seat), [...visibleHistory.map(a => a.seat)].sort((a, b) => a - b));
});

test('task text comes only from agent metadata or an explicitly owned current task', () => {
  const state = deriveOffice(snapshot([session('s1', [agent('a'), agent('b', { name: 'duplicate' }), agent('c', { name: 'duplicate' })], { tasks: [
    { id: '1', owner: 'a', status: 'in_progress', subject: 'Known assignment' },
    { id: '2', owner: 'duplicate', status: 'in_progress', subject: 'Ambiguous ownership' },
    { id: '3', owner: null, status: 'in_progress', subject: 'Unassigned' },
  ] })]), { now: NOW });
  assert.equal(state.agents.find(a => a.agentId === 'a').task, 'Known assignment');
  assert.equal(state.agents.find(a => a.agentId === 'b').task, null);
  assert.equal(state.agents.find(a => a.agentId === 'c').task, null);
});

test('empty, malformed and demo snapshots remain explicit and deterministic', () => {
  assert.equal(deriveOffice(null, { now: NOW }).counts.total, 0);
  assert.equal(deriveOffice({ sessions: [null, {}, { id: 'empty', agents: [null, {}] }] }, { now: NOW }).agents.length, 0);
  const sample = snapshot([session('s1', [agent('a')])]);
  sample.source.mode = 'demo';
  const result = deriveOffice(sample);
  assert.equal(result.source.mode, 'demo');
  assert.equal(result.agents[0].stale, false, 'demo uses its own time unless overridden');
});
