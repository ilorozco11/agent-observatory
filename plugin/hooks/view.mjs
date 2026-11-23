// Pure presentation; no model calls, tool dispatch, filesystem access, or agent control.
// Element factories come from Claude Code's $.ui.resolve(e).

export const STATUS_LABELS = {
  running: 'Đang làm', waiting: 'Cần bạn', idle: 'Đang nghỉ',
  completed: 'Đã kết thúc', error: 'Có lỗi', unknown: 'Chưa rõ',
};
const STATUS_MARKS = { running: '●', waiting: '!', idle: '○', completed: '✓', error: '×', unknown: '?' };

export function textValue(value, fallback = '—') {
  return typeof value === 'string' && value.length ? value : fallback;
}

export function numberText(value, digits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const [integer, decimal] = String(Math.round(value * 10 ** digits) / 10 ** digits).split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decimal ? `.${decimal}` : '');
}

export function ageText(timestamp, now) {
  const time = Date.parse(timestamp ?? '');
  if (!Number.isFinite(time)) return 'chưa có mốc';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}

export function statusText(status) {
  return `${STATUS_MARKS[status] ?? '?'} ${STATUS_LABELS[status] ?? 'Chưa rõ'}`;
}

export function snapshotOf(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || !Array.isArray(value.sessions)) return null;
  if (!value.sessions.every(session => session && typeof session.id === 'string' && Array.isArray(session.agents))) return null;
  for (const session of value.sessions) {
    if (!session.agents.every(agent => agent && typeof agent.id === 'string' && Array.isArray(agent.tools) && Array.isArray(agent.events))) return null;
  }
  return value;
}

export function scopedSessions(state) {
  const sessions = state.snapshot?.sessions ?? [];
  return state.scope === 'all' ? sessions : sessions.filter(session => session.id === state.sessionId);
}

// Preserve only relationships reported in data. Orphans and cycles remain visible.
export function agentRows(sessions, attentionOnly = false) {
  const rows = [];
  for (const session of sessions) {
    const byId = new Map(session.agents.map(agent => [agent.id, agent]));
    const seen = new Set();
    const walk = (agent, depth) => {
      if (seen.has(agent.id)) return;
      seen.add(agent.id);
      if (!attentionOnly || agent.status === 'waiting' || agent.status === 'error') rows.push({ session, agent, depth });
      for (const child of session.agents) if (child.parentId === agent.id) walk(child, depth + 1);
    };
    for (const agent of session.agents) if (!agent.parentId || !byId.has(agent.parentId) || agent.parentId === agent.id) walk(agent, 0);
    for (const agent of session.agents) if (!seen.has(agent.id)) walk(agent, 0);
  }
  return rows;
}

function keyOf(row) { return `${row.session.id}:${row.agent.id}`; }

function sessionSummary(ui, sessions, state) {
  const { Box, Text } = ui;
  const agents = sessions.flatMap(session => session.agents);
  const active = agents.filter(agent => agent.status === 'running').length;
  const attention = agents.filter(agent => agent.status === 'waiting' || agent.status === 'error').length;
  const children = [
    Text({ bold: true, children: `${sessions.length} phiên · ${agents.length} agent` }),
    Text({ children: `${active} đang làm  /  ${attention} cần chú ý` }),
    Text({ dimColor: true, children: state.scope === 'all' ? 'Phạm vi: các phiên được collector ghi nhận' : 'Phạm vi: phiên Claude Code này' }),
  ];
  for (const session of sessions.slice(0, 3)) {
    children.push(Text({ children: `${textValue(session.project)} · context ${typeof session.contextPercent === 'number' ? `${numberText(session.contextPercent, 1)}%` : '—'} · chi phí ước tính ${typeof session.costUsd === 'number' ? `$${numberText(session.costUsd, 4)}` : '—'}` }));
    const limits = Array.isArray(session.rateLimits) ? session.rateLimits : [];
    for (const limit of limits.slice(0, 3)) children.push(Text({ dimColor: true, children: `Quota ${textValue(limit.kind)}: ${numberText(limit.percentUsed, 1)}% đã dùng${typeof limit.resetsAt === 'string' ? ` · reset ${limit.resetsAt}` : ''}` }));
  }
  if (sessions.length > 3) children.push(Text({ dimColor: true, children: `Chi tiết usage của ${sessions.length - 3} phiên khác trong dashboard web.` }));
  if (sessions.some(session => typeof session.costUsd === 'number')) children.push(Text({ dimColor: true, children: 'Chi phí do runtime ước tính; không phải hóa đơn.' }));
  return Box({ key: 'summary', flexDirection: 'column', marginBottom: 1, children });
}

