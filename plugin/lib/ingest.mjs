import { basename, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Deliberately retain metadata only. Raw prompts, shell arguments, tool responses,
// environment variables and final assistant messages never enter the event log.
export function safeText(value, limit = 240) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{15,})\b/g, '[redacted]')
    .replace(/\b(?:Bearer|token|password|secret|api[_-]?key)\s*[:= ]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .slice(0, limit);
}
export function safePath(file, cwd) {
  if (typeof file !== 'string') return null;
  let result = isAbsolute(file) && cwd ? relative(cwd, file) : file;
  if (result.startsWith('..')) result = basename(file);
  result = result.replace(homedir(), '~');
  return safeText(result, 220);
}
export function toolSummary(name, input, cwd) {
  if (!input || typeof input !== 'object') return safeText(name);
  if (input.file_path || input.notebook_path || input.path) return safePath(input.file_path || input.notebook_path || input.path, cwd);
  if (name === 'Bash') {
    // Only a command's first program name; even a command description can contain secrets.
    const program = String(input.command || '').trim().match(/^([A-Za-z0-9_.\/-]+)/)?.[1];
    return program ? `Chạy ${basename(program)}` : 'Lệnh shell';
  }
  if (/^(Agent|Task)$/.test(name)) return safeText(input.description || input.subagent_type || 'Ủy quyền agent');
  if (/^Task/.test(name)) return safeText(input.subject || `Task ${input.taskId || ''}`);
  if (/^mcp__/.test(name)) return 'MCP tool';
  return safeText(name);
}
const field = (value) => typeof value === 'string' && value.length ? safeText(value, 180) : undefined;
export function normalizeHook(input, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || typeof input.session_id !== 'string' || !input.session_id) return [];
  const hook = input.hook_event_name;
  const timestamp = new Date(now).toISOString();
  const agentId = field(input.agent_id) || 'main';
  const base = {
    id: randomUUID(), timestamp, sessionId: input.session_id.slice(0, 256), agentId,
    project: safeText(basename(input.cwd || 'Unknown project'), 100),
    cwd: safeText(String(input.cwd || '').replace(homedir(), '~'), 300),
    agentType: field(input.agent_type),
  };
  const make = (type, extra = {}) => ({ ...base, id: randomUUID(), type, ...extra });
  if (hook === 'SessionStart') return [make('session.start', { agentId: 'main', name: 'Điều phối', model: field(input.model), status: 'idle' })];
  if (hook === 'SessionEnd') return [make('session.end', { status: 'completed' })];
  if (hook === 'UserPromptSubmit') return [make('turn.start')];
  if (hook === 'Stop') return [make('turn.end', { status: 'idle' })];
  if (hook === 'StopFailure') return [make('turn.end', { status: 'error', summary: 'Lượt kết thúc do lỗi runtime' })];
  if (hook === 'SubagentStart') return [make('agent.start', {
    name: field(input.agent_type) || 'Subagent', parentId: field(input.parent_agent_id) || null,
  })];
  if (hook === 'SubagentStop') return [make('agent.end', { name: field(input.agent_type), status: 'completed' })];
  if (hook === 'TeammateIdle') return input.agent_id ? [make('turn.end', { name: field(input.teammate_name), status: 'idle' })] : [];
  if (hook === 'PostModelSwitch') return [make('usage', { scope: 'agent', model: field(input.to_model) })];
  if (hook === 'Notification') {
    if (['permission_prompt', 'elicitation_dialog', 'agent_needs_input', 'idle_prompt'].includes(input.notification_type))
      return [make('waiting', { summary: input.notification_type === 'permission_prompt' ? 'Chờ cấp quyền' : 'Chờ phản hồi', status: 'waiting' })];
    return [];
  }
  if (hook === 'TaskCompleted') return [make('task.update', { taskRecord: {
    id: field(input.task_id), subject: safeText(input.task_subject), status: 'completed', owner: field(input.teammate_name) || null,
  } })];
  const name = field(input.tool_name);
  if (!name) return [];
  const ti = input.tool_input || {};
  const tool = { toolId: field(input.tool_use_id) || base.id, toolName: name,
    summary: toolSummary(name, ti, input.cwd), file: safePath(ti.file_path || ti.notebook_path, input.cwd) };
  if (hook === 'PermissionRequest') return [make('waiting', { ...tool, status: 'waiting', summary: `Chờ quyền: ${name}` })];
  if (hook === 'PermissionDenied') return [make('tool.error', { ...tool, status: 'denied', summary: `Quyền bị từ chối: ${name}` })];
  if (hook === 'PreToolUse') {
    const events = [make('tool.start', tool)];
    if (name === 'AskUserQuestion') events.push(make('waiting', { summary: 'Chờ câu trả lời' }));
    return events;
  }
  if (hook === 'PostToolUseFailure') return [make('tool.error', { ...tool, status: input.is_interrupt ? 'cancelled' : 'error', durationMs: input.duration_ms, summary: input.is_interrupt ? 'Tool bị ngắt' : tool.summary })];
  if (hook !== 'PostToolUse') return [];
  const response = input.tool_response;
  const failed = response && typeof response === 'object' && (response.is_error === true || response.isError === true || (typeof response.exit_code === 'number' && response.exit_code !== 0));
  const events = [make(failed ? 'tool.error' : 'tool.end', { ...tool, status: failed ? 'error' : 'success', durationMs: input.duration_ms })];
  // PostToolUse is after success; pre-action task hooks could later be blocked by another hook.
  if (name === 'TaskCreate' && !failed) {
    const taskId = response?.task?.id || response?.taskId || response?.id || (typeof response === 'string' ? response.match(/(?:Task\s*#|task[_ ]?id[:= ]+)([\w-]+)/i)?.[1] : null);
    if (taskId) events.push(make('task.update', { taskRecord: { id: String(taskId), subject: safeText(ti.subject), status: 'pending', blockedBy: [], owner: null } }));
  }
  if (name === 'TaskUpdate' && !failed && ti.taskId) events.push(make('task.update', { taskRecord: {
    id: String(ti.taskId), ...(ti.subject ? { subject: safeText(ti.subject) } : {}),
    ...(ti.status ? { status: field(ti.status) } : {}), ...(ti.owner ? { owner: field(ti.owner) } : {}),
    ...(Array.isArray(ti.addBlockedBy) ? { addBlockedBy: ti.addBlockedBy.map(x => safeText(String(x), 100)) } : {}),
  } }));
  return events;
}

export function normalizeUsage(input, { now = Date.now() } = {}) {
  if (!input || typeof input.sessionId !== 'string' || !input.sessionId) return [];
  if (input.type === 'model.start' || input.type === 'model.end') {
    const at = typeof input.timestamp === 'string' ? Date.parse(input.timestamp) : NaN;
    const requestId = field(input.requestId);
    const agentId = field(input.agentId);
    // Phase writes are asynchronous. Keep the observed time so end-before-start
    // file arrival cannot leave a finished request falsely active.
    if (!requestId || !agentId || !Number.isFinite(at)) return [];
    return [{ id: randomUUID(), timestamp: new Date(at).toISOString(), type: input.type,
      sessionId: input.sessionId.slice(0, 256), agentId, requestId, model: field(input.model) }];
  }
  if (input.type === 'agent.metadata' && typeof input.agentId === 'string') return [{
    id: randomUUID(), timestamp: new Date(now).toISOString(), type: 'agent.metadata',
    sessionId: input.sessionId.slice(0, 256), agentId: field(input.agentId),
    parentId: field(input.parentId) || null, name: field(input.name), agentType: field(input.agentType), model: field(input.model),
  }];
  if (input.type !== 'usage') return [];
  const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  const tokens = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) if (num(input.tokens?.[key]) !== undefined) tokens[key] = input.tokens[key];
  return [{ id: randomUUID(), timestamp: new Date(now).toISOString(), type: 'usage',
    sessionId: input.sessionId.slice(0, 256), agentId: field(input.agentId), scope: input.scope === 'agent' ? 'agent' : 'session',
    model: field(input.model), ...(Object.keys(tokens).length ? { tokens } : {}),
    ...(Object.hasOwn(input, 'costUsd') ? { costUsd: num(input.costUsd) ?? null } : {}),
    costEstimated: true, costIncomplete: input.costIncomplete === true,
    ...(Object.hasOwn(input, 'contextPercent') ? { contextPercent: num(input.contextPercent) === undefined ? null : Math.min(100, input.contextPercent) } : {}),
    rateLimits: Array.isArray(input.rateLimits) ? input.rateLimits.slice(0, 10).map(l => ({ kind: field(l.kind), percentUsed: num(l.percentUsed), resetsAt: l.resetsAt })) : undefined,
  }];
}
