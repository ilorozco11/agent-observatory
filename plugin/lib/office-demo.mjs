/** Explicit synthetic replay. Never writes events or contributes to a live snapshot. */
import { createDemoEvents } from './demo.mjs';
import { reduceEvents } from './model.mjs';

export function createOfficeDemoFrames(now = Date.now()) {
  const anchor = new Date(now).getTime();
  const events = createDemoEvents(anchor);
  let sequence = 0;
  function add(offset, sessionId, agentId, type, extra = {}) {
    events.push({ id: `office-demo-${++sequence}`, timestamp: new Date(anchor + offset * 1000).toISOString(), sessionId, agentId, type, ...extra });
  }
  function model(start, end, sessionId, agentId, requestId) {
    add(start, sessionId, agentId, 'model.start', { requestId });
    add(end, sessionId, agentId, 'model.end', { requestId });
  }
  model(-842, -826, 'demo-web-session', 'ui-agent', 'sample-ui-plan');
  model(-642, -615, 'demo-web-session', 'api-agent', 'sample-api-analysis');
  model(-490, -460, 'demo-review-session', 'main', 'sample-review-plan');
  model(-230, -205, 'demo-review-session', 'main', 'sample-review-synthesis');
  model(-130, -90, 'demo-web-session', 'main', 'sample-main-process');
  for (const [sessionId, agentId, offset] of [['demo-review-session', 'bugs-agent', 7], ['demo-web-session', 'ui-agent', 10]]) {
    const active = [...events].reverse().find(event => event.sessionId === sessionId && event.agentId === agentId && event.type === 'tool.start');
    if (active) add(offset, sessionId, agentId, 'tool.end', { toolId: active.toolId, toolName: active.toolName, summary: active.summary, status: 'success', durationMs: anchor + offset * 1000 - new Date(active.timestamp).getTime() });
    add(offset + 4, sessionId, agentId, 'agent.end', { status: 'completed', summary: 'Đã kết thúc lượt làm việc mẫu' });
  }
  add(22, 'demo-web-session', 'api-agent', 'tool.start', { toolId: 'sample-resume-read', toolName: 'Read', summary: 'docs/staging-checklist.md', file: 'docs/staging-checklist.md' });
  add(25, 'demo-web-session', 'api-agent', 'tool.end', { toolId: 'sample-resume-read', toolName: 'Read', summary: 'docs/staging-checklist.md', status: 'success', durationMs: 3000 });
  add(28, 'demo-web-session', 'api-agent', 'agent.end', { status: 'completed' });
  for (const sessionId of ['demo-web-session', 'demo-review-session']) {
    add(35, sessionId, 'main', 'turn.end', { status: 'idle' });
    add(45, sessionId, 'main', 'session.end', { status: 'completed' });
  }
  const steps = [
    [-840, 'Gọi model để xử lý'], [-819, 'Đọc mã nguồn'], [-778, 'Chỉnh sửa giao diện'],
    [-630, 'Chạy lệnh và gọi model'], [-519, 'Agent kiểm thử bắt đầu'], [-478, 'Một tool báo lỗi'],
    [-448, 'Chỉnh sửa sau lỗi'], [-370, 'Nhiều agent làm song song'], [-219, 'Đọc mã và tổng hợp'],
    [-119, 'Chờ bạn phản hồi'], [-28, 'Các tool đang chạy'], [23, 'Tiếp tục sau khi chờ'],
    [36, 'Kết thúc các lượt làm việc'], [46, 'Hai phiên đã kết thúc'],
  ];
  return steps.map(([offset, label], index) => {
    const frameTime = anchor + offset * 1000;
    const snapshot = reduceEvents(events.filter(event => new Date(event.timestamp).getTime() <= frameTime), {
      now: frameTime, mode: 'demo', connected: true,
      // The demo skips over quiet intervals. This does not alter the live stale threshold.
      staleAfterMs: 900000,
      warnings: ['Phát lại dữ liệu mẫu. Nhân vật, công việc và thời gian đều là minh họa.'],
    });
    return { id: `sample-frame-${index + 1}`, label, snapshot };
  });
}
