#!/usr/bin/env node
import { normalizeHook, normalizeUsage } from '../lib/ingest.mjs';
import { appendEvents, dataHome } from '../lib/storage.mjs';
import { transcriptUsage } from '../lib/transcript.mjs';

async function stdin() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error('Hook input too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// This observer must never change a permission decision, tool result or Stop verdict.
try {
  const eventArg = process.argv.indexOf('--event');
  const input = JSON.parse(eventArg >= 0 ? process.argv[eventArg + 1] : await stdin());
  const normalized = process.argv.includes('--normalized') || eventArg >= 0;
  const events = normalized ? normalizeUsage(input) : normalizeHook(input);
  const home = dataHome();
  await appendEvents(events, home);
  if (!normalized && ['PostToolUse', 'PostToolUseFailure', 'SubagentStop', 'Stop', 'SessionEnd'].includes(input.hook_event_name)) {
    const usage = await transcriptUsage(input, home).catch(() => null);
    if (usage) await appendEvents([usage], home);
  }
} catch {
  // Deliberately no raw input, stdout JSON, or hook-blocking exit code.
  if (process.env.AGENT_OBSERVATORY_DEBUG === '1') process.stderr.write('[agent-observatory] Observation skipped; check local data permissions or input format.\n');
}
process.exitCode = 0;
