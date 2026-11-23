/* Agent Observatory browser UI. No external assets or application dependencies. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ICONS = {
    overview: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
    timeline: ['M4 3v18', 'M8 6h12', 'M8 12h8', 'M12 18h8'],
    activity: ['M3 12h4l3-8 4 16 3-8h4'],
    lock: ['M6 10h12v11H6z', 'M8 10V7a4 4 0 0 1 8 0v3'],
    moon: ['M20 15a8 8 0 0 1-11-11A9 9 0 1 0 20 15z'],
    sun: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5'],
    pause: ['M8 5v14M16 5v14'],
    play: ['M8 4l12 8-12 8z'],
    refresh: ['M20 7v5h-5', 'M20 12a8 8 0 1 0-2 5', 'M20 7v5'],
    search: ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'M16 16l5 5'],
    tool: ['M14 5a6 6 0 0 0-7 8l-5 5 4 4 5-5a6 6 0 0 0 8-7l-4 4-5-5z'],
    layers: ['M12 2l10 6-10 6L2 8z', 'M2 12l10 6 10-6', 'M2 16l10 6 10-6'],
    info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M12 10v7', 'M12 6v1'],
    warning: ['M12 3 2 21h20z', 'M12 9v5', 'M12 17v1'],
    folder: ['M3 6h7l2 3h9v12H3z', 'M3 6V3h6l3 3h8v3'],
    file: ['M5 2h9l5 5v15H5z', 'M14 2v6h5', 'M8 12h8M8 16h6'],
    cursor: ['M4 3l17 10-8 2-3 7z'],
    arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
    radar: ['M12 3a9 9 0 1 0 9 9', 'M12 7a5 5 0 1 0 5 5', 'M12 12l8-8'],
    copy: ['M8 8h13v13H8z', 'M16 8V3H3v13h5']
  };
  const statusLabels = { running: 'Đang làm', waiting: 'Chờ bạn', idle: 'Tạm nghỉ', completed: 'Đã kết thúc', error: 'Có lỗi', unknown: 'Chưa rõ' };
  const statusMarks = { running: '●', waiting: '◐', idle: '○', completed: '✓', error: '!', unknown: '—' };
  const viewNames = {
    overview: ['Tổng quan agents', 'Mỗi agent, mỗi bước làm việc. Trong cùng một góc nhìn.'],
    timeline: ['Dòng thời gian', 'Nhìn cách agents phối hợp và các tool diễn ra song song.'],
    activity: ['Luồng hoạt động', 'Theo dấu từng sự kiện để hiểu công việc vừa diễn ra.']
  };
  const params = new URLSearchParams(location.search);
  const state = {
    snapshot: null, pending: null, view: 'overview', selected: null, inspectorTab: 'overview',
    filters: { search: '', project: '', session: '', status: '' },
    paused: false, connected: false, streamOpen: false, error: null, loading: false,
    lastFetch: null, source: null, request: 0, static: Boolean(window.__AGENT_OBSERVATORY_SNAPSHOT__),
    demo: params.get('demo') === '1', optionSignature: '',
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function icon(name) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'square', 'stroke-linejoin': 'miter', 'aria-hidden': 'true' })) node.setAttribute(k, v);
    for (const d of ICONS[name] || ICONS.info) {
      const path = document.createElementNS(node.namespaceURI, 'path');
      path.setAttribute('d', d); node.append(path);
    }
    return node;
  }
  function hydrateIcons(root = document) {
    for (const holder of root.querySelectorAll('[data-icon]')) holder.replaceChildren(icon(holder.dataset.icon));
  }
  function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
  function ms(v) { const n = Date.parse(v); return Number.isFinite(n) ? n : null; }
  function numeric(v) { return num(v) === null ? '—' : new Intl.NumberFormat('vi-VN').format(v); }
  function shortNum(v) { return num(v) === null ? '—' : v >= 1000 ? `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(v / 1000)}k` : numeric(v); }
  function statusOf(v) { return Object.hasOwn(statusLabels, v) ? v : 'unknown'; }
  function now() { return state.demo || state.static ? ms(state.snapshot?.generatedAt) ?? Date.now() : Date.now(); }
  function duration(start, end) {
    const a = ms(start), b = ms(end) ?? now();
    if (a === null || b < a) return '—';
    const secs = Math.floor((b - a) / 1000);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  }
  function relative(timestamp) {
    const t = ms(timestamp); if (t === null) return 'Chưa có dữ liệu';
    const sec = Math.max(0, Math.floor((now() - t) / 1000));
    if (sec < 10) return 'Vừa cập nhật';
    if (sec < 60) return `${sec} giây trước`;
    if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
    return `${Math.floor(sec / 3600)} giờ trước`;
  }
  function clock(timestamp, seconds = false) {
    const t = ms(timestamp); if (t === null) return '—';
    return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }).format(t);
  }
  function fullDate(timestamp) {
    const t = ms(timestamp); if (t === null) return 'Chưa có dữ liệu';
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'medium' }).format(t);
  }
  function key(session, agent) { return `${session.id}::${agent.id}`; }
  function initials(agent) {
    if (agent.type === 'main') return 'M';
    return (agent.name || agent.type || 'A').split(/[\s_/-]+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  }
  function modelLabel(model) { return model ? String(model).replace(/^claude-/, '').replace(/-20\d{6}$/, '') : 'Model chưa được báo'; }
  function badge(status) {
    const value = statusOf(status);
    const node = el('span', `status status-${value}`);
    const mark = el('span', 'status-marker', statusMarks[value]); mark.setAttribute('aria-hidden', 'true');
    node.append(mark, el('span', '', statusLabels[value])); return node;
  }
  function toolStatus(status) {
    const labels = { running: 'Đang chạy', success: 'Thành công', error: 'Có lỗi', denied: 'Bị từ chối', cancelled: 'Đã ngắt', completed: 'Đã xong' };
    return labels[status] || 'Chưa rõ';
  }
  function costLabel(record) {
    if (num(record?.costUsd) === null) return '—';
    const value = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(record.costUsd);
    return `${record.costEstimated !== false ? '≈ ' : ''}${value}${record.costIncomplete ? ' · chưa đủ giá' : ''}`;
  }
  function announce(message) { $('announcement').textContent = message; }
  function sessions() { return Array.isArray(state.snapshot?.sessions) ? state.snapshot.sessions : []; }
  function allRows() { return sessions().flatMap(session => (Array.isArray(session.agents) ? session.agents : []).map(agent => ({ session, agent, key: key(session, agent) }))); }
  function filteredRows() {
    const f = state.filters, query = f.search.trim().toLocaleLowerCase('vi');
    return allRows().filter(({ session, agent }) => (!f.project || session.project === f.project)
      && (!f.session || session.id === f.session)
      && (!f.status || statusOf(agent.status) === f.status)
      && (!query || [agent.name, agent.type, agent.task, agent.model, session.project, agent.id].filter(Boolean).join(' ').toLocaleLowerCase('vi').includes(query)));
  }
  function hasFilters() { return Object.values(state.filters).some(Boolean); }

  function preserveFocus(render) {
    const active = document.activeElement;
    const focusKey = active?.dataset.focusKey;
    const scroll = $('inspector-content').querySelector('.inspector-body')?.scrollTop || 0;
    render();
    const body = $('inspector-content').querySelector('.inspector-body');
    if (body) body.scrollTop = scroll;
    if (focusKey) {
      const target = [...document.querySelectorAll('[data-focus-key]')].find(n => n.dataset.focusKey === focusKey);
      if (target) target.focus({ preventScroll: true });
    }
  }
  function updateOptions() {
    const ss = sessions();
    const signature = ss.map(s => `${s.id}|${s.project}`).sort().join(';');
    if (signature === state.optionSignature) return;
    state.optionSignature = signature;
    const projects = [...new Set(ss.map(s => s.project).filter(Boolean))].sort();
    const project = $('project-filter'), session = $('session-filter');
    project.replaceChildren(new Option('Tất cả dự án', ''));
    projects.forEach(p => project.add(new Option(p, p)));
    session.replaceChildren(new Option('Tất cả phiên', ''));
    ss.forEach(s => session.add(new Option(`${s.project || 'Dự án'} · ${String(s.id).slice(0, 8)}`, s.id)));
    if (!projects.includes(state.filters.project)) state.filters.project = '';
    if (!ss.some(s => s.id === state.filters.session)) state.filters.session = '';
    project.value = state.filters.project; session.value = state.filters.session;
  }
  function updateConnection() {
    const info = state.snapshot?.source || {};
    const isDemo = state.demo || info.mode === 'demo';
    $('demo-notice').hidden = !isDemo;
    $('paused-notice').hidden = !state.paused;
    const hasActive = allRows().some(r => ['running', 'waiting'].includes(r.agent.status));
    const latest = ms(info.latestEventAt);
    const stale = latest !== null && now() - latest > (num(info.staleAfterMs) ?? 90000) && hasActive;
    let label = 'Đang kết nối', cls = '';
    if (isDemo) label = 'Bản xem thử · dữ liệu mẫu';
    else if (state.paused) label = 'Đã tạm dừng cập nhật';
    else if (state.error || info.connected === false) { label = 'Mất kết nối'; cls = 'is-offline'; }
    else if (stale) { label = 'Chưa có sự kiện mới'; cls = 'is-stale'; }
    else if (state.connected) { label = state.streamOpen ? 'Trực tiếp · trên máy này' : 'Đã nhận dữ liệu'; cls = 'is-live'; }
    $('connection-label').textContent = label;
    $('connection-status').className = `freshness ${cls}`;
    const warnings = Array.isArray(info.warnings) ? info.warnings : [];
    const message = state.error ? (state.snapshot ? 'Kết nối bị gián đoạn. Đang giữ bản dữ liệu cuối cùng; dữ liệu có thể đã cũ.' : 'Chưa kết nối được bộ thu thập. Hãy chạy server Agent Observatory, sau đó thử lại.')
      : info.connected === false ? 'Bộ thu thập báo chưa kết nối. Dữ liệu hiển thị có thể chưa đầy đủ.'
      : stale ? 'Một số agent còn mở nhưng chưa có sự kiện mới. Kiểm tra phiên Claude Code để xác nhận; không suy ra agent đã lỗi.'
      : warnings.length ? String(warnings[0]) : '';
    $('connection-notice').hidden = !message;
    $('connection-message').textContent = message;
    $('retry-button').hidden = !state.error && info.connected !== false;
    $('updated-at').textContent = state.snapshot ? `Bản dữ liệu: ${fullDate(state.snapshot.generatedAt)}${state.paused ? ' · đang giữ nguyên' : ''}` : 'Chưa có bản cập nhật';
  }
  function renderMetrics(rows) {
    if (!state.snapshot) return;
    const running = rows.filter(r => r.agent.status === 'running').length;
    const waiting = rows.filter(r => r.agent.status === 'waiting').length;
    const errors = rows.filter(r => r.agent.status === 'error').length;
    const toolCounts = rows.map(r => num(r.agent.toolCalls));
    const toolsKnown = toolCounts.every(n => n !== null);
    const count = new Set(rows.map(r => r.session.id)).size;
    $('metric-running').textContent = numeric(running);
    $('metric-attention').textContent = numeric(waiting + errors);
    $('metric-tools').textContent = toolsKnown ? numeric(toolCounts.reduce((s, n) => s + n, 0)) : '—';
    $('metric-sessions').textContent = numeric(count);
    $('metric-running-note').textContent = `${rows.length} agent trong bộ lọc`;
    $('metric-attention-note').textContent = `${waiting} chờ phản hồi · ${errors} có lỗi`;
    const projects = new Set(rows.map(r => r.session.project));
    $('metric-sessions-note').textContent = `${projects.size} dự án có agent phù hợp`;
  }
  function emptyState(type) {
    const box = el('div', 'empty-state'); box.append(icon(type === 'no-match' ? 'search' : 'radar'));
    if (type === 'loading') { box.append(el('h3', '', 'Đang kết nối bộ thu thập'), el('p', '', 'Dashboard sẽ hiển thị agents khi nhận được sự kiện từ Claude Code.')); }
    else if (type === 'offline') { box.append(el('h3', '', 'Đang chờ kết nối'), el('p', '', 'Khởi động server cục bộ để quan sát các phiên Claude Code. Dữ liệu thật sẽ xuất hiện tại đây.')); }
    else if (type === 'no-match') {
      box.append(el('h3', '', 'Không có agent phù hợp'), el('p', '', 'Thử đổi dự án, trạng thái hoặc từ khóa. Các bộ lọc áp dụng cho cả số liệu và dòng thời gian.'));
      const reset = el('button', 'text-button', 'Xóa tất cả bộ lọc'); reset.type = 'button'; reset.addEventListener('click', resetFilters); box.append(reset);
    } else {
      box.append(el('h3', '', 'Sẵn sàng quan sát agent đầu tiên'), el('p', '', 'Mở một phiên Claude Code đã tải plugin và bắt đầu công việc. Các agent và tool calls mới sẽ xuất hiện tự động.'));
      const code = el('code', '', 'claude --plugin-dir ./plugin'); box.append(code);
    }
    return box;
  }
  function emptyType(rows) {
    if (!state.snapshot) return state.error ? 'offline' : 'loading';
    return !rows.length && hasFilters() ? 'no-match' : 'empty';
  }
  function depthOf(agent, session) {
    const map = new Map((session.agents || []).map(a => [a.id, a]));
    const visited = new Set([agent.id]); let depth = 0, current = agent;
    while (current.parentId && map.has(current.parentId) && !visited.has(current.parentId) && depth < 4) {
      visited.add(current.parentId); depth++; current = map.get(current.parentId);
    }
    return depth;
  }
  function hierarchical(rows) {
    const byId = new Map(rows.map(r => [r.agent.id, r]));
    const result = [], seen = new Set();
    function walk(row) {
      if (seen.has(row.key)) return; seen.add(row.key); result.push(row);
      for (const child of rows) if (child.agent.parentId === row.agent.id) walk(child);
    }
    rows.filter(r => !r.agent.parentId || !byId.has(r.agent.parentId)).forEach(walk);
    rows.forEach(walk); return result;
  }
  function selectAgent(rowKey, scroll = false) {
    state.selected = rowKey;
    render();
    const row = allRows().find(r => r.key === rowKey);
    if (row) announce(`Đã chọn ${row.agent.name || row.agent.type || 'agent'}. Chi tiết ở bảng bên cạnh.`);
    if (scroll && window.innerWidth < 890) $('inspector').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  function renderAgentList(rows) {
    const list = $('agent-list'); list.replaceChildren();
    $('agent-count').textContent = state.snapshot ? rows.length : '—';
    if (!rows.length) list.append(emptyState(emptyType(rows)));
    const grouped = new Map();
    rows.forEach(row => { if (!grouped.has(row.session.id)) grouped.set(row.session.id, []); grouped.get(row.session.id).push(row); });
    for (const group of grouped.values()) {
      const session = group[0].session, section = el('div', 'session-group');
      const header = el('div', 'session-header');
      header.append(icon('folder'), el('span', 'session-project', session.project || 'Dự án chưa rõ'), el('span', '', '/'), el('span', 'session-id', String(session.id).slice(0, 12)));
      const context = num(session.contextPercent);
      const meta = el('span', 'session-meta', context === null ? 'Context —' : `Context ${Math.round(context)}%`);
      meta.title = 'Context của phiên; không phải tỷ lệ hoàn thành công việc.'; header.append(meta); section.append(header);
      for (const row of hierarchical(group)) {
        const { agent } = row, selected = state.selected === row.key;
        const button = el('button', `agent-row${selected ? ' selected' : ''}`);
        button.type = 'button'; button.dataset.focusKey = `agent:${row.key}`; button.dataset.agentId = agent.id;
        button.setAttribute('aria-pressed', String(selected));
        button.setAttribute('aria-label', `${agent.name || agent.type || 'Agent'}, ${statusLabels[statusOf(agent.status)]}, ${numeric(agent.toolCalls)} tool calls. Xem chi tiết.`);
        const depth = depthOf(agent, session), identity = el('span', `agent-identity${depth ? ' is-child' : ''}`);
        identity.style.setProperty('--depth', `${Math.min(depth, 2) * 15}px`);
        const avatar = el('span', `agent-avatar${agent.type === 'main' ? ' coordinator' : ''}`, initials(agent)); avatar.setAttribute('aria-hidden', 'true');
        const copy = el('span', 'agent-copy'); copy.append(el('span', 'agent-name', agent.name || agent.type || 'Agent'));
        const task = el('span', 'agent-task', agent.task || (agent.type === 'main' ? 'Điều phối phiên làm việc' : 'Chưa có mô tả công việc')); task.title = task.textContent;
        copy.append(task, el('span', 'agent-model', modelLabel(agent.model)));
        identity.append(avatar, copy);
        button.append(identity, badge(agent.status), el('span', 'tool-count', numeric(agent.toolCalls)), el('span', 'elapsed', duration(agent.startedAt, agent.endedAt)), el('span', 'row-chevron', '↗'));
        button.addEventListener('click', () => selectAgent(row.key, true)); section.append(button);
      }
      list.append(section);
    }
    $('filter-summary').textContent = state.snapshot ? `${rows.length} / ${allRows().length} agent${hasFilters() ? ' · đang áp dụng bộ lọc' : ' · toàn bộ dữ liệu đã ghi nhận'}` : 'Đang lấy dữ liệu…';
  }
  function renderTimeline(rows) {
    const host = $('timeline'); host.replaceChildren();
    $('timeline-history-note').textContent = rows.some(r => num(r.agent.toolCalls) !== null && (r.agent.tools || []).length < r.agent.toolCalls)
      ? 'Chỉ vẽ tool calls còn trong lịch sử được giữ' : 'Khoảng trống = không có tool ghi nhận';
    if (!rows.length) { host.append(el('div', 'timeline-empty', hasFilters() ? 'Không có agent trong bộ lọc hiện tại.' : 'Dòng thời gian sẽ xuất hiện khi có sự kiện.')); $('timeline-range').textContent = 'Thời gian từ dữ liệu'; return; }
    const starts = rows.map(r => ms(r.agent.startedAt)).filter(n => n !== null);
    const ends = rows.map(r => ms(r.agent.endedAt) ?? (['completed', 'error'].includes(r.agent.status) ? ms(r.agent.lastEventAt) : now())).filter(n => n !== null);
    if (!starts.length || !ends.length) { host.append(el('div', 'timeline-empty', 'Chưa có mốc thời gian để vẽ.')); return; }
    const start = Math.min(...starts), end = Math.max(start + 1000, ...ends), range = end - start;
    $('timeline-range').textContent = `${clock(new Date(start).toISOString())} — ${clock(new Date(end).toISOString())}`;
    const axis = el('div', 'timeline-axis'); axis.append(el('span', 'timeline-axis-label', 'AGENT'));
    const ticks = el('div', 'timeline-ticks');
    [0, 25, 50, 75, 100].forEach(percent => { const tick = el('span', '', clock(new Date(start + range * percent / 100).toISOString(), range < 120000)); tick.style.left = `${percent}%`; ticks.append(tick); });
    axis.append(ticks); host.append(axis);
    for (const row of rows) {
      const { agent } = row;
      const button = el('button', `timeline-row${row.key === state.selected ? ' selected' : ''}`); button.type = 'button'; button.dataset.focusKey = `timeline:${row.key}`;
      button.setAttribute('aria-label', `${agent.name || agent.type}: ${duration(agent.startedAt, agent.endedAt)}, ${numeric(agent.toolCalls)} tool calls. Xem chi tiết.`);
      button.append(el('span', 'timeline-name', agent.name || agent.type || 'Agent'));
      const track = el('span', 'timeline-track'); track.setAttribute('aria-hidden', 'true');
      const a = ms(agent.startedAt), b = ms(agent.endedAt) ?? (['completed', 'error'].includes(agent.status) ? ms(agent.lastEventAt) : now());
      if (a !== null && b !== null) { const life = el('span', `lifetime ${statusOf(agent.status)}`); positionSegment(life, a, b, start, end); track.append(life); }
      for (const tool of Array.isArray(agent.tools) ? agent.tools : []) {
        const s = ms(tool.startedAt); if (s === null) continue;
        const e = ms(tool.endedAt) ?? (tool.status === 'running' ? end : s + Math.max(1, num(tool.durationMs) ?? 1));
        const segment = el('span', `tool-segment${tool.status === 'running' ? ' is-running' : ''}${['error', 'denied'].includes(tool.status) ? ' is-error' : ''}`);
        positionSegment(segment, s, e, start, end);
        segment.title = `${tool.name}: ${toolStatus(tool.status)} · ${clock(tool.startedAt, true)}`;
        track.append(segment);
      }
      button.append(track); button.addEventListener('click', () => selectAgent(row.key, true)); host.append(button);
    }
  }
  function positionSegment(element, a, b, start, end) {
    const left = Math.max(0, Math.min(100, (a - start) / (end - start) * 100));
    const right = Math.max(left, Math.min(100, (b - start) / (end - start) * 100));
    element.style.left = `${left}%`; element.style.width = `${right - left}%`;
  }
  function filteredEvents(rows) {
    const result = new Map();
    for (const row of rows) {
      const events = [...(row.agent.events || []), ...(row.session.events || []).filter(e => e.agentId === row.agent.id)];
      for (const event of events) {
        const id = `${row.session.id}:${event.id || `${event.timestamp}:${event.type}:${event.agentId}:${event.title}`}`;
        if (!result.has(id)) result.set(id, { ...event, row });
      }
    }
    return [...result.values()].sort((a, b) => (ms(b.timestamp) ?? 0) - (ms(a.timestamp) ?? 0));
  }
  function renderActivity(rows) {
    const host = $('activity-list'); host.replaceChildren();
    const events = filteredEvents(rows); $('event-count').textContent = state.snapshot ? events.length : '—';
    if (!events.length) { host.append(el('div', 'empty-state', rows.length ? 'Chưa có sự kiện cho các agent này.' : 'Không có hoạt động trong bộ lọc hiện tại.')); return; }
    for (const event of events.slice(0, 80)) {
      const item = el('div', 'activity-entry');
      item.append(el('span', `event-mark${event.status === 'error' ? ' error' : ''}`));
      const content = el('div'); content.append(el('div', 'activity-title', event.title || event.type || 'Sự kiện'));
      if (event.detail) content.append(el('div', 'activity-detail', event.detail));
      const agent = el('button', 'activity-agent', `${event.row.agent.name || event.row.agent.type} · ${event.row.session.project}`);
      agent.type = 'button'; agent.dataset.focusKey = `event:${event.id || event.timestamp}:${event.row.key}`; agent.addEventListener('click', () => selectAgent(event.row.key, true)); content.append(agent);
      const time = el('time', 'activity-time', clock(event.timestamp, true)); time.dateTime = event.timestamp || ''; time.title = fullDate(event.timestamp);
      item.append(content, time); host.append(item);
    }
  }
  function detailField(label, value, mono = false) {
    const item = el('div'); item.append(el('span', 'detail-label', label), el('span', `detail-value${mono ? ' mono' : ''}`, value)); return item;
  }
  function inspectorSection(title) { const section = el('section', 'inspector-section'); section.append(el('h3', '', title)); return section; }
  function renderInspector(rows) {
    const row = rows.find(r => r.key === state.selected);
    $('inspector-empty').hidden = Boolean(row); $('inspector-content').hidden = !row;
    const host = $('inspector-content'); host.replaceChildren(); if (!row) return;
    const { agent, session } = row;
    const head = el('header', 'inspector-header');
    const kicker = el('div', 'inspector-kicker'); kicker.append(el('span', '', 'AGENT ĐƯỢC CHỌN'), icon('arrow')); head.append(kicker);
    const titleRow = el('div', 'inspector-title-row'); titleRow.append(el('span', 'inspector-avatar', initials(agent)));
    const titleCopy = el('div'); const title = el('h2', 'inspector-title', agent.name || agent.type || 'Agent'); title.id = 'inspector-heading';
    titleCopy.append(title, badge(agent.status)); titleRow.append(titleCopy); head.append(titleRow);
    head.append(el('p', 'inspector-task', agent.task || (agent.type === 'main' ? 'Điều phối công việc trong phiên này.' : 'Agent chưa cung cấp mô tả công việc.'))); host.append(head);
    const meta = el('div', 'inspector-meta');
    meta.append(detailField('MODEL', agent.model ? modelLabel(agent.model) : '—', true), detailField('THỜI GIAN', duration(agent.startedAt, agent.endedAt), true), detailField('TOOL CALLS', numeric(agent.toolCalls), true), detailField('LỖI GHI NHẬN', numeric(agent.errors), true)); host.append(meta);
    const tabs = el('div', 'inspector-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Chi tiết agent');
    for (const [value, label] of [['overview', 'Tổng quan'], ['tools', 'Tools'], ['files', 'Tệp']]) {
      const button = el('button', 'inspector-tab', label); button.type = 'button'; button.id = `inspector-tab-${value}`; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(state.inspectorTab === value)); button.setAttribute('aria-controls', 'inspector-body'); button.tabIndex = state.inspectorTab === value ? 0 : -1; button.dataset.focusKey = `inspect:${value}`;
      button.addEventListener('click', () => { state.inspectorTab = value; preserveFocus(() => renderInspector(filteredRows())); });
      button.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const vals = ['overview', 'tools', 'files']; let index = vals.indexOf(value); index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3; state.inspectorTab = vals[index]; renderInspector(filteredRows()); $(`inspector-tab-${vals[index]}`).focus(); });
      tabs.append(button);
    }
    host.append(tabs);
    const body = el('div', 'inspector-body'); body.id = 'inspector-body'; body.setAttribute('role', 'tabpanel'); body.setAttribute('aria-labelledby', `inspector-tab-${state.inspectorTab}`); body.tabIndex = 0; body.dataset.focusKey = `inspector-body:${row.key}`;
    if (state.inspectorTab === 'overview') {
      const sessionSection = inspectorSection('PHIÊN CHỨA AGENT');
      sessionSection.append(el('p', 'session-usage-project', `${session.project || 'Dự án'} · ${String(session.id).slice(0, 12)}`));
      const sessionStats = el('div', 'session-usage-stats');
      const context = num(session.contextPercent);
      sessionStats.append(detailField('CONTEXT CỦA PHIÊN', context === null ? '—' : `${Math.round(context)}%`, true));
      sessionStats.append(detailField(session.costEstimated === false ? 'CHI PHÍ PHIÊN' : 'ƯỚC TÍNH CHI PHÍ PHIÊN', costLabel(session), true));
      sessionSection.append(sessionStats);
      if (context !== null) {
        const meter = el('div', 'usage-meter'); meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', 'Context của phiên đã sử dụng'); meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '100'); meter.setAttribute('aria-valuenow', String(Math.min(100, context))); meter.setAttribute('aria-valuetext', `${context}%`);
        const fill = el('span'); fill.style.width = `${Math.max(0, Math.min(100, context))}%`; meter.append(fill); sessionSection.append(meter);
      }
      sessionSection.append(el('p', 'detail-note', 'Chi phí thuộc toàn phiên, không phải chi phí riêng của agent đang chọn. — là chưa có số liệu đầy đủ.'));
      const limits = Array.isArray(session.rateLimits) ? session.rateLimits : [];
      if (!limits.length) sessionSection.append(el('p', 'detail-note', 'Hạn mức: — · runtime chưa báo dữ liệu.'));
      else {
        const limitLabels = { five_hour: 'Hạn mức 5 giờ', seven_day: 'Hạn mức 7 ngày', '5h': 'Hạn mức 5 giờ', '7d': 'Hạn mức 7 ngày', spend_limit: 'Hạn mức chi tiêu' };
        const list = el('div', 'quota-list');
        for (const limit of limits) {
          const item = el('div', 'quota-item'); const top = el('div', 'quota-heading');
          const percent = num(limit.percentUsed);
          top.append(el('span', '', limitLabels[limit.kind] || `Hạn mức ${String(limit.kind || 'chưa rõ').replaceAll('_', ' ')}`), el('strong', '', percent === null ? '—' : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(percent)}%`));
          item.append(top);
          item.append(el('div', 'detail-time', ms(limit.resetsAt) === null ? 'Chưa có thời điểm reset' : `Reset: ${fullDate(limit.resetsAt)}`));
          list.append(item);
        }
        sessionSection.append(list, el('p', 'detail-note', 'Hạn mức do runtime báo; không phải tỷ lệ hoàn thành công việc.'));
      }
      body.append(sessionSection);
      const section = inspectorSection('TOKEN ĐƯỢC BÁO CÁO'); const grid = el('div', 'token-grid');
      for (const [label, prop] of [['Input', 'input'], ['Output', 'output'], ['Cache read', 'cacheRead'], ['Cache write', 'cacheWrite']]) { const cell = el('div', 'token-item'); cell.append(el('span', '', label), el('strong', '', shortNum(agent.tokens?.[prop]))); grid.append(cell); }
      section.append(grid, el('p', 'detail-note', '— nghĩa là runtime chưa báo dữ liệu. Không ước tính token từ thời gian chạy.'));
      if (num(agent.costUsd) !== null) {
        const estimated = agent.costEstimated !== false;
        const label = estimated ? 'Chi phí ước tính' : 'Chi phí runtime báo';
        section.append(el('p', 'detail-note', `${label} của agent: ${costLabel(agent)}`));
      }
      body.append(section);
      const events = [...(agent.events || [])].sort((a, b) => (ms(b.timestamp) ?? 0) - (ms(a.timestamp) ?? 0)).slice(0, 4);
      const recent = inspectorSection('CÁC BƯỚC GẦN NHẤT');
      if (!events.length) recent.append(el('p', 'detail-empty', 'Chưa có sự kiện được ghi nhận.'));
      else {
        const list = el('div', 'detail-list');
        for (const event of events) { const item = el('div', 'detail-event'); item.append(el('span', 'detail-event-dot')); const copy = el('div'); copy.append(el('div', 'detail-event-name', event.title || event.type)); if (event.detail) copy.append(el('div', 'detail-event-copy', event.detail)); copy.append(el('div', 'detail-time', clock(event.timestamp, true))); item.append(copy); list.append(item); }
        recent.append(list);
      }
      body.append(recent);
      const tasks = (session.tasks || []).filter(t => t.owner === agent.id || t.owner === agent.name || (!t.owner && agent.type === 'main'));
      if (tasks.length) {
        const taskSection = inspectorSection('CÔNG VIỆC TRONG PHIÊN'); const list = el('div', 'detail-list');
        for (const task of tasks) { const item = el('div', 'task-item'); const marks = { completed: '✓', in_progress: '◐', pending: '○' }; const marker = el('span', 'task-marker', marks[task.status] || '—'); marker.setAttribute('aria-label', task.status === 'completed' ? 'Đã xong' : task.status === 'in_progress' ? 'Đang làm' : 'Đang chờ'); item.append(marker, el('span', '', task.subject || task.id)); list.append(item); }
        taskSection.append(list); body.append(taskSection);
      }
    } else if (state.inspectorTab === 'tools') {
      const tools = [...(agent.tools || [])].sort((a, b) => (ms(b.startedAt) ?? 0) - (ms(a.startedAt) ?? 0));
      if (num(agent.toolCalls) !== null && tools.length < agent.toolCalls) body.append(el('p', 'detail-note retained-history-note', `Hiển thị ${tools.length} tool call gần nhất trong ${numeric(agent.toolCalls)} lần đã ghi nhận. Lịch sử cũ hơn đã được giới hạn trong bản dữ liệu.`));
      if (!tools.length) body.append(el('p', 'detail-empty', 'Chưa có tool call được ghi nhận cho agent này.'));
      for (const tool of tools) {
        const item = el('div', 'tool-detail'); const top = el('div', 'tool-detail-top'); top.append(el('span', '', tool.name || 'Tool'), el('span', 'status', toolStatus(tool.status))); item.append(top);
        if (tool.summary) item.append(el('div', 'tool-detail-summary', tool.summary));
        const latency = num(tool.durationMs) === null ? 'Thời gian chưa được báo' : tool.durationMs < 1000 ? `${tool.durationMs} ms` : `${(tool.durationMs / 1000).toFixed(1)} s`;
        item.append(el('div', 'tool-detail-time', `${clock(tool.startedAt, true)} · ${latency}`)); body.append(item);
      }
    } else {
      const files = [...new Set((agent.files || []).map(f => typeof f === 'string' ? f : f.path).filter(Boolean))];
      if (!files.length) body.append(el('p', 'detail-empty', 'Chưa có tệp được ghi nhận. Không có dữ liệu không có nghĩa agent chưa thao tác tệp.'));
      for (const file of files) { const item = el('div', 'file-row'); item.append(icon('file'), el('span', '', file)); body.append(item); }
    }
    host.append(body);
    const footer = el('div', 'inspector-footer'); footer.append(el('div', '', `${session.project || 'Dự án'} · ${String(agent.id)}`));
    footer.append(el('div', '', `Sự kiện cuối: ${relative(agent.lastEventAt)}`));
    if (agent.parentId) footer.append(el('div', '', `Agent cha: ${(session.agents || []).find(a => a.id === agent.parentId)?.name || agent.parentId}`));
    footer.append(el('div', '', '“Đã kết thúc” là vòng đời agent, không phải kết luận test PASS.')); host.append(footer);
  }
  function render() {
    updateOptions(); const rows = filteredRows();
    if (!rows.some(r => r.key === state.selected)) {
      const preferred = rows.find(r => r.agent.status === 'waiting') || rows.find(r => r.agent.status === 'running' && r.agent.type !== 'main') || rows[0];
      state.selected = preferred?.key || null;
    }
    preserveFocus(() => { renderMetrics(rows); renderAgentList(rows); renderTimeline(rows); renderActivity(rows); renderInspector(rows); });
    $('reset-filters').hidden = !hasFilters(); updateConnection();
  }
  function setSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.sessions) || snapshot.schemaVersion !== 1) throw new Error('Unsupported snapshot');
    if (state.paused) { state.pending = snapshot; return; }
    state.snapshot = snapshot; state.demo = snapshot.source?.mode === 'demo' || params.get('demo') === '1'; state.connected = true; state.error = null; state.lastFetch = Date.now(); render();
  }
  function resetFilters() {
    state.filters = { search: '', project: '', session: '', status: '' };
    $('search-input').value = ''; $('project-filter').value = ''; $('session-filter').value = ''; $('status-filter').value = ''; render(); announce('Đã xóa toàn bộ bộ lọc.');
  }
  function setView(view) {
    if (!Object.hasOwn(viewNames, view)) view = 'overview';
    state.view = view; document.body.dataset.view = view;
    $('page-title').replaceChildren(document.createTextNode(viewNames[view][0]), el('span', 'title-dot', '.'));
    $('page-subtitle').textContent = viewNames[view][1];
    document.querySelectorAll('.nav-item[data-view]').forEach(button => { const active = button.dataset.view === view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); button.setAttribute('aria-label', viewNames[button.dataset.view][0]); });
    try { const url = new URL(location.href); url.hash = view === 'overview' ? '' : view; history.replaceState(null, '', url); } catch { /* file preview may not permit history writes */ }
  }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('theme-button').replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
    $('theme-button').setAttribute('aria-label', theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
    try { localStorage.setItem('agent-observatory-theme', theme); } catch { /* embedded previews can deny storage */ }
  }
  function togglePause() {
    state.paused = !state.paused; $('pause-button').setAttribute('aria-pressed', String(state.paused));
    $('pause-button').setAttribute('aria-label', state.paused ? 'Tiếp tục cập nhật màn hình' : 'Tạm dừng cập nhật màn hình');
    const holder = $('pause-button').querySelector('[data-icon]'); holder.dataset.icon = state.paused ? 'play' : 'pause'; holder.replaceChildren(icon(holder.dataset.icon));
    $('pause-label').textContent = state.paused ? 'Tiếp tục cập nhật' : 'Tạm dừng cập nhật';
    if (!state.paused && state.pending) { const snapshot = state.pending; state.pending = null; setSnapshot(snapshot); }
    else updateConnection();
    announce(state.paused ? 'Đã tạm dừng cập nhật màn hình. Agents vẫn tiếp tục làm việc.' : 'Đã tiếp tục cập nhật màn hình.');
  }
  async function fetchSnapshot() {
    if (state.static) { render(); announce('Đây là bản xem thử tĩnh với dữ liệu mẫu.'); return; }
    const request = ++state.request;
    state.loading = true; $('refresh-button').disabled = true;
    try {
      const url = location.protocol === 'file:' ? './demo.json' : `/api/state${params.get('demo') === '1' ? '?demo=1' : ''}`;
      if (location.protocol === 'file:' && !state.demo) throw new Error('Server required');
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = await response.json(); if (request !== state.request) return;
      setSnapshot(snapshot); state.connected = true; state.error = null; updateConnection();
    } catch (error) {
      if (request !== state.request) return;
      state.connected = false; state.error = error.message; render();
    } finally {
      if (request === state.request) { state.loading = false; $('refresh-button').disabled = false; }
    }
  }
  function connectStream() {
    if (state.static || location.protocol === 'file:' || !window.EventSource) return;
    state.source?.close();
    const stream = new EventSource(`/api/events${params.get('demo') === '1' ? '?demo=1' : ''}`); state.source = stream;
    stream.onopen = () => { state.streamOpen = true; state.connected = true; state.error = null; updateConnection(); };
    stream.addEventListener('snapshot', event => {
      try { setSnapshot(JSON.parse(event.data)); } catch { state.error = 'Dữ liệu cập nhật không hợp lệ'; updateConnection(); }
    });
    stream.addEventListener('source-error', () => { state.error = 'Bộ thu thập chưa đọc được dữ liệu cục bộ'; updateConnection(); });
    stream.onerror = () => { state.streamOpen = false; state.error = 'Kết nối cập nhật bị gián đoạn'; updateConnection(); };
  }

  hydrateIcons();
  let storedTheme = null; try { storedTheme = localStorage.getItem('agent-observatory-theme'); } catch { /* optional */ }
  setTheme(storedTheme === 'dark' ? 'dark' : 'light');
  setView(location.hash.slice(1));
  $('timezone-label').textContent = `Múi giờ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  if (location.protocol === 'file:' || state.static) $('live-link').href = 'http://127.0.0.1:47831/';
  document.querySelectorAll('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  const officeLink = $('office-window-link');
  function officeUrl() {
    if (state.static) return './agent-observatory-office-preview.html';
    const query = new URLSearchParams();
    if (state.demo || params.get('demo') === '1') query.set('demo', '1');
    if (state.filters.project) query.set('project', state.filters.project);
    if (state.filters.session) query.set('session', state.filters.session);
    if (state.filters.search) query.set('q', state.filters.search);
    return `/office${query.size ? '?' + query.toString() : ''}`;
  }
  officeLink.href = officeUrl();
  officeLink.addEventListener('click', event => {
    officeLink.href = officeUrl();
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const popup = window.open(officeLink.href, 'agent-observatory-office', 'popup,width=1400,height=900');
    if (popup) { popup.opener = null; event.preventDefault(); }
  });
  $('search-input').addEventListener('input', event => { state.filters.search = event.target.value; render(); });
  for (const name of ['project', 'session', 'status']) $(`${name}-filter`).addEventListener('change', event => { state.filters[name] = event.target.value; render(); announce(`${filteredRows().length} agent phù hợp với bộ lọc.`); });
  $('reset-filters').addEventListener('click', resetFilters);
  $('theme-button').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('pause-button').addEventListener('click', togglePause);
  $('refresh-button').addEventListener('click', () => { fetchSnapshot(); if (!state.streamOpen) connectStream(); });
  $('retry-button').addEventListener('click', () => { fetchSnapshot(); connectStream(); });
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) { event.preventDefault(); $('search-input').focus(); }
    if (event.key === 'Escape' && document.activeElement === $('search-input')) { $('search-input').value = ''; state.filters.search = ''; render(); }
  });
  window.addEventListener('hashchange', () => setView(location.hash.slice(1)));
  window.addEventListener('beforeunload', () => state.source?.close());
  window.AgentObservatory = Object.freeze({ setSnapshot, getState: () => ({ filters: { ...state.filters }, selected: state.selected, paused: state.paused, view: state.view }) });
  if (window.__AGENT_OBSERVATORY_SNAPSHOT__) {
    const snapshot = window.__AGENT_OBSERVATORY_SNAPSHOT__;
    setSnapshot({ ...snapshot, source: { ...snapshot.source, mode: 'demo' } });
  } else { render(); fetchSnapshot().then(connectStream); }
  setInterval(() => { if (!state.paused && !state.static && state.snapshot) render(); }, 10000);
})();
