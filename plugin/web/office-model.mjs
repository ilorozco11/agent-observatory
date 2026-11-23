/** Pure presentation model shared by the local office window and its tests. */
const PHASES = {
  model: ['Đang gọi model', 'desk'],
  processing: ['Đang xử lý', 'desk'],
  reading: ['Đang đọc / tìm kiếm', 'library'],
  editing: ['Đang sửa tệp', 'desk'],
  terminal: ['Chạy lệnh', 'terminal'],
  tool: ['Dùng tool', 'terminal'],
  delegating: ['Đang ủy quyền', 'meeting'],
  waiting: ['Chờ bạn', 'waiting'],
  idle: ['Tạm nghỉ', 'lounge'],
  completed: ['Đã kết thúc', 'lounge'],
  error: ['Có lỗi', 'waiting'],
  unknown: ['Chưa rõ', 'lounge'],
};
const ACTIVE_PHASES = new Set(['model', 'processing', 'reading', 'editing', 'terminal', 'tool', 'delegating']);
const STATUSES = new Set(['running', 'waiting', 'idle', 'completed', 'error', 'unknown']);
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value, fallback = '', max = 600) => typeof value === 'string' ? value.slice(0, max) : fallback;
const at = value => {
  if (value === null || value === undefined || value === '') return null;
  const valueMs = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(valueMs) ? valueMs : null;
};
const newest = list => [...list].sort((a, b) => (at(b.lastEventAt) ?? at(b.startedAt) ?? at(b.timestamp) ?? -Infinity) - (at(a.lastEventAt) ?? at(a.startedAt) ?? at(a.timestamp) ?? -Infinity))[0] || null;

export const officeKey = (sessionId, agentId) => JSON.stringify([sessionId, agentId]);

function uniqueTools(tools) {
  const found = new Map();
  for (const tool of Array.isArray(tools) ? tools : []) {
    if (!tool || typeof tool.id !== 'string') continue;
    const old = found.get(tool.id);
    const clock = value => at(value.endedAt) ?? at(value.startedAt) ?? -Infinity;
    // A completion beats a duplicate start even if they share a timestamp.
    if (!old || clock(tool) > clock(old) || clock(tool) === clock(old) && old.status === 'running' && tool.status !== 'running') found.set(tool.id, tool);
  }
  return [...found.values()];
}

function ownedTask(agent, session) {
  if (text(agent.task)) return { text: text(agent.task), id: null, source: 'agent' };
  const sameName = (session.agents || []).filter(item => item.name && item.name === agent.name).length;
  const tasks = (Array.isArray(session.tasks) ? session.tasks : []).filter(task =>
    task && task.status === 'in_progress' && (task.owner === agent.id || sameName === 1 && task.owner === agent.name));
  const task = tasks[0];
  return task ? { text: text(task.subject), id: text(task.id), source: 'owned_task' } : null;
}

