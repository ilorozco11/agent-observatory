import { mkdir, appendFile, readdir, stat, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const DEFAULT_PORT = 47831;
export function dataHome(env = process.env) {
  return env.AGENT_OBSERVATORY_HOME || join(homedir(), '.claude', 'agent-observatory');
}
export function serverPort(env = process.env) {
  const n = Number(env.AGENT_OBSERVATORY_PORT || DEFAULT_PORT);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error('AGENT_OBSERVATORY_PORT must be 1024–65535');
  return n;
}
export function keyFor(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}
export async function prepareHome(home = dataHome()) {
  await mkdir(join(home, 'events'), { recursive: true, mode: 0o700 });
  await mkdir(join(home, 'usage'), { recursive: true, mode: 0o700 });
  return home;
}
export async function appendEvents(events, home = dataHome()) {
  if (!events.length) return;
  await prepareHome(home);
  for (const event of events) {
    if (!event.sessionId) continue;
    const file = join(home, 'events', `${keyFor(event.sessionId)}.jsonl`);
    // A single append per bounded record. No shared mutable state between hook processes.
    const line = JSON.stringify(event) + '\n';
    if (Buffer.byteLength(line) > 64 * 1024) throw new Error('Normalized event exceeds 64 KiB');
    await appendFile(file, line, { encoding: 'utf8', mode: 0o600 });
  }
}

export function createEventReader(home = dataHome(), { maxFiles = 100, maxFileBytes = 8 * 1024 * 1024 } = {}) {
  const cache = new Map();
  return async function readEvents() {
    const warnings = [];
    let names;
    try { names = (await readdir(join(home, 'events'))).filter(n => /^[a-f0-9]{32}\.jsonl$/.test(n)); }
    catch (e) { if (e.code === 'ENOENT') return { events: [], warnings }; throw e; }
    const files = await Promise.all(names.map(async name => ({ name, stats: await stat(join(home, 'events', name)).catch(() => null) })));
    const active = files.filter(f => f.stats?.isFile()).sort((a,b) => b.stats.mtimeMs - a.stats.mtimeMs).slice(0, maxFiles);
    if (files.length > maxFiles) warnings.push(`Đang hiển thị ${maxFiles} phiên có dữ liệu mới nhất.`);
    const events = [];
    for (const { name, stats } of active) {
      const signature = `${stats.size}:${stats.mtimeMs}`;
      if (cache.get(name)?.signature !== signature) {
        let text;
        let truncated = false;
        const file = join(home, 'events', name);
        if (stats.size > maxFileBytes) {
          const fd = await open(file, 'r');
          try {
            const buf = Buffer.alloc(maxFileBytes);
            const read = await fd.read(buf, 0, maxFileBytes, stats.size - maxFileBytes);
            text = buf.subarray(0, read.bytesRead).toString('utf8');
            text = text.slice(text.indexOf('\n') + 1);
          } finally { await fd.close(); }
          truncated = true;
        } else text = await readFile(file, 'utf8');
        let invalid = 0;
        const parsed = [];
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try { parsed.push(JSON.parse(line)); } catch { invalid++; }
        }
        cache.set(name, { signature, events: parsed, invalid, truncated });
      }
      const item = cache.get(name);
      events.push(...item.events);
      if (item.invalid) warnings.push('Một số bản ghi đang ghi dở hoặc không hợp lệ đã được bỏ qua.');
      if (item.truncated) warnings.push('Lịch sử phiên dài đã được giới hạn; số liệu phiên đó có thể chỉ gồm phần gần nhất.');
    }
    const retained = new Set(active.map(f => f.name));
    for (const name of cache.keys()) if (!retained.has(name)) cache.delete(name);
    return { events, warnings: [...new Set(warnings)] };
  };
}
