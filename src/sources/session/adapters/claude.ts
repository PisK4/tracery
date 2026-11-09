/**
 * Claude Code 会话适配器。
 *
 * 一条 assistant 记录是一个内容块；同一条响应按 `message.id` 会写成多行
 * （thinking / text / tool_use 各一行，usage 相同）。调用单位是 `message.id`：
 * 块按到达顺序合并，遇到下一条用户消息或下一个 message id 时结算。
 *
 * 请求体是截至该 assistant 消息之前的消息窗口；user 行里的 tool_result 原样
 * 进入窗口。`isSidechain`（子代理）行本轮跳过，不污染主会话窗口。
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { basename } from 'node:path';
import { normalizeResponseId } from '../../magpie/mapping';
import { discoverJsonl, jsonlBatch, jsonlRead } from '../read';
import type { SourceCursor, SourceRead } from '../../files';
import type {
  SessionAdapter, SessionApplyResult, SessionCall, SessionFile, SessionParseResult, SessionTitle,
} from '../types';
import { canonicalSessionId, isNestedSessionFile, sessionConvKey, titleTextOf } from '../types';

type ClaudeMessage = { role: string; content: unknown };

type Pending = {
  messageId: string;
  sessionId: string;
  convKey: string;
  startedMs: number;
  model: string | null;
  usage: SessionCall['usage'];
  blocks: unknown[];
  requestMessages: unknown[];
  startOffset: number;
  cwd: string | null;
};

type ClaudeState = {
  sessionId: string | null;
  cwd: string | null;
  messages: ClaudeMessage[];
  lastMessageMs: number | null;
  pending: Pending | null;
  /** 本批有新 assistant 行才补发；重放不算，避免每批重复刷新同一笔。 */
  liveDirty: boolean;
  title: string | null;
  titleSessionId: string | null;
  titleOffset: number | null;
  firstMessageMs: number | null;
  /** 子代理文件名不是会话 id；主文件名是标题归属的兜底。 */
  fileSessionId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function timestampOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** 一条消息的 content 可能是数组或字符串；窗口保持原形。 */
function contentOf(message: Record<string, unknown>): unknown[] | null {
  const content = message.content;
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return null;
}

function usageOf(usage: Record<string, unknown>): SessionCall['usage'] {
  const input = numberOrNull(usage.input_tokens);
  const output = numberOrNull(usage.output_tokens);
  if (input === null || output === null) return null;
  // Anthropic 的 input_tokens 不含缓存；缓存字段缺失按 0（协议保证过，不猜）。
  return {
    input,
    output,
    cacheRead: numberOrNull(usage.cache_read_input_tokens) ?? 0,
    cacheWrite: numberOrNull(usage.cache_creation_input_tokens) ?? 0,
  };
}

function finalize(state: ClaudeState): SessionCall | null {
  const pending = state.pending;
  if (pending === null) return null;
  // 同一响应的块只进窗口一次；结算后 pending 清空。
  state.messages = [...state.messages, { role: 'assistant', content: pending.blocks }];
  state.pending = null;
  return {
    sessionId: pending.sessionId,
    subagentId: null,
    convKey: pending.convKey,
    callId: pending.messageId,
    sortOffset: pending.startOffset,
    parentSessionId: null,
    startedMs: pending.startedMs,
    model: pending.model,
    responseIdNorm: normalizeResponseId(pending.messageId),
    turnRef: null,
    usage: pending.usage,
    reasoning: null,
    requestMessages: pending.requestMessages,
    replyContent: pending.blocks,
    cwd: pending.cwd,
  };
}