function activityOf(agent) {
  const status = STATUSES.has(agent.status) ? agent.status : 'unknown';
  const tools = uniqueTools(agent.tools);
  const tool = newest(tools.filter(item => item.status === 'running' && !item.endedAt));
  const evidence = (kind, detail, timestamp = agent.lastEventAt) => ({ kind, detail, at: timestamp || null });
  const modelActive = agent.modelActivity?.active === true;
  const modelAt = at(agent.modelActivity?.startedAt) ?? -Infinity;
  const modelPhase = () => ({ phase: 'model', tool: null, activity: 'Yêu cầu model đang diễn ra',
    evidence: evidence('observed', 'Khoảng từ turn.step bắt đầu đến khi luồng phản hồi kết thúc; không phải nội dung suy nghĩ', agent.modelActivity.startedAt || agent.modelActivity.lastEventAt) });
  // A lifecycle ending or explicit wait always takes precedence over an orphan
  // start record for a tool/request whose terminal hook was never delivered.
  if (agent.endedAt || status === 'completed') {
    const phase = status === 'completed' ? 'completed' : status === 'error' ? 'error' : 'unknown';
    return { phase, tool: null, activity: phase === 'completed' ? 'Đã ghi nhận kết thúc vòng đời' : phase === 'error' ? 'Agent kết thúc với lỗi được ghi nhận' : 'Phiên đã kết thúc; kết quả agent chưa rõ', evidence: evidence('observed', 'Trạng thái vòng đời được runtime báo', agent.endedAt || agent.lastEventAt) };
  }
  if (status === 'waiting') {
    const wait = newest((agent.events || []).filter(event => event.type === 'waiting'));
    return { phase: 'waiting', tool, activity: text(wait?.detail, 'Chờ quyền hoặc phản hồi'), evidence: evidence('observed', 'Runtime báo đang chờ người dùng', wait?.timestamp || agent.lastEventAt) };
  }
  const lastStatusEvent = newest((agent.events || []).filter(event => event.status === status
    || status === 'idle' && event.type === 'turn.end' || status === 'error' && event.type === 'tool.error'));
  const statusAt = at(lastStatusEvent?.timestamp) ?? at(agent.startedAt) ?? -Infinity;
  // A later observed request may be an automatic retry or continuation. Show
  // that current phase without rewriting the stored lifecycle/error history.
  if (modelActive && modelAt > statusAt && (status === 'idle' || status === 'error')) return modelPhase();
  if (status === 'error') return { phase: 'error', tool: null, activity: 'Có lỗi được ghi nhận; xem lịch sử tool', evidence: evidence('observed', 'Lỗi được báo trong sự kiện runtime') };
  if (status === 'idle') return { phase: 'idle', tool: null, activity: 'Lượt hiện tại đã dừng; chờ công việc tiếp theo', evidence: evidence('observed', 'Đã ghi nhận kết thúc lượt hoặc trạng thái tạm nghỉ') };
  if (modelActive && (!tool || modelAt > (at(tool.startedAt) ?? -Infinity))) return modelPhase();
  if (tool) {
    const name = text(tool.name);
    const phase = /^(Read|Glob|Grep|LS|WebSearch|WebFetch)$/.test(name) ? 'reading'
      : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name) ? 'editing'
        : name === 'Bash' ? 'terminal'
          : /^(Agent|Task)$/.test(name) ? 'delegating'
            : name === 'AskUserQuestion' ? 'waiting' : 'tool';
    return { phase, tool: { id: tool.id, name, summary: text(tool.summary), startedAt: tool.startedAt || null },
      activity: text(tool.summary) || `${name || 'Tool'} đang chạy`,
      evidence: evidence('observed', `Đã ghi nhận bắt đầu ${name || 'tool'}; chưa có sự kiện kết thúc`, tool.startedAt) };
  }
  if (modelActive) return modelPhase();
  if (status === 'running') return { phase: 'processing', tool: null, activity: 'Lượt đang mở, chưa có tool hay yêu cầu model đang chạy được ghi nhận', evidence: evidence('inferred', 'Suy ra từ trạng thái đang chạy; không xác định agent đang nghĩ gì') };
  return { phase: 'unknown', tool: null, activity: 'Chưa đủ sự kiện để xác định hoạt động', evidence: evidence('unknown', 'Chưa có tín hiệu hoạt động phù hợp') };
}

function normalizeSessions(snapshot) {
  const sessions = new Map();
  for (const source of Array.isArray(snapshot?.sessions) ? snapshot.sessions : []) {
    if (!source || typeof source.id !== 'string') continue;
    let session = sessions.get(source.id);
    if (!session) {
      session = { ...source, agents: [], _agents: new Map() };
      sessions.set(source.id, session);
    } else if ((at(source.lastEventAt) ?? -Infinity) > (at(session.lastEventAt) ?? -Infinity)) {
      Object.assign(session, source, { agents: session.agents, _agents: session._agents });
    }
    for (const agent of Array.isArray(source.agents) ? source.agents : []) {
      if (!agent || typeof agent.id !== 'string') continue;
      const prior = session._agents.get(agent.id);
      if (!prior || (at(agent.lastEventAt) ?? -Infinity) > (at(prior.lastEventAt) ?? -Infinity)
        || at(agent.lastEventAt) === at(prior.lastEventAt) && agent.endedAt && !prior.endedAt) session._agents.set(agent.id, agent);
    }
  }
  return [...sessions.values()].map(session => ({ ...session, agents: [...session._agents.values()], _agents: undefined }));
}

/**
 * Derive a visual scene from snapshot facts. Movement is presentation only.
 * previousSlots retains stable actor order across SSE snapshots and filters.
 * The cap limits map density; overflow always remains an explicit actor list.
 */
