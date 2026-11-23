/**
 * Reduce normalized, privacy-filtered collector events into dashboard state.
 * No clock-based success/failure inference and no usage extrapolation.
 */

const EVENT_TYPES = new Set([
  'session.start', 'session.end', 'turn.start', 'turn.end',
  'agent.start', 'agent.end', 'agent.metadata', 'tool.start', 'tool.end', 'tool.error',
  'waiting', 'usage', 'task.update', 'model.start', 'model.end',
]);
const TOKEN_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'];
const TERMINAL_TOOL_STATES = new Set(['success', 'error', 'denied', 'cancelled']);
const ORDER = {
  'session.start': 0, 'turn.start': 1, 'agent.start': 2, 'agent.metadata': 2,
  'model.start': 3, 'tool.start': 3, waiting: 4, 'model.end': 5, 'tool.end': 5, 'tool.error': 5,
  'task.update': 6, usage: 7, 'agent.end': 8, 'turn.end': 9, 'session.end': 10,
};

function text(value, limit = 240) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, limit) || null;
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function time(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

function iso(value) {
  return new Date(value).toISOString();
}

function tokens(value) {
  return Object.fromEntries(TOKEN_KEYS.map(key => [key, number(value?.[key])]));
}

function limits(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map(limit => ({
    kind: text(limit?.kind, 80) || 'unknown',
    percentUsed: number(limit?.percentUsed),
    resetsAt: time(limit?.resetsAt) === null ? null : iso(time(limit.resetsAt)),
  }));
}

function agentRecord(id, event, at) {
  return {
    id, parentId: null, name: id === 'main' ? 'Coordinator' : `Agent ${id.slice(0, 10)}`,
    type: id === 'main' ? 'main' : 'unknown', task: null,
    status: 'unknown', startedAt: iso(at), lastEventAt: iso(at), endedAt: null,
    model: null, costUsd: null, costEstimated: null, costIncomplete: null, tokens: tokens(null),
    toolCalls: 0, errors: 0, files: [], tools: [], events: [], modelActivity: null,
    _tools: new Map(), _files: new Set(), _lastStatusAt: -Infinity,
    _modelRequests: new Map(), _modelBoundaryAt: -Infinity,
  };
}

function sessionRecord(id, event, at) {
  return {
    id, project: text(event.project, 160) || 'Unknown project',
    cwd: text(event.cwd, 400), status: 'unknown',
    startedAt: iso(at), lastEventAt: iso(at), endedAt: null,
    model: null, contextPercent: null, rateLimits: [], costUsd: null, costEstimated: null, costIncomplete: null,
    tokens: tokens(null), agents: [], tasks: [], events: [],
    _agents: new Map(), _tasks: new Map(), _endStatus: null,
  };
}

function ensureAgent(session, id, event, at, touch = true) {
  if (!session._agents.has(id)) session._agents.set(id, agentRecord(id, event, at));
  const agent = session._agents.get(id);
  if (touch && at < time(agent.startedAt)) agent.startedAt = iso(at);
  if (touch && at > time(agent.lastEventAt)) agent.lastEventAt = iso(at);
  return agent;
}

function setStatus(agent, status, at, { reopen = false } = {}) {
  if (at < agent._lastStatusAt) return;
  if (agent.endedAt && !reopen) return;
  if (reopen) agent.endedAt = null;
  agent.status = status;
  agent._lastStatusAt = at;
}

function updateIdentity(agent, event) {
  if (text(event.name)) agent.name = text(event.name);
  if (text(event.agentType, 100)) agent.type = text(event.agentType, 100);
  if (text(event.task, 600)) agent.task = text(event.task, 600);
  if (text(event.model, 120)) agent.model = text(event.model, 120);
  // A missing relationship is unknown. It must not silently become "main".
  if (typeof event.parentId === 'string' && event.parentId && event.parentId !== agent.id) {
    agent.parentId = text(event.parentId, 240);
  }
}

function eventView(event, agentId, at) {
  const titles = {
    'session.start': 'Session started', 'session.end': 'Session ended',
    'turn.start': 'Turn started', 'turn.end': 'Turn ended',
    'agent.start': 'Agent started', 'agent.end': 'Agent ended', 'agent.metadata': 'Agent details updated',
    'tool.start': `${text(event.toolName, 100) || 'Tool'} started`,
    'tool.end': `${text(event.toolName, 100) || 'Tool'} completed`,
    'tool.error': `${text(event.toolName, 100) || 'Tool'} ${event.status === 'cancelled' ? 'interrupted' : 'failed'}`,
    'model.start': 'Model request started', 'model.end': 'Model request ended',
    waiting: 'Waiting for input', usage: 'Usage reported',
    'task.update': 'Task updated',
  };
  const status = event.type === 'tool.error' ? (['denied', 'cancelled'].includes(event.status) ? event.status : 'error')
    : event.type === 'tool.end' ? (TERMINAL_TOOL_STATES.has(event.status) ? event.status : 'success')
      : event.type === 'waiting' ? 'waiting' : text(event.status, 40);
  return {
    id: event.id, type: event.type, timestamp: iso(at), agentId,
    title: text(event.title, 180) || titles[event.type],
    detail: text(event.summary || event.task || event.taskRecord?.subject, 600), status,
  };
}

function updateTool(agent, event, at) {
  const id = text(event.toolId, 240) || event.id;
  let tool = agent._tools.get(id);
  if (!tool) {
    tool = {
      id, name: text(event.toolName, 100) || 'Tool', status: 'running',
      startedAt: null, endedAt: null, durationMs: null,
      summary: text(event.summary, 400), _lastOutcomeAt: -Infinity,
    };
    agent._tools.set(id, tool);
  }
  if (text(event.toolName, 100)) tool.name = text(event.toolName, 100);
  if (text(event.summary, 400)) tool.summary = text(event.summary, 400);
  if (event.type === 'tool.start') {
    if (tool.startedAt === null || at < time(tool.startedAt)) tool.startedAt = iso(at);
    // A repeated PreToolUse must not resurrect an already finished call.
    if (!TERMINAL_TOOL_STATES.has(tool.status)) setStatus(agent, 'running', at);
  } else if (at >= tool._lastOutcomeAt) {
    tool.status = event.type === 'tool.error'
      ? (['denied', 'cancelled'].includes(event.status) ? event.status : 'error')
      : (TERMINAL_TOOL_STATES.has(event.status) ? event.status : 'success');
    tool.endedAt = iso(at);
    tool._lastOutcomeAt = at;
    const reportedDuration = number(event.durationMs);
    tool.durationMs = reportedDuration ?? (tool.startedAt ? Math.max(0, at - time(tool.startedAt)) : null);
    setStatus(agent, tool.status === 'success' ? 'running' : tool.status === 'cancelled' ? 'idle' : 'error', at);
  }
  if (tool.startedAt && tool.endedAt && tool.durationMs === null) {
    tool.durationMs = Math.max(0, time(tool.endedAt) - time(tool.startedAt));
  }
  if (text(event.file, 400)) agent._files.add(text(event.file, 400));
}

function applyUsage(target, event) {
  if (event.tokens && typeof event.tokens === 'object') target.tokens = tokens(event.tokens);
  if (Object.hasOwn(event, 'costUsd')) {
    target.costUsd = number(event.costUsd);
    target.costEstimated = target.costUsd === null ? null : event.costEstimated !== false;
    target.costIncomplete = target.costUsd === null ? null : event.costIncomplete === true;
  } else if (target.costUsd !== null) {
    if (typeof event.costEstimated === 'boolean') target.costEstimated = event.costEstimated;
    if (typeof event.costIncomplete === 'boolean') target.costIncomplete = event.costIncomplete;
  }
  if (text(event.model, 120)) target.model = text(event.model, 120);
}

function updateModelActivity(agent, event, at) {
  const id = text(event.requestId, 240);
  if (!id) return;
  let request = agent._modelRequests.get(id);
  if (!request) {
    request = { requestId: id, startedAt: null, endedAt: null, lastEventAt: iso(at), model: null };
    agent._modelRequests.set(id, request);
  }
  if (text(event.model, 120)) request.model = text(event.model, 120);
  request.lastEventAt = iso(Math.max(at, time(request.lastEventAt)));
  if (event.type === 'model.start') {
    if (request.startedAt === null || at < time(request.startedAt)) request.startedAt = iso(at);
  } else {
    request.endedAt = iso(Math.max(at, time(request.endedAt) ?? -Infinity));
  }
}

function modelActivityOf(agent) {
  const requests = [...agent._modelRequests.values()];
  if (!requests.length) return null;
  requests.sort((a, b) => time(b.lastEventAt) - time(a.lastEventAt) || a.requestId.localeCompare(b.requestId));
  const active = agent.endedAt ? [] : requests.filter(request => request.startedAt && !request.endedAt && time(request.startedAt) > agent._modelBoundaryAt);
  active.sort((a, b) => time(b.startedAt) - time(a.startedAt));
  const shown = active[0] || requests[0];
  return { ...shown, active: active.length > 0, activeCount: active.length };
}

/**
 * Usage events are snapshots, not increments. Use scope:'session' (or omit
 * agentId) for inclusive session totals; use scope:'agent' for agent totals.
 */
export function reduceEvents(input, options = {}) {
  const now = time(options.now ?? Date.now()) ?? Date.now();
  const maxEvents = Math.max(1, Math.floor(number(options.maxEvents) ?? 240));
  const maxTools = Math.max(1, Math.floor(number(options.maxTools) ?? 120));
  const maxSessions = Math.max(1, Math.floor(number(options.maxSessions) ?? 50));
  const warnings = Array.isArray(options.warnings) ? options.warnings.map(x => text(x, 240)).filter(Boolean) : [];
  const sessions = new Map();
  const seen = new Set();
  const accepted = [];
  let skipped = 0;
  for (const event of Array.isArray(input) ? input : []) {
    const at = time(event?.timestamp);
    const sessionId = text(event?.sessionId, 240);
    if (!event || !EVENT_TYPES.has(event.type) || !sessionId || at === null
      || (event.type === 'model.start' || event.type === 'model.end') && !text(event.requestId, 240)) {
      skipped += 1;
      continue;
    }
    const id = text(event.id, 500) || [sessionId, event.type, event.timestamp, event.agentId || '', event.toolId || '', event.requestId || '', event.taskRecord?.id || ''].join(':');
    const dedupKey = `${sessionId}\u0000${id}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    accepted.push({ ...event, id, sessionId, at });
  }
  accepted.sort((a, b) => a.at - b.at || ORDER[a.type] - ORDER[b.type] || a.id.localeCompare(b.id));

  for (const event of accepted) {
    const at = event.at;
    if (!sessions.has(event.sessionId)) sessions.set(event.sessionId, sessionRecord(event.sessionId, event, at));
    const session = sessions.get(event.sessionId);
    if (text(event.project, 160)) session.project = text(event.project, 160);
    if (text(event.cwd, 400)) session.cwd = text(event.cwd, 400);
    if (event.type !== 'agent.metadata') session.lastEventAt = iso(Math.max(at, time(session.lastEventAt)));
    const isSessionUsage = event.type === 'usage' && (event.scope === 'session' || !event.agentId);
    const agentId = text(event.agentId, 240) || 'main';
    const agent = isSessionUsage ? null : ensureAgent(session, agentId, event, at, event.type !== 'agent.metadata');
    if (agent) updateIdentity(agent, event);
    const view = eventView(event, isSessionUsage ? null : agentId, at);
    session.events.push(view);
    if (agent) agent.events.push(view);

    switch (event.type) {
      case 'session.start': {
        const main = ensureAgent(session, 'main', event, at);
        updateIdentity(main, { ...event, agentType: 'main' });
        setStatus(main, 'idle', at, { reopen: true });
        session.endedAt = null;
        session._endStatus = null;
        if (text(event.model, 120)) session.model = text(event.model, 120);
        break;
      }
      case 'session.end':
        session.endedAt = iso(at);
        session._endStatus = event.status === 'error' ? 'error' : 'completed';
        for (const item of session._agents.values()) {
          if (item.endedAt) continue;
          item.status = item.id === 'main' ? session._endStatus : 'unknown';
          item.endedAt = iso(at);
          item._lastStatusAt = at;
          item._modelBoundaryAt = Math.max(item._modelBoundaryAt, at);
        }
        break;
      case 'turn.start':
        setStatus(agent, 'running', at, { reopen: true });
        if (agentId === 'main') { session.endedAt = null; session._endStatus = null; }
        break;
      case 'turn.end':
        setStatus(agent, event.status === 'error' ? 'error' : 'idle', at);
        agent._modelBoundaryAt = Math.max(agent._modelBoundaryAt, at);
        break;
      case 'agent.start':
        setStatus(agent, 'running', at, { reopen: true });
        break;
      case 'agent.metadata':
        // Identity enrichment is not new agent work and never resumes an agent.
        break;
      case 'agent.end':
        if (at >= agent._lastStatusAt) {
          agent.status = event.status === 'error' ? 'error' : 'completed';
          agent.endedAt = iso(at);
          agent._lastStatusAt = at;
          agent._modelBoundaryAt = Math.max(agent._modelBoundaryAt, at);
        }
        break;
      case 'tool.start':
      case 'tool.end':
      case 'tool.error':
        updateTool(agent, event, at);
        break;
      case 'waiting':
        setStatus(agent, 'waiting', at);
        break;
      case 'model.start':
      case 'model.end':
        // Model request evidence is independent of lifecycle status. Late writes
        // must not reopen an ended agent or turn an interrupted turn into work.
        updateModelActivity(agent, event, at);
        break;
      case 'usage': {
        const target = isSessionUsage ? session : agent;
        applyUsage(target, event);
        if (isSessionUsage) {
          if (Object.hasOwn(event, 'contextPercent')) session.contextPercent = number(event.contextPercent);
          if (Object.hasOwn(event, 'rateLimits')) session.rateLimits = limits(event.rateLimits);
        }
        break;
      }
      case 'task.update': {
        const task = event.taskRecord;
        const id = text(task?.id, 120);
        if (!id) break;
        const old = session._tasks.get(id) || { id, subject: `Task ${id}`, status: 'pending', owner: null, blockedBy: [] };
        session._tasks.set(id, {
          id,
          subject: text(task.subject, 400) || old.subject,
          status: ['pending', 'in_progress', 'completed', 'deleted'].includes(task.status) ? task.status : old.status,
          owner: Object.hasOwn(task, 'owner') ? text(task.owner, 120) : old.owner,
          blockedBy: [...new Set([
            ...(Array.isArray(task.blockedBy) ? task.blockedBy : old.blockedBy),
            ...(Array.isArray(task.addBlockedBy) ? task.addBlockedBy : []),
          ].map(x => text(String(x), 120)).filter(Boolean))].slice(0, 50),
        });
        break;
      }
    }
  }

  const result = [...sessions.values()].map(session => {
    const agents = [...session._agents.values()].map(agent => {
      const tools = [...agent._tools.values()];
      const clean = { ...agent };
      delete clean._tools; delete clean._files; delete clean._lastStatusAt;
      clean.modelActivity = modelActivityOf(agent);
      delete clean._modelRequests; delete clean._modelBoundaryAt;
      clean.toolCalls = tools.length;
      clean.errors = tools.filter(tool => tool.status === 'error' || tool.status === 'denied').length;
      clean.tools = tools.sort((a, b) => (time(b.startedAt) ?? time(b.endedAt)) - (time(a.startedAt) ?? time(a.endedAt)))
        .slice(0, maxTools).map(({ _lastOutcomeAt, ...tool }) => tool);
      clean.files = [...agent._files].slice(-200);
      clean.events = agent.events.slice(-maxEvents).reverse();
      return clean;
    }).sort((a, b) => (a.id === 'main' ? -1 : b.id === 'main' ? 1 : time(a.startedAt) - time(b.startedAt) || a.id.localeCompare(b.id)));
    const states = agents.filter(agent => !agent.endedAt).map(agent => agent.status);
    const status = session._endStatus || (states.includes('waiting') ? 'waiting'
      : states.includes('running') ? 'running'
        : states.includes('error') ? 'error'
          : states.includes('idle') ? 'idle' : 'unknown');
    const clean = { ...session, status, agents,
      tasks: [...session._tasks.values()].filter(task => task.status !== 'deleted'),
      events: session.events.slice(-maxEvents).reverse(),
    };
    delete clean._agents; delete clean._tasks; delete clean._endStatus;
    return clean;
  }).sort((a, b) => time(b.lastEventAt) - time(a.lastEventAt)).slice(0, maxSessions);

  if (skipped) warnings.push(`${skipped} invalid or unsupported event(s) skipped.`);
  if (sessions.size > maxSessions) warnings.push(`Showing the ${maxSessions} most recently active sessions.`);
  return {
    schemaVersion: 1, generatedAt: iso(now),
    source: {
      mode: options.mode === 'demo' ? 'demo' : 'live',
      connected: options.connected !== false,
      latestEventAt: accepted.length ? iso(accepted.at(-1).at) : null,
      staleAfterMs: number(options.staleAfterMs) ?? 90_000,
      warnings: [...new Set(warnings)].slice(0, 20),
    },
    sessions: result,
  };
}