function agentDetail(ui, row, state) {
  const { Box, Text } = ui;
  const { agent, session } = row;
  const end = agent.endedAt ? Date.parse(agent.endedAt) : state.now;
  const elapsed = ageText(agent.startedAt, end);
  const token = agent.tokens ?? {};
  const detail = [
    Text({ bold: true, children: textValue(agent.name, agent.id) }),
    Text({ children: `Agent: ${agent.id}` }),
    Text({ children: `Project: ${textValue(session.project)} · ${statusText(agent.status)}` }),
    Text({ children: `Model: ${textValue(agent.model)} · thời gian ${elapsed}` }),
    Text({ children: `Tool calls: ${numberText(agent.toolCalls)} · lỗi ghi nhận: ${numberText(agent.errors)}` }),
    Text({ children: `Tokens in / out: ${numberText(token.input)} / ${numberText(token.output)}` }),
    Text({ children: `Cache read / write: ${numberText(token.cacheRead)} / ${numberText(token.cacheWrite)}` }),
    Text({ children: `Chi phí ước tính: ${typeof agent.costUsd === 'number' ? `$${numberText(agent.costUsd, 4)}` : '—'}` }),
  ];
  if (agent.task) detail.push(Text({ children: `Công việc: ${agent.task}` }));
  if (agent.parentId) detail.push(Text({ children: `Parent: ${agent.parentId}` }));
  if (agent.type !== 'main' && !agent.parentId) detail.push(Text({ dimColor: true, children: 'Chưa ghi nhận liên kết parent.' }));
  if (agent.status === 'completed') detail.push(Text({ dimColor: true, children: 'Kết thúc vòng đời agent; không đồng nghĩa kiểm thử PASS.' }));
  if (Array.isArray(agent.files) && agent.files.length) {
    detail.push(Text({ bold: true, children: 'File đã chạm' }));
    detail.push(...agent.files.slice(-8).map(file => Text({ children: textValue(typeof file === 'string' ? file : file.path) })));
    if (agent.files.length > 8) detail.push(Text({ dimColor: true, children: `+${agent.files.length - 8} file trong dashboard web` }));
  }
  detail.push(Text({ bold: true, children: 'Tool gần nhất' }));
  // /api/state exposes tools newest-first, as produced by the shared reducer.
  const tools = agent.tools.slice(0, 5);
  if (!tools.length) detail.push(Text({ dimColor: true, children: 'Chưa ghi nhận tool call.' }));
  for (const tool of tools) {
    detail.push(Text({ children: `${textValue(tool.name)} · ${textValue(tool.status)} · ${typeof tool.durationMs === 'number' ? `${numberText(tool.durationMs)} ms` : '—'}` }));
    if (tool.summary) detail.push(Text({ dimColor: true, children: tool.summary }));
  }
  return Box({ key: 'agent-detail', flexDirection: 'column', borderStyle: 'single', padding: 1, marginTop: 1, children: detail });
}

