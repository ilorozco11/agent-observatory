import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { normalizeHook, normalizeUsage, toolSummary, safeText } from '../plugin/lib/ingest.mjs';
import { appendEvents, createEventReader } from '../plugin/lib/storage.mjs';
import { mergeReportedUsage, sumReportedUsage, transcriptUsage } from '../plugin/lib/transcript.mjs';

const base = { session_id: 'session/test', cwd: '/work/sample-app', agent_id: 'tester', tool_use_id: 'tool1', tool_name: 'Bash', tool_input: { command: 'curl -H "Authorization: Bearer SECRET" https://private.example', description: 'secret notes' } };
test('normalizer retains metadata without raw prompts, command arguments or results', () => {
  const events = normalizeHook({ ...base, hook_event_name: 'PostToolUse', prompt: 'PRIVATE PROMPT', tool_response: { stdout: 'SENSITIVE OUTPUT' } });
  const text = JSON.stringify(events);
  assert.match(text, /Chạy curl/);
  for (const forbidden of ['SECRET', 'PRIVATE PROMPT', 'SENSITIVE OUTPUT', 'private.example', 'secret notes']) assert.ok(!text.includes(forbidden));
  assert.equal(events[0].agentId, 'tester');
});
test('observed permission wait and failure are not success', () => {
  assert.equal(normalizeHook({ ...base, hook_event_name: 'PermissionRequest' })[0].type, 'waiting');
  assert.equal(normalizeHook({ ...base, hook_event_name: 'PermissionDenied' })[0].status, 'denied');
  assert.equal(normalizeHook({ ...base, hook_event_name: 'PostToolUse', tool_response: { exit_code: 1 } })[0].type, 'tool.error');
});
test('agent lifecycle never guesses undocumented parent', () => {
  assert.equal(normalizeHook({ ...base, hook_event_name: 'SubagentStart', agent_type: 'Explore' })[0].parentId, null);
  assert.equal(normalizeHook({ ...base, hook_event_name: 'SubagentStart', parent_agent_id: 'known' })[0].parentId, 'known');
});
test('native metrics preserve absence and allow explicit metadata enrichment', () => {
  const [event] = normalizeUsage({ type: 'usage', sessionId: 's', costUsd: 1.2, contextPercent: 200 });
  assert.equal(event.tokens, undefined);
  assert.equal(event.contextPercent, 100);
  assert.equal(normalizeUsage({ type: 'usage', sessionId: 's', costUsd: null })[0].costUsd, null);
  assert.deepEqual(normalizeHook({ ...base, agent_id: undefined, hook_event_name: 'TeammateIdle', teammate_name: 'Other agent' }), []);
  assert.equal(normalizeUsage({ type: 'agent.metadata', sessionId: 's', agentId: 'a', parentId: 'main', name: 'Reader' })[0].parentId, 'main');
  assert.deepEqual(normalizeUsage({ type: 'turn.end', sessionId: 's' }), []);
});

test('model phase normalization keeps observed timestamps and only metadata', () => {
  const input = { type: 'model.start', sessionId: 's', agentId: 'worker', requestId: 'request-1', model: 'model-name', timestamp: '2026-11-23T08:00:00.000Z', prompt: 'PRIVATE', messages: ['PRIVATE'], content: 'PRIVATE', thinking: 'PRIVATE' };
  const [event] = normalizeUsage(input, { now: Date.parse('2026-11-23T09:00:00Z') });
  assert.equal(event.timestamp, input.timestamp, 'arrival time must not overwrite observation time');
  assert.equal(event.requestId, 'request-1');
  assert.equal(event.agentId, 'worker');
  assert.doesNotMatch(JSON.stringify(event), /PRIVATE|prompt|messages|thinking|content/);
  assert.deepEqual(normalizeUsage({ ...input, timestamp: 'invalid' }), []);
  assert.deepEqual(normalizeUsage({ ...input, requestId: null }), []);
  assert.deepEqual(normalizeUsage({ ...input, agentId: undefined }), []);
});
test('token snapshots deduplicate repeated content blocks and retain latest reported usage', () => {
  const rows = {};
  const msg = (id, n) => ({ type: 'assistant', message: { id, usage: { input_tokens: 100, output_tokens: n, cache_read_input_tokens: 40 } } });
  mergeReportedUsage(rows, msg('api1', 5));
  mergeReportedUsage(rows, msg('api1', 10));
  mergeReportedUsage(rows, msg('api2', 20));
  assert.deepEqual(sumReportedUsage(rows), { input: 200, output: 30, cacheRead: 80, cacheWrite: null });
});
test('concurrent append and malformed trailing record preserve valid observations', async () => {
  const home = await mkdtemp(join(tmpdir(), 'observatory-events-'));
  try {
    await Promise.all(Array.from({ length: 40 }, (_, i) => appendEvents([{ id: String(i), sessionId: '../same', type: 'tool.start', timestamp: new Date().toISOString() }], home)));
    const reader = createEventReader(home);
    const result = await reader();
    assert.equal(result.events.length, 40);
    assert.equal((await readdir(join(home, 'events'))).length, 1);
    const file = join(home, 'events', (await readdir(join(home, 'events')))[0]);
    await writeFile(file, '{broken\n', { flag: 'a' });
    const next = await reader();
    assert.equal(next.events.length, 40);
    assert.ok(next.warnings.length > 0);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test('transcript enrichment is incremental, scoped, and does not persist conversation text', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'observatory-transcript-'));
  const config = join(temp, 'claude');
  const home = join(temp, 'data');
  const project = join(config, 'projects', 'work');
  await mkdir(project, { recursive: true });
  const file = join(project, 'session.jsonl');
  const row = { type: 'assistant', message: { id: 'm1', model: 'example-model', content: [{ text: 'DO NOT STORE THIS' }], usage: { input_tokens: 200, output_tokens: 12 } } };
  try {
    await writeFile(file, JSON.stringify(row) + '\n' + JSON.stringify(row) + '\n');
    const raw = { session_id: 'session', transcript_path: file, hook_event_name: 'Stop' };
    const u = await transcriptUsage(raw, home, { env: { CLAUDE_CONFIG_DIR: config } });
    assert.equal(u.tokens.input, 200);
    assert.equal(u.tokens.output, 12);
    assert.equal(u.agentId, 'main');
    assert.equal(u.scope, 'agent');
    assert.equal(await transcriptUsage(raw, home, { env: { CLAUDE_CONFIG_DIR: config } }), null);
    const cache = await readFile(join(home, 'usage', (await readdir(join(home, 'usage'))).find(x => x.endsWith('.json'))), 'utf8');
    assert.ok(!cache.includes('DO NOT STORE THIS'));
    const outside = join(temp, 'outside.jsonl');
    await writeFile(outside, JSON.stringify(row) + '\n');
    assert.equal(await transcriptUsage({ ...raw, transcript_path: outside }, home, { env: { CLAUDE_CONFIG_DIR: config } }), null);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
test('collector errors never block Claude or print hook decision JSON', () => {
  const child = spawnSync(process.execPath, ['plugin/scripts/collect.mjs'], { input: '{invalid', encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
});
