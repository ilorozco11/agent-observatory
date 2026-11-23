// Claude Code function-hook entry. Standard command hooks collect events separately.
// API calls use the official fully-qualified form required by the mod validator.
// Reference: https://code.claude.com/docs/en/plugins/mods/reference
import { renderBoard, snapshotOf } from './view.mjs';

const PANE = 'agent-observatory';
const DEFAULT_PORT = 47831;
const POLL_MS = 2000;

function hostOf($) {
  return {
    register: (name, description, argumentHint) => $.command.register({ name, description, argumentHint, immediate: true }),
    sessionId: () => $.session.id(),
    pluginRoot: () => $.plugin.root(),
    port: () => $.env.get('AGENT_OBSERVATORY_PORT'),
    fetch: url => $.http.fetch(url, { method: 'GET' }),
    run: argv => $.process.run(argv, { timeoutMs: 10000 }),
    now: () => $.clock.now(),
    every: (ms, fn) => $.clock.every(ms, fn),
    after: (ms, fn) => $.clock.after(ms, fn),
    record: (script, event) => $.process.run(['node', script, '--normalized'], { stdin: JSON.stringify(event), timeoutMs: 2000 }),
    open: () => $.ui.open({ id: PANE, title: 'Agent Observatory' }),
    close: () => $.ui.close({ id: PANE }),
    redraw: () => $.ui.invalidate('ui.render'),
    log: text => $.ui.log(text),
  };
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

async function queueMeasurement(state, e) {
  const epoch = state.epoch;
  const [sessionId, root, now] = await Promise.all([
    state.host.sessionId(), state.host.pluginRoot(), state.host.now(),
  ]);
  if (epoch !== state.epoch) return;
  // This is reported context occupancy, not cumulative token consumption.
  // SessionMeasureInput has no lifetime token totals, so do not manufacture them.
  state.pendingUsage = {
    type: 'usage', scope: 'session', sessionId: String(sessionId),
    timestamp: new Date(now).toISOString(),
    contextPercent: finite(e.context?.percent),
    costUsd: e.cost?.hasUnknownPrice ? null : finite(e.cost?.usd),
    costEstimated: true,
    rateLimits: Array.isArray(e.rateLimits) ? e.rateLimits.filter(limit => typeof limit.kind === 'string' && finite(limit.percentUsed) !== null).map(limit => ({
      kind: limit.kind, percentUsed: limit.percentUsed,
      ...(typeof limit.resetsAt === 'string' ? { resetsAt: limit.resetsAt } : {}),
    })) : [],
  };
  state.collectorScript = `${String(root).replace(/[\\/]$/, '')}/scripts/collect.mjs`;
  if (state.usageTimer || state.writingUsage) return;
  const delay = Math.max(0, 5000 - (now - state.lastUsageAt));
  state.usageTimer = state.host.after(delay, () => {
    state.usageTimer = null;
    void flushUsage(state);
  });
}

async function flushUsage(state) {
  if (!state.pendingUsage || state.writingUsage) return;
  const event = state.pendingUsage;
  state.pendingUsage = null;
  state.writingUsage = true;
  try {
    state.lastUsageAt = await state.host.now();
    await state.host.record(state.collectorScript, event);
  } catch {
    // Observability must never change a measurement, tool outcome, or model turn.
  } finally {
    state.writingUsage = false;
    if (state.pendingUsage && !state.usageTimer) {
      state.usageTimer = state.host.after(5000, () => {
        state.usageTimer = null;
        void flushUsage(state);
      });
    }
  }
}

async function recordAgentMetadata(state, event, result) {
  if (typeof result?.agentId !== 'string' || result.deny) return;
  const epoch = state.epoch;
  const [sessionId, root, now] = await Promise.all([
    state.host.sessionId(), state.host.pluginRoot(), state.host.now(),
  ]);
  if (epoch !== state.epoch) return;
  const record = {
    type: 'agent.metadata', sessionId: String(sessionId),
    timestamp: new Date(now).toISOString(), agentId: result.agentId,
    // Official AgentSpawnInput: absent parentAgentId explicitly means main.
    parentId: typeof event.parentAgentId === 'string' ? event.parentAgentId : 'main',
    agentType: typeof event.subagentType === 'string' ? event.subagentType : null,
    name: typeof event.name === 'string' ? event.name : typeof event.subagentType === 'string' ? event.subagentType : null,
    model: typeof result.model === 'string' ? result.model : null,
  };
  const script = `${String(root).replace(/[\\/]$/, '')}/scripts/collect.mjs`;
  state.host.after(0, () => { void state.host.record(script, record).catch(() => {}); });
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function portOf(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
}

async function modelRequestContext(state, e) {
  if (!state.host) return null;
  const [sessionId, root, now] = await Promise.all([
    state.host.sessionId(), state.host.pluginRoot(), state.host.now(),
  ]);
  return {
    script: `${String(root).replace(/[\\/]$/, '')}/scripts/collect.mjs`,
    event: {
      type: 'model.start', sessionId: String(sessionId),
      agentId: typeof e.agentId === 'string' ? e.agentId : 'main',
      requestId: `${state.instanceId}:${++state.requestSequence}:${now}`,
      timestamp: new Date(now).toISOString(),
      ...(typeof e.model === 'string' ? { model: e.model } : {}),
    },
  };
}

function recordPhase(state, context, type, now) {
  try {
    // Never await disk/process work while forwarding the model stream. The
    // timestamp above is observed before this asynchronous write is launched.
    void state.host.record(context.script, { ...context.event, type, timestamp: new Date(now).toISOString() }).catch(() => {});
  } catch { /* collection never changes an event, result, or streamed chunk */ }
}

async function initialize(state) {
  if (state.initialized) return;
  const [id, root, port, now] = await Promise.all([
    state.host.sessionId(), state.host.pluginRoot(), state.host.port(), state.host.now(),
  ]);
  state.sessionId = String(id);
  state.pluginRoot = String(root);
  state.baseUrl = `http://127.0.0.1:${portOf(port)}`;
  state.now = now;
  state.initialized = true;
}

async function readSnapshot(state) {
  if (!state.host || state.loading) return;
  state.loading = true;
  try {
    state.now = await state.host.now();
    const response = await state.host.fetch(`${state.baseUrl}/api/state`);
    if (response.status !== 200) throw new Error(`Dashboard trả HTTP ${response.status}.`);
    const snapshot = snapshotOf(JSON.parse(response.text));
    if (!snapshot) throw new Error('Dữ liệu dashboard không đúng schema v1.');
    state.snapshot = snapshot;
    state.lastFetchedAt = new Date(state.now).toISOString();
    state.error = null;
  } catch (error) {
    state.error = `Chưa đọc được collector: ${message(error).slice(0, 180)}`;
  } finally {
    state.loading = false;
    state.host.redraw();
  }
}

async function startServer(state) {
  // Explicit dashboard commands are the only path that launches the server.
  // No process, network request, or timer is started at session.start.
  const script = `${state.pluginRoot.replace(/[\\/]$/, '')}/scripts/start.mjs`;
  const result = await state.host.run(['node', script]);
  if (result.exitCode !== 0) throw new Error((result.stderr || result.stdout || 'Không khởi động được dashboard.').trim().slice(0, 240));
}

function stopPolling(state) {
  state.timer?.cancel();
  state.timer = null;
}

function startPolling(state) {
  if (state.timer) return;
  state.timer = state.host.every(POLL_MS, () => {
    if (state.open) void readSnapshot(state);
  });
}

async function closeBoard(state) {
  await state.host.close();
  state.open = false;
  stopPolling(state);
}

function actionsOf(state) {
  const change = fn => { fn(); state.host.redraw(); };
  return {
    refresh: () => readSnapshot(state),
    close: () => closeBoard(state),
    toggleScope: () => change(() => { state.scope = state.scope === 'all' ? 'current' : 'all'; state.selected = null; state.limit = 20; }),
    toggleAttention: () => change(() => { state.attentionOnly = !state.attentionOnly; state.selected = null; }),
    tab: tab => change(() => { state.tab = tab; }),
    select: key => change(() => { state.selected = state.selected === key ? null : key; }),
    clearSelection: () => change(() => { state.selected = null; }),
    showMore: () => change(() => { state.limit += 20; }),
  };
}

export function register(on) {
  const state = {
    host: null, initialized: false, sessionId: null, pluginRoot: '',
    baseUrl: `http://127.0.0.1:${DEFAULT_PORT}`, snapshot: null,
    error: null, loading: false, open: false, timer: null,
    now: 0, lastFetchedAt: null, tab: 'agents', scope: 'current',
    selected: null, attentionOnly: false, limit: 20,
    pendingUsage: null, usageTimer: null, writingUsage: false,
    lastUsageAt: -Infinity, collectorScript: '', epoch: 0,
    instanceId: Math.random().toString(36).slice(2), requestSequence: 0,
  };

  on('session.start', async ($, e, next) => {
    state.host = hostOf($);
    try {
      await state.host.register('agents-board', 'Open the local Agent Observatory pane', '[all|close]');
      await state.host.register('agents-web', 'Start the local dashboard and show its URL', '');
      await state.host.register('agents-office', 'Open the local realtime agent office', '');
    } catch (error) {
      state.host.log(`Agent Observatory: ${message(error)}`);
    }
    return next(e);
  });

  on('command.run', { command: 'agents-board' }, async ($, e, next) => {
    if (!state.host) return next(e);
    if (String(e.args ?? '').trim() === 'close') {
      await closeBoard(state);
      return { text: 'Đã đóng Agent Observatory.' };
    }
    try {
      await initialize(state);
      if (String(e.args ?? '').trim() === 'all') state.scope = 'all';
      await startServer(state);
    } catch (error) {
      state.error = `Chưa khởi động được dashboard: ${message(error)}`;
      state.open = false;
      stopPolling(state);
      state.host.redraw();
      return { text: state.error };
    }
    let placement;
    try {
      placement = await state.host.open();
    } catch (error) {
      return { text: `Dashboard web: ${state.baseUrl}\nPane chưa mở được: ${message(error)}` };
    }
    // A headless run has no surface: show the URL and do not keep a poller alive.
    state.open = placement?.isPlaced !== false;
    if (state.open) startPolling(state);
    else stopPolling(state);
    await readSnapshot(state);
    return { text: `Agent Observatory · ${state.baseUrl}${state.open ? '' : '\nChưa có surface hiển thị pane; mở URL trong trình duyệt.'}` };
  });

  on('command.run', { command: 'agents-web' }, async ($, e, next) => {
    if (!state.host) return next(e);
    try {
      await initialize(state);
      await startServer(state);
      return { text: `Agent Observatory: ${state.baseUrl}\nMở liên kết này trong trình duyệt. Dữ liệu được thu thập cục bộ trên máy đang chạy Claude Code.` };
    } catch (error) {
      return { text: `Chưa khởi động được dashboard: ${message(error)}` };
    }
  });

  on('command.run', { command: 'agents-office' }, async ($, e, next) => {
    if (!state.host) return next(e);
    try {
      await initialize(state);
      await startServer(state);
      return { text: `Agent Office: ${state.baseUrl}/office\nMở liên kết này trong trình duyệt để theo dõi agents theo thời gian thực.` };
    } catch (error) {
      return { text: `Chưa khởi động được văn phòng: ${message(error)}` };
    }
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE || !state.host) return next(e);
    if (e.surface !== 'terminal' && e.surface !== 'desktop' && e.surface !== 'vscode') return next(e);
    const ui = await $.ui.resolve(e);
    return renderBoard(ui, state, actionsOf(state));
  });

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e);
    if (!result?.deny) {
      state.open = false;
      stopPolling(state);
    }
    return result;
  });

  on('turn.complete', ($, e, next) => {
    if (state.open) void readSnapshot(state);
    return next(e);
  });

  // Official turn.step is an async generator around one model request, including
  // subagent requests. We record lifecycle metadata, never inspect the prompt,
  // response chunks, reasoning, or final answer. yield* preserves every chunk and
  // the generator's final result, including on error or consumer cancellation.
  on('turn.step', async function* ($, e, next) {
    let context = null;
    try {
      context = await modelRequestContext(state, e);
      if (context) recordPhase(state, context, 'model.start', Date.parse(context.event.timestamp));
    } catch { /* metadata APIs unavailable: forward normally */ }
    try {
      return yield* next(e);
    } finally {
      if (context) {
        try { recordPhase(state, context, 'model.end', await state.host.now()); }
        catch { /* model result/errors still propagate unchanged */ }
      }
    }
  });

  // Measurements are already known by the engine. Their observer does not call
  // a model, inspect prompts, or calculate billing. Writes are throttled to 5s.
  on('session.measure', async ($, e, next) => {
    const result = await next(e);
    if (state.host) void queueMeasurement(state, e).catch(() => {});
    return result;
  });

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e);
    if (state.host) void recordAgentMetadata(state, e, result).catch(() => {});
    return result;
  });

  on('session.end', ($, e, next) => {
    state.epoch += 1;
    state.open = false;
    state.initialized = false;
    state.sessionId = null;
    state.selected = null;
    stopPolling(state);
    state.usageTimer?.cancel();
    state.usageTimer = null;
    state.pendingUsage = null;
    return next(e);
  });
}