function agentView(ui, sessions, state, actions) {
  const { Box, Text, Button } = ui;
  const rows = agentRows(sessions, state.attentionOnly);
  const children = [Button({ key: 'attention', plain: true, label: state.attentionOnly ? '✓ Chỉ cần chú ý' : 'Chỉ cần chú ý', onPress: actions.toggleAttention })];
  if (!rows.length) children.push(Text({ children: state.attentionOnly ? 'Không có agent đang chờ hoặc có lỗi trong phạm vi này.' : 'Chưa có agent được ghi nhận. Mở dashboard web để xem hướng dẫn kết nối.' }));
  for (const row of rows.slice(0, state.limit)) {
    const { agent, session } = row;
    children.push(Box({ key: `row-${keyOf(row)}`, flexDirection: 'column', paddingLeft: Math.min(row.depth, 4) * 2, marginTop: 1, children: [
      Button({ key: `select-${keyOf(row)}`, plain: true, label: `${state.selected === keyOf(row) ? '▸ ' : ''}${textValue(agent.name, agent.id)} · ${statusText(agent.status)}`, onPress: () => actions.select(keyOf(row)) }),
      Text({ dimColor: true, children: `${textValue(session.project)} · ${numberText(agent.toolCalls)} tools · ${ageText(agent.lastEventAt, state.now)} từ event cuối` }),
    ] }));
  }
  if (rows.length > state.limit) children.push(Button({ key: 'more-agents', label: `Xem thêm (${rows.length - state.limit})`, onPress: actions.showMore }));
  const selected = rows.find(row => keyOf(row) === state.selected);
  if (selected) children.push(agentDetail(ui, selected, state));
  return Box({ key: 'agents', flexDirection: 'column', children });
}

function eventsView(ui, sessions, state) {
  const { Box, Text } = ui;
  const events = [];
  for (const session of sessions) {
    for (const event of session.events ?? []) events.push({ event, session });
    // Collector exposes session.events as the chronological source. Use agent events
    // only for snapshots that have no session-level event list, avoiding duplicates.
    if (!session.events?.length) for (const agent of session.agents) for (const event of agent.events) events.push({ event, session });
  }
  const selected = state.selected;
  const filtered = events.filter(row => !selected || `${row.session.id}:${row.event.agentId}` === selected);
  filtered.sort((a, b) => Date.parse(b.event.timestamp) - Date.parse(a.event.timestamp));
  const children = [Text({ dimColor: true, children: selected ? 'Hoạt động của agent đang chọn' : 'Hoạt động trong phạm vi đã chọn' })];
  if (!filtered.length) children.push(Text({ children: 'Chưa có hoạt động trong phạm vi này.' }));
  for (const { event, session } of filtered.slice(0, state.limit)) {
    children.push(Box({ key: `event-${session.id}-${event.id}`, flexDirection: 'column', marginTop: 1, children: [
      Text({ bold: true, children: textValue(event.title, event.type) }),
      Text({ dimColor: true, children: `${textValue(session.project)} · ${ageText(event.timestamp, state.now)} trước · ${textValue(event.agentId)}` }),
      ...(event.detail ? [Text({ children: event.detail })] : []),
    ] }));
  }
  if (filtered.length > state.limit) children.push(Text({ dimColor: true, children: `Hiển thị ${state.limit}/${filtered.length}; dashboard web có đầy đủ bộ lọc.` }));
  return Box({ key: 'events', flexDirection: 'column', children });
}

function tasksView(ui, sessions) {
  const { Box, Text } = ui;
  const children = [];
  for (const session of sessions) {
    const tasks = session.tasks ?? [];
    if (!tasks.length) continue;
    children.push(Text({ bold: true, children: textValue(session.project) }));
    const completed = tasks.filter(task => task.status === 'completed').length;
    children.push(Text({ dimColor: true, children: `${completed}/${tasks.length} task đã hoàn thành · số liệu task, không phải % agent` }));
    for (const task of tasks.slice(0, 40)) {
      const status = task.status === 'completed' ? '✓' : task.status === 'in_progress' ? '●' : '○';
      children.push(Box({ key: `task-${session.id}-${task.id}`, flexDirection: 'column', marginTop: 1, children: [
        Text({ children: `${status} ${textValue(task.subject, task.id)}` }),
        Text({ dimColor: true, children: `${textValue(task.status)} · owner ${textValue(task.owner)}` }),
        ...(task.blockedBy?.length ? [Text({ children: `Phụ thuộc: ${task.blockedBy.join(', ')}` })] : []),
      ] }));
    }
    if (tasks.length > 40) children.push(Text({ dimColor: true, children: `+${tasks.length - 40} task trong dashboard web` }));
  }
  if (!children.length) children.push(Text({ children: 'Chưa ghi nhận TaskCreate/TaskUpdate trong phạm vi này.' }));
  return Box({ key: 'tasks', flexDirection: 'column', children });
}