export function deriveOffice(snapshot, options = {}) {
  const mode = snapshot?.source?.mode === 'demo' ? 'demo' : 'live';
  const now = at(options.now) ?? (mode === 'demo' ? at(snapshot?.generatedAt) : null) ?? Date.now();
  const connected = !!snapshot && options.connected !== false && snapshot?.source?.connected !== false;
  const threshold = Math.max(1, finite(snapshot?.source?.staleAfterMs) ?? 90000);
  const sessions = normalizeSessions(snapshot);
  const known = new Set(sessions.flatMap(session => session.agents.map(agent => officeKey(session.id, agent.id))));
  const slots = {};
  const used = new Set();
  const previous = options.previousSlots && typeof options.previousSlots === 'object' ? options.previousSlots : {};
  for (const key of [...known].sort()) {
    const slot = previous[key];
    if (Number.isSafeInteger(slot) && slot >= 0 && !used.has(slot)) { slots[key] = slot; used.add(slot); }
  }
  let next = 0;
  for (const key of [...known].sort()) if (!Object.hasOwn(slots, key)) {
    while (used.has(next)) next++;
    slots[key] = next; used.add(next);
  }
  const search = text(options.search).trim().toLocaleLowerCase('vi');
  const actors = [];
  for (const session of sessions) for (const agent of session.agents) {
    if (options.sessionId && session.id !== options.sessionId) continue;
    if (options.project && session.project !== options.project) continue;
    if (options.showCompleted === false && (agent.endedAt || agent.status === 'completed')) continue;
    const task = ownedTask(agent, session);
    const fact = activityOf(agent);
    const key = officeKey(session.id, agent.id);
    const status = STATUSES.has(agent.status) ? agent.status : 'unknown';
    const lastAt = at(agent.lastEventAt);
    const stale = !agent.endedAt && status !== 'completed' && lastAt !== null && now - lastAt > threshold;
    const [label, zone] = PHASES[fact.phase];
    const actor = {
      key, sessionId: session.id, agentId: agent.id,
      project: text(session.project, 'Unknown project'), name: text(agent.name, agent.id, 180), role: text(agent.type, 'agent', 100),
      status, phase: fact.phase, label, zone, activity: fact.activity, task: task?.text || null,
      taskId: task?.id || null, taskSource: task?.source || null, tool: fact.tool, evidence: fact.evidence,
      stale, animate: connected && !stale && ACTIVE_PHASES.has(fact.phase), connected,
      seat: slots[key], displaySeat: null, parentId: text(agent.parentId) || null,
      parentKey: typeof agent.parentId === 'string' && known.has(officeKey(session.id, agent.parentId)) ? officeKey(session.id, agent.parentId) : null,
      startedAt: agent.startedAt || null, lastEventAt: agent.lastEventAt || null, endedAt: agent.endedAt || null,
      toolCalls: finite(agent.toolCalls), errors: finite(agent.errors), model: text(agent.model) || null,
    };
    if (search && ![actor.name, actor.agentId, actor.project, actor.role, actor.task, actor.activity, actor.model].filter(Boolean).join(' ').toLocaleLowerCase('vi').includes(search)) continue;
    actors.push(actor);
  }
  // Surface work that needs the user and active work before archived agents.
  // Seats remain stable; only map inclusion/order changes with current phase.
  const priority = actor => actor.phase === 'waiting' || actor.phase === 'error' ? 0
    : ACTIVE_PHASES.has(actor.phase) ? 1 : actor.phase === 'completed' ? 3 : 2;
  actors.sort((a, b) => priority(a) - priority(b) || a.seat - b.seat || a.key.localeCompare(b.key));
  const capacity = Math.max(1, Math.min(100, Math.floor(finite(options.capacity) ?? 12)));
  const agents = actors.slice(0, capacity).map((agent, displaySeat) => ({ ...agent, displaySeat }));
  const overflow = actors.slice(capacity);
  const counts = { total: actors.length, visible: agents.length, overflow: overflow.length, running: 0, waiting: 0, error: 0, idle: 0, completed: 0, unknown: 0 };
  // These are office phase counts. actor.status still retains the unmodified
  // lifecycle value, including an older error while a new request is in flight.
  for (const actor of actors) counts[ACTIVE_PHASES.has(actor.phase) ? 'running' : actor.phase]++;
  return {
    agents, overflow, counts, slots,
    sessions: sessions.map(session => ({ id: session.id, project: text(session.project, 'Unknown project'), agentCount: session.agents.length })),
    source: {
      mode, connected, stale: actors.some(actor => actor.stale),
      latestEventAt: snapshot?.source?.latestEventAt || null,
      warnings: Array.isArray(snapshot?.source?.warnings) ? snapshot.source.warnings.filter(item => typeof item === 'string') : [],
    },
  };
}
