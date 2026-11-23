#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { dataHome, serverPort, prepareHome } from '../lib/storage.mjs';

const port = serverPort();
const url = `http://127.0.0.1:${port}`;
async function isRunning() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return false;
    const status = await response.json();
    if (status.service !== 'agent-observatory') throw new Error('Port belongs to another service');
    if (status.mode === 'demo') throw new Error('The server on this port is in demo mode. Stop it before opening a live pane.');
    if (status.version !== '0.2.0') throw new Error('The server on this port is an older version. Restart it from Agent Observatory 0.2.0 before opening the office.');
    return true;
  } catch (e) { if (e.message.includes('another service') || e.message.includes('demo mode') || e.message.includes('older version')) throw e; return false; }
}
try {
  if (!await isRunning()) {
    const home = await prepareHome(dataHome());
    const log = await open(join(home, 'server.log'), 'a', 0o600);
    const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'server.mjs')], {
      detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd], env: process.env,
    });
    child.unref();
    await log.close();
    let ready = false;
    for (let i = 0; i < 12; i++) { await wait(100); if (await isRunning()) { ready = true; break; } }
    if (!ready) throw new Error('Server did not start. Run npm start in the project directory to inspect the error.');
  }
  process.stdout.write(`${url}\n`);
} catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 1; }
