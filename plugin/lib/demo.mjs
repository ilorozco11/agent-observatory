/** Synthetic demonstration only. Never mixed into a live snapshot. */
import { reduceEvents } from './model.mjs';

export function createDemoEvents(now = Date.now()) {
  const anchor = new Date(now).getTime();
  const events = [];
  let seq = 0;
  const add = (sessionId, secondsAgo, type, extra = {}) => {
    const event = {
      id: `demo-event-${++seq}`, sessionId, type,
      timestamp: new Date(anchor - secondsAgo * 1000).toISOString(), ...extra,
    };
    events.push(event);
    return event;
  };
  const tool = (sessionId, agentId, secondsAgo, durationSeconds, toolName, summary, extra = {}) => {
    const toolId = `demo-tool-${seq + 1}`;
    add(sessionId, secondsAgo, 'tool.start', { agentId, toolId, toolName, summary, ...extra });
    if (durationSeconds !== null) add(sessionId, secondsAgo - durationSeconds,
      extra.status === 'error' ? 'tool.error' : 'tool.end',
      { agentId, toolId, toolName, summary, durationMs: durationSeconds * 1000, ...extra });
  };
  const usage = (sessionId, agentId, secondsAgo, input, output, cacheRead, cacheWrite, model) =>
    add(sessionId, secondsAgo, 'usage', { scope: 'agent', agentId, tokens: { input, output, cacheRead, cacheWrite }, model });

  const web = 'demo-web-session';
  add(web, 940, 'session.start', { project: 'sample-app', cwd: '~/projects/sample-app', model: 'claude-sonnet-4-5', name: 'Điều phối phát triển' });
  add(web, 930, 'turn.start', { agentId: 'main', task: 'Hoàn thiện dashboard và kiểm tra dữ liệu API' });
  tool(web, 'main', 925, 2, 'Read', 'README.md · yêu cầu và cách chạy dự án', { file: 'README.md' });
  tool(web, 'main', 900, 3, 'Glob', 'src/components/dashboard/**');
  add(web, 865, 'agent.start', { agentId: 'ui-agent', parentId: 'main', name: 'Frontend UI', agentType: 'frontend', model: 'claude-sonnet-4-5', task: 'Tinh chỉnh bộ lọc và trạng thái tải của dashboard' });
  add(web, 824, 'agent.start', { agentId: 'api-agent', parentId: 'main', name: 'Tích hợp API', agentType: 'research', model: 'claude-sonnet-4-5', task: 'Đối chiếu API, quyền truy cập và phản hồi trên staging' });
  tool(web, 'ui-agent', 850, 1, 'Read', 'src/components/dashboard/Filters.tsx', { file: 'src/components/dashboard/Filters.tsx' });
  tool(web, 'ui-agent', 820, 2, 'Read', 'src/components/dashboard/Dashboard.tsx', { file: 'src/components/dashboard/Dashboard.tsx' });
  tool(web, 'ui-agent', 780, 4, 'Edit', 'Thêm trạng thái tải và điều khiển bằng bàn phím', { file: 'src/components/dashboard/Filters.tsx' });
  tool(web, 'ui-agent', 700, 3, 'Edit', 'Căn chỉnh bộ lọc trên màn hình nhỏ', { file: 'src/styles/dashboard.css' });
  tool(web, 'ui-agent', 640, 18, 'Bash', 'TypeScript · kiểm tra kiểu dữ liệu');
  add(web, 590, 'agent.start', { agentId: 'e2e-agent', parentId: 'ui-agent', name: 'Kiểm thử tương tác', agentType: 'test', model: 'claude-haiku-4-5', task: 'Kiểm tra bộ lọc, bàn phím và màn hình nhỏ' });
  tool(web, 'e2e-agent', 565, 2, 'Read', 'tests/dashboard-filters.spec.ts', { file: 'tests/dashboard-filters.spec.ts' });
  tool(web, 'e2e-agent', 520, 41, 'Bash', 'Playwright · lần chạy đầu', { status: 'error' });
  tool(web, 'e2e-agent', 450, 4, 'Edit', 'Điều chỉnh chờ dữ liệu API trong test', { file: 'tests/dashboard-filters.spec.ts' });
  tool(web, 'e2e-agent', 380, 65, 'Bash', 'Playwright · kiểm tra lại thao tác dashboard');
  usage(web, 'e2e-agent', 300, 4200, 1900, 18200, 1600, 'claude-haiku-4-5');
  add(web, 296, 'agent.end', { agentId: 'e2e-agent', summary: 'Đã kết thúc lượt kiểm tra; xem log tool để biết kết quả từng lệnh' });
  tool(web, 'api-agent', 790, 2, 'Read', 'src/lib/api-client.ts', { file: 'src/lib/api-client.ts' });
  tool(web, 'api-agent', 710, 9, 'Bash', 'Kiểm tra phản hồi API trong môi trường thử nghiệm');
  tool(web, 'api-agent', 560, 3, 'Read', 'docs/staging-checklist.md', { file: 'docs/staging-checklist.md' });
  tool(web, 'api-agent', 150, 5, 'Bash', 'Đọc kết quả kiểm tra mạng trên staging');
  add(web, 120, 'waiting', { agentId: 'api-agent', summary: 'Đang chờ xác nhận môi trường staging để kiểm tra tiếp' });
  usage(web, 'api-agent', 110, 8300, 2700, 34100, 2600, 'claude-sonnet-4-5');
  tool(web, 'ui-agent', 105, 2, 'Read', 'src/components/dashboard/Filters.tsx', { file: 'src/components/dashboard/Filters.tsx' });
  tool(web, 'ui-agent', 70, 4, 'Edit', 'Bổ sung trạng thái focus cho điều khiển', { file: 'src/components/dashboard/Filters.tsx' });
  tool(web, 'ui-agent', 30, null, 'Bash', 'Build · xác minh giao diện dashboard');
  usage(web, 'ui-agent', 12, 12900, 4300, 52100, 4200, 'claude-sonnet-4-5');
  usage(web, 'main', 9, 5300, 1400, 22400, 2100, 'claude-sonnet-4-5');
  add(web, 8, 'usage', { scope: 'session', tokens: { input: 30700, output: 10300, cacheRead: 126800, cacheWrite: 10500 }, costUsd: 0.48, contextPercent: 42, model: 'claude-sonnet-4-5', rateLimits: [{ kind: 'five_hour', percentUsed: 34, resetsAt: new Date(anchor + 7_800_000).toISOString() }] });
  add(web, 880, 'task.update', { taskRecord: { id: 'dashboard-ui', subject: 'Cải thiện giao diện dashboard', status: 'in_progress', owner: 'ui-agent', blockedBy: [] } });
  add(web, 815, 'task.update', { taskRecord: { id: 'api-check', subject: 'Kiểm tra kết nối API trên staging', status: 'in_progress', owner: 'api-agent', blockedBy: [] } });
  add(web, 295, 'task.update', { taskRecord: { id: 'interaction-tests', subject: 'Kiểm tra thao tác và bàn phím', status: 'completed', owner: 'e2e-agent', blockedBy: [] } });
  add(web, 6, 'task.update', { taskRecord: { id: 'release-summary', subject: 'Tổng hợp kết quả xác minh', status: 'pending', owner: 'main', blockedBy: ['dashboard-ui', 'api-check'] } });

  const review = 'demo-review-session';
  add(review, 520, 'session.start', { project: 'sample-code-review', cwd: '~/projects/sample-code-review', name: 'Điều phối review', model: 'claude-sonnet-4-5' });
  add(review, 510, 'turn.start', { agentId: 'main', task: 'Review một MR minh họa, thu thập findings và bằng chứng' });
  tool(review, 'main', 500, 4, 'Bash', 'Đọc diff và danh sách file thay đổi');
  add(review, 480, 'agent.start', { agentId: 'diff-agent', parentId: 'main', name: 'Phân tích thay đổi', agentType: 'review', task: 'Xác định phạm vi thay đổi và các điểm cần đối chiếu', model: 'claude-haiku-4-5' });
  add(review, 465, 'agent.start', { agentId: 'bugs-agent', parentId: 'main', name: 'Kiểm tra logic', agentType: 'review', task: 'Kiểm tra nhánh xử lý lỗi và tính nhất quán dữ liệu', model: 'claude-sonnet-4-5' });
  add(review, 440, 'agent.start', { agentId: 'security-agent', parentId: 'main', name: 'Quyền & dữ liệu', agentType: 'review', task: 'Đọc các đường dẫn kiểm tra quyền và dữ liệu đầu vào', model: 'claude-sonnet-4-5' });
  tool(review, 'diff-agent', 475, 2, 'Read', 'src/api/review.ts', { file: 'src/api/review.ts' });
  tool(review, 'diff-agent', 420, 2, 'Grep', 'Các nơi gọi review handler');
  tool(review, 'diff-agent', 350, 3, 'Read', 'src/types/review.ts', { file: 'src/types/review.ts' });
  usage(review, 'diff-agent', 320, 2800, 950, 11400, 1200, 'claude-haiku-4-5');
  add(review, 310, 'agent.end', { agentId: 'diff-agent', summary: 'Đã gửi bản đồ thay đổi cho điều phối' });
  tool(review, 'security-agent', 430, 2, 'Read', 'src/auth/permissions.ts', { file: 'src/auth/permissions.ts' });
  tool(review, 'security-agent', 360, 1, 'Read', 'src/api/review.ts', { file: 'src/api/review.ts' });
  tool(review, 'security-agent', 260, 17, 'Bash', 'Chạy bộ kiểm tra quyền truy cập');
  usage(review, 'security-agent', 180, 4200, 1800, 16200, 1700, 'claude-sonnet-4-5');
  add(review, 170, 'agent.end', { agentId: 'security-agent', summary: 'Đã kết thúc kiểm tra; findings được chuyển cho điều phối' });
  tool(review, 'bugs-agent', 450, 2, 'Read', 'src/services/review-runner.ts', { file: 'src/services/review-runner.ts' });
  tool(review, 'bugs-agent', 390, 2, 'Grep', 'Các nhánh timeout và retry');
  tool(review, 'bugs-agent', 220, 3, 'Read', 'tests/review-runner.test.ts', { file: 'tests/review-runner.test.ts' });
  tool(review, 'bugs-agent', 45, null, 'Bash', 'Chạy kiểm tra điều kiện timeout');
  usage(review, 'bugs-agent', 14, 6300, 2100, 26300, 2300, 'claude-sonnet-4-5');
  usage(review, 'main', 11, 2900, 800, 9500, 900, 'claude-sonnet-4-5');
  add(review, 10, 'usage', { scope: 'session', tokens: { input: 16200, output: 5650, cacheRead: 63400, cacheWrite: 6100 }, costUsd: 0.25, contextPercent: 27, model: 'claude-sonnet-4-5' });
  add(review, 470, 'task.update', { taskRecord: { id: 'scope', subject: 'Xác định phạm vi MR', status: 'in_progress', owner: 'diff-agent', blockedBy: [] } });
  add(review, 309, 'task.update', { taskRecord: { id: 'scope', subject: 'Xác định phạm vi MR', status: 'completed', owner: 'diff-agent' } });
  add(review, 430, 'task.update', { taskRecord: { id: 'logic', subject: 'Kiểm tra lỗi logic', status: 'in_progress', owner: 'bugs-agent', blockedBy: [] } });
  add(review, 160, 'task.update', { taskRecord: { id: 'security', subject: 'Kiểm tra quyền và dữ liệu', status: 'completed', owner: 'security-agent', blockedBy: [] } });
  add(review, 7, 'task.update', { taskRecord: { id: 'findings', subject: 'Tổng hợp findings có bằng chứng', status: 'pending', owner: 'main', blockedBy: ['logic'] } });
  return events;
}

export function createDemoSnapshot(now = Date.now()) {
  return reduceEvents(createDemoEvents(now), {
    now, mode: 'demo',
    warnings: ['Dữ liệu minh họa được tạo sẵn; không phải các agent đang chạy trên máy của bạn.'],
  });
}
