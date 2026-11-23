import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { get } from 'node:http';
import { makeServer } from '../plugin/scripts/server.mjs';

async function fixture(fn) {
  const home = await mkdtemp(join(tmpdir(), 'observatory-server-'));
  const server = makeServer({ home, port: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ home, server, url }); }
  finally { server.closeStreams(); await new Promise(resolve => server.close(resolve)); await rm(home, { recursive: true, force: true }); }
}
test('live empty state stays empty; demo is explicit and labelled', () => fixture(async ({ url }) => {
  const live = await (await fetch(url + '/api/state')).json();
  assert.equal(live.source.mode, 'live');
  assert.equal(live.sessions.length, 0);
  const demo = await (await fetch(url + '/api/state?demo=1')).json();
  assert.equal(demo.source.mode, 'demo');
  assert.ok(demo.sessions.length >= 2);
  assert.ok(demo.source.warnings.length > 0);
}));
test('local API rejects cross-origin, hostile Host, mutations and path traversal', () => fixture(async ({ url }) => {
  assert.equal((await fetch(url + '/api/state', { headers: { Origin: 'https://elsewhere.example' } })).status, 403);
  // Fetch normalizes Host; use an actual HTTP request to exercise the server boundary.
  const hostile = await new Promise((resolve, reject) => get(url + '/api/state', { headers: { Host: 'hostile.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
  assert.equal(hostile, 403);
  assert.equal((await fetch(url + '/api/state', { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await fetch(url + '/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(url + '/api/state')).headers.get('access-control-allow-origin'), null);
}));
test('hook process → local journal → API snapshot retains agent/tool identity', () => fixture(async ({ url, home }) => {
  const events = [
    { hook_event_name: 'SessionStart', model: 'reported-model' },
    { hook_event_name: 'UserPromptSubmit', prompt: 'Never persist this prompt' },
    { hook_event_name: 'SubagentStart', agent_id: 'worker', agent_type: 'Explore' },
    { hook_event_name: 'PreToolUse', agent_id: 'worker', tool_name: 'Read', tool_use_id: 't1', tool_input: { file_path: '/work/project/src/app.ts' } },
    { hook_event_name: 'PostToolUse', agent_id: 'worker', tool_name: 'Read', tool_use_id: 't1', tool_input: { file_path: '/work/project/src/app.ts' }, tool_response: { content: 'Do not retain tool output' } },
    { hook_event_name: 'SubagentStop', agent_id: 'worker', agent_type: 'Explore' },
  ];
  for (const event of events) {
    const p = spawnSync(process.execPath, ['plugin/scripts/collect.mjs'], { encoding: 'utf8', env: { ...process.env, AGENT_OBSERVATORY_HOME: home, AGENT_OBSERVATORY_TRANSCRIPTS: '0' }, input: JSON.stringify({ session_id: 'integration', cwd: '/work/project', ...event }) });
    assert.equal(p.status, 0); assert.equal(p.stdout, '');
  }
  const response = await fetch(url + '/api/state');
  const snapshot = await response.json();
  const worker = snapshot.sessions[0].agents.find(a => a.id === 'worker');
  assert.equal(worker.status, 'completed');
  assert.equal(worker.toolCalls, 1);
  assert.equal(worker.tools[0].status, 'success');
  assert.deepEqual(worker.files, ['src/app.ts']);
  assert.equal(worker.tokens.input, null);
  assert.ok(!JSON.stringify(snapshot).includes('Never persist'));
  const stream = await fetch(url + '/api/events');
  const reader = stream.body.getReader();
  let text = '';
  while (!text.includes('event: snapshot')) { const value = await reader.read(); text += new TextDecoder().decode(value.value); }
  assert.match(text, /integration/);
  await reader.cancel();
}));