function applyEvent(state: ClaudeState, event: SessionParseResult & { kind: 'event' }): SessionApplyResult {
  const record = event.value;
  if (!isRecord(record)) return { state, calls: [], error: 'claude_line_invalid', sessionId: state.sessionId };
  const type = textOf(record.type);
  const sessionId = textOf(record.sessionId) ?? textOf(record.session_id);
  const cwd = textOf(record.cwd);
  if (cwd !== null) state.cwd = cwd;
  // 标题行不参与调用归约，也不能用行内 id 覆盖主会话身份。
  if (type === 'ai-title') {
    if (record.isSidechain === true) {
      return { state, calls: [], error: null, sessionId: state.sessionId };
    }
    const title = titleTextOf(record.aiTitle) ?? titleTextOf(record.title);
    // 同一标题重复落 raw 时不挪证据位置，避免批末重复写 session_title。
    if (title !== null && title !== state.title) {
      state.title = title;
      state.titleSessionId = state.sessionId ?? state.fileSessionId;
      state.titleOffset = event.offset;
    }
    return { state, calls: [], error: null, sessionId: state.sessionId };
  }
  if (sessionId !== null) state.sessionId = canonicalSessionId(sessionId);
  if (type !== 'assistant' && type !== 'user') {
    return { state, calls: [], error: null, sessionId: state.sessionId };
  }
  const message = record.message;
  if (!isRecord(message)) {
    return { state, calls: [], error: 'claude_message_body_missing', sessionId: state.sessionId };
  }
  if (record.isSidechain === true) {
    return { state, calls: [], error: null, sessionId: state.sessionId };
  }
  const content = contentOf(message);
  if (content === null) {
    return { state, calls: [], error: 'claude_message_content_invalid', sessionId: state.sessionId };
  }
  const atMs = timestampOf(record.timestamp);
  const session = state.sessionId;
  if (session === null) {
    return { state, calls: [], error: 'claude_session_missing', sessionId: null };
  }
  if (state.firstMessageMs === null && atMs !== null) state.firstMessageMs = atMs;

  if (type === 'user') {
    const calls: SessionCall[] = [];
    const settled = finalize(state);
    if (settled !== null) calls.push(settled);
    state.messages = [...state.messages, { role: textOf(message.role) ?? 'user', content }];
    state.lastMessageMs = atMs ?? state.lastMessageMs;
    return { state, calls, error: null, sessionId: session };
  }

  const messageId = textOf(message.id);
  if (messageId === null) {
    return { state, calls: [], error: 'claude_message_id_missing', sessionId: session };
  }
  const calls: SessionCall[] = [];
  if (state.pending !== null && state.pending.messageId !== messageId) {
    const settled = finalize(state);
    if (settled !== null) calls.push(settled);
  }
  if (state.pending === null) {
    const startedMs = state.lastMessageMs ?? atMs;
    if (startedMs === null) {
      return { state, calls: [], error: 'claude_message_time_missing', sessionId: session };
    }
    const usageRecord = isRecord(message.usage) ? message.usage : null;
    state.pending = {
      messageId,
      sessionId: session,
      convKey: sessionConvKey(session),
      startedMs,
      model: textOf(message.model),
      usage: usageRecord === null ? null : usageOf(usageRecord),
      blocks: [...content],
      requestMessages: [...state.messages],
      startOffset: event.offset,
      cwd: state.cwd,
    };
  } else {
    // 同一响应的后续内容块：合并进 reply，不重复建调用。
    state.pending = { ...state.pending, blocks: [...state.pending.blocks, ...content] };
  }
  if (event.replay !== true) state.liveDirty = true;
  return { state, calls, error: null, sessionId: session };
}

export const claudeAdapter: SessionAdapter = {
  agent: 'claude',
  sourceKind: 'claude_session',
  issueKind: 'claude_session',
  evidenceKind: 'claude_session_call',
  bodyProtocol: 'anthropic',
  sortSource: 'claude_session',
  mutable: true,
  refreshOnDuplicate: true,
  replaysState: true,
  batch: jsonlBatch(),

  roots(env, home = homedir()) {
    const base = env.CLAUDE_CONFIG_DIR?.trim();
    return [join(base !== undefined && base.length > 0 ? base : join(home, '.claude'), 'projects')];
  },

  discover(root, cursorFor) {
    return discoverJsonl(root, cursorFor);
  },

  read(file: SessionFile, cursor: SourceCursor | null): Promise<SourceRead> {
    return jsonlRead(file, cursor, 'claude_session');
  },

  parse(text: string): SessionParseResult {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return { kind: 'invalid', reason: 'claude_invalid_json' };
    }
    if (!isRecord(value)) return { kind: 'invalid', reason: 'claude_invalid_object' };
    const type = textOf(value.type) ?? 'other';
    const atMs = timestampOf(value.timestamp);
    const sessionId = textOf(value.sessionId) ?? textOf(value.session_id);
    // 只保留会进状态的行；api-request/blob、attachment 等大块不落原始层。
    if (type !== 'assistant' && type !== 'user' && type !== 'ai-title') return { kind: 'ignore' };
    return { kind: 'event', lineType: type, atMs, sessionId, offset: 0, value };
  },

  emptyState(file?: SessionFile): ClaudeState {
    const main = file === undefined || isNestedSessionFile(file, ['subagents'])
      ? null : basename(file.name, '.jsonl');
    const id = main === null ? null : canonicalSessionId(main);
    return {
      sessionId: id,
      cwd: null, messages: [], lastMessageMs: null,
      pending: null, liveDirty: false,
      title: null, titleSessionId: null, titleOffset: null, firstMessageMs: null,
      fileSessionId: id,
    };
  },

  apply(state, event) {
    return applyEvent(state as ClaudeState, event);
  },

  flush(state) {
    const current = state as ClaudeState;
    if (!current.liveDirty || current.pending === null) {
      return { state, calls: [], error: null, sessionId: current.sessionId };
    }
    const call = finalize(current);
    current.liveDirty = false;
    return { state, calls: call === null ? [] : [call], error: null, sessionId: current.sessionId };
  },

  sourceTitle(state, file): SessionTitle | null {
    const current = state as ClaudeState;
    if (current.title === null || current.titleSessionId === null
      || isNestedSessionFile(file, ['subagents'])) return null;
    return {
      text: current.title,
      sessionId: current.titleSessionId,
      atMs: current.firstMessageMs,
      ref: `${file.name}:${current.titleOffset ?? 0}`,
      facts: { lineType: 'ai-title' },
    };
  },
};