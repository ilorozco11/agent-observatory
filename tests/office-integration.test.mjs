import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../plugin/scripts/server.mjs';
import { createOfficeDemoFrames } from '../plugin/lib/office-demo.mjs';
import { deriveOffice } from '../plugin/web/office-model.mjs';

test('office window serves its assets and ES module with JavaScript MIME', async () => {
  const home = await mkdtemp(join(tmpdir(), 'observatory-office-'));
  const server = makeServer({ home, port: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(origin + '/office');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /id="agent-layer"/);
    for (const path of ['/office.js', '/office-model.mjs', '/office/office-model.mjs']) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), /javascript/, path);
    }
    for (const path of ['/office.css', '/office-scene.svg', '/office/']) assert.equal((await fetch(origin + path)).status, 200, path);
    const replay = await (await fetch(origin + '/api/office-demo')).json();
    assert.equal(replay.mode, 'demo');
    assert.equal(replay.frames.length, 14);
    assert.ok(replay.frames.every(frame => frame.snapshot.source.mode === 'demo'));
    const live = await (await fetch(origin + '/api/state')).json();
    assert.equal(live.source.mode, 'live');
    assert.equal(live.sessions.length, 0, 'demo must not populate live journal');
  } finally {
    server.closeStreams();
    await new Promise(resolve => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});

test('office replay demonstrates observed phases without future events', () => {
  const frames = createOfficeDemoFrames('2026-11-23T12:00:00Z');
  const phases = new Set();
  let previous = 0;
  for (const { label, snapshot } of frames) {
    assert.ok(label.length > 0);
    assert.equal(snapshot.source.mode, 'demo');
    const now = Date.parse(snapshot.generatedAt);
    assert.ok(now > previous); previous = now;
    for (const session of snapshot.sessions) for (const event of session.events) assert.ok(Date.parse(event.timestamp) <= now);
    const office = deriveOffice(snapshot, { now });
    for (const agent of office.agents) phases.add(agent.phase);
  }
  assert.ok(phases.has('model'), 'replay must demonstrate observed model phase');
  assert.ok(phases.has('waiting'), 'replay must demonstrate input wait');
  assert.ok(frames.at(-1).snapshot.sessions.every(session => session.status === 'completed'));
});
