import { mkdir, readFile, writeFile, rename, stat, realpath, open, rmdir } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { keyFor, prepareHome } from './storage.mjs';

const METRICS = { input: 'input_tokens', output: 'output_tokens', cacheRead: 'cache_read_input_tokens', cacheWrite: 'cache_creation_input_tokens' };
export function mergeReportedUsage(rows, line) {
  const msg = line?.message;
  if (!msg?.id || !msg.usage || line.type !== 'assistant') return false;
  const key = keyFor(msg.id);
  const previous = rows[key] || {};
  let changed = false;
  for (const [name, field] of Object.entries(METRICS)) {
    const value = msg.usage[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      // Same API response appears once per content block. Keep the last reported figure.
      if (previous[name] !== value) changed = true;
      previous[name] = value;
    }
  }
  if (Object.keys(previous).length) rows[key] = previous;
  return changed;
}
export function sumReportedUsage(rows) {
  const result = Object.fromEntries(Object.keys(METRICS).map(k => [k, null]));
  for (const row of Object.values(rows)) for (const key of Object.keys(METRICS)) {
    if (typeof row[key] === 'number') result[key] = (result[key] ?? 0) + row[key];
  }
  return result;
}

export async function transcriptUsage(input, home, { now = Date.now(), env = process.env } = {}) {
  if (env.AGENT_OBSERVATORY_TRANSCRIPTS === '0') return null;
  let path = input.agent_transcript_path;
  if (!path && input.agent_id && input.transcript_path) {
    // Documented Claude Code subagent path. Never attribute the main transcript to a child.
    path = join(dirname(input.transcript_path), input.session_id, 'subagents', `agent-${input.agent_id}.jsonl`);
  }
  if (!path && !input.agent_id) path = input.transcript_path;
  if (typeof path !== 'string' || !path.endsWith('.jsonl')) return null;
  const config = resolve(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
  let actual, source;
  try {
    actual = await realpath(path.replace(/^~(?=[/\\])/, homedir()));
    const projects = await realpath(join(config, 'projects'));
    const rel = relative(projects, actual);
    if (rel.startsWith('..' + sep) || rel === '..' || resolve(projects, rel) !== actual) return null;
    source = await stat(actual);
    if (!source.isFile()) return null;
  } catch { return null; }
  await prepareHome(home);
  const cacheFile = join(home, 'usage', `${keyFor(actual)}.json`);
  const lock = cacheFile + '.lock';
  try { await mkdir(lock, { mode: 0o700 }); }
  catch {
    // Recover a lock abandoned by a killed/timed-out observer; active hooks are bounded to 5s.
    const old = await stat(lock).catch(() => null);
    if (!old || now - old.mtimeMs < 30_000) return null;
    try { await rmdir(lock); await mkdir(lock, { mode: 0o700 }); } catch { return null; }
  }
  try {
    let state;
    try { state = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* first observation */ }
    if (!state || state.ino !== source.ino || state.offset > source.size) state = { ino: source.ino, offset: 0, pending: '', rows: {}, model: null, lastRead: 0 };
    const terminal = ['Stop', 'SubagentStop', 'SessionEnd'].includes(input.hook_event_name);
    if (!terminal && now - state.lastRead < 2500) return null;
    const length = Math.min(source.size - state.offset, (terminal ? 64 : 8) * 1024 * 1024);
    if (length <= 0) return null;
    const file = await open(actual, 'r');
    let buffer;
    try { buffer = Buffer.alloc(length); const r = await file.read(buffer, 0, length, state.offset); buffer = buffer.subarray(0, r.bytesRead); }
    finally { await file.close(); }
    // Hold the bytes after the last newline. Do not persist raw transcript fragments.
    const newline = buffer.lastIndexOf(10);
    if (newline < 0) return null;
    const lines = buffer.subarray(0, newline + 1).toString('utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const value = JSON.parse(line);
        mergeReportedUsage(state.rows, value);
        if (value.type === 'assistant' && typeof value.message?.model === 'string') state.model = value.message.model.slice(0, 100);
      } catch { /* Incompatible/malformed lines do not become made-up token counts. */ }
    }
    state.offset += newline + 1;
    state.lastRead = now;
    const temp = cacheFile + `.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 });
    await rename(temp, cacheFile);
    if (state.offset < source.size && source.size - state.offset > 1024) return null;
    const tokens = sumReportedUsage(state.rows);
    if (Object.values(tokens).every(v => v === null)) return null;
    return { id: randomUUID(), type: 'usage', scope: 'agent', sessionId: input.session_id,
      agentId: input.agent_id || 'main', timestamp: new Date(now).toISOString(), model: state.model, tokens };
  } finally { await rmdir(lock).catch(() => {}); }
}