export function renderBoard(ui, state, actions) {
  const { Box, Text, Button, Link } = ui;
  const sessions = scopedSessions(state);
  const freshness = state.error ? 'MẤT KẾT NỐI' : state.loading ? 'ĐANG CẬP NHẬT' : state.snapshot ? 'ĐÃ KẾT NỐI' : 'CHƯA CÓ DỮ LIỆU';
  const children = [
    Text({ bold: true, children: 'AGENT OBSERVATORY' }),
    Text({ dimColor: true, children: `${freshness} · làm mới mỗi 2 giây khi pane mở` }),
    Box({ flexDirection: 'row', columnGap: 1, marginTop: 1, children: [
      Button({ key: 'refresh', label: 'Làm mới', hotkey: 'r', onPress: actions.refresh }),
      Button({ key: 'scope', label: state.scope === 'all' ? 'Mọi phiên' : 'Phiên này', onPress: actions.toggleScope }),
      Button({ key: 'close', label: 'Đóng', role: 'dismiss', onPress: actions.close }),
    ] }),
  ];
  if (state.error) children.push(Text({ children: `${state.error}${state.snapshot ? ' · giữ lại bản đọc thành công gần nhất.' : ''}` }));
  if (state.lastFetchedAt) children.push(Text({ dimColor: true, children: `Đọc thành công: ${ageText(state.lastFetchedAt, state.now)} trước` }));
  if (state.snapshot?.source?.latestEventAt) children.push(Text({ dimColor: true, children: `Event mới nhất: ${ageText(state.snapshot.source.latestEventAt, state.now)} trước` }));
  if (state.snapshot?.source?.mode === 'demo') children.push(Text({ bold: true, children: 'DỮ LIỆU MẪU · không phải agent đang làm việc thật' }));
  for (const warning of (state.snapshot?.source?.warnings ?? []).slice(0, 3)) children.push(Text({ children: String(warning) }));
  children.push(Box({ marginTop: 1, children: [Link ? Link({ href: state.baseUrl, label: 'Mở dashboard web' }) : Text({ children: state.baseUrl })] }));
  children.push(sessionSummary(ui, sessions, state));
  children.push(Box({ key: 'tabs', flexDirection: 'row', columnGap: 1, children: [
    ...[['agents', 'Agents', '1'], ['events', 'Hoạt động', '2'], ['tasks', 'Tasks', '3']].map(([tab, label, hotkey]) => Button({ key: `tab-${tab}`, label: `${state.tab === tab ? '✓ ' : ''}${label}`, hotkey, plain: true, onPress: () => actions.tab(tab) })),
  ] }));
  if (state.selected) children.push(Button({ key: 'clear-selection', plain: true, label: 'Bỏ chọn agent', onPress: actions.clearSelection }));
  children.push(state.tab === 'events' ? eventsView(ui, sessions, state) : state.tab === 'tasks' ? tasksView(ui, sessions) : agentView(ui, sessions, state, actions));
  children.push(Text({ dimColor: true, children: 'Chỉ quan sát. “—” nghĩa runtime chưa cung cấp số liệu.' }));
  return Box({ key: 'agent-observatory', flexDirection: 'column', padding: 1, rowGap: 1, children });
}
