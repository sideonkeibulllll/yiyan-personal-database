/**
 * Chat 流式请求（SSE）封装
 */
import type { ToolCallDelta } from '@/services/chatBridge';
import type { ThinkingEffort } from './chatTypes';

export interface StreamCallbacks {
  onReasoning: (chunk: string) => void;
  onContent: (chunk: string) => void;
  /** 收到 tool_calls 增量时触发，由调用方累积并执行 */
  onToolCall?: (deltas: ToolCallDelta[]) => void;
}

/**
 * 流式调用 chat/completions。
 * - messages: 完整对话历史（包含 system/user/assistant/tool 各角色）
 * - toolsPayload: 启用工具的 OpenAI schema 数组；为空数组则不传 tools 字段
 * - finishReason: 输出参数，返回 choices[0].finish_reason（'stop' | 'tool_calls' | 'length' | ...）
 *   调用方据此判断是否需要进入 agent loop
 */
export async function streamChatCompletion(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string; name?: string }>,
  thinkingEnabled: boolean,
  reasoningEffort: ThinkingEffort | null,
  toolsPayload: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<{ finishReason: string | null }> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };

  // 工具 schema（仅在有启用工具时传）
  if (toolsPayload.length > 0) {
    body.tools = toolsPayload;
    // 让模型自主决定何时调用，必要时可改为 'required' 强制调用
    body.tool_choice = 'auto';
  }

  // 思考模式参数
  if (thinkingEnabled) {
    body.thinking = { type: 'enabled' };
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }
  } else {
    body.thinking = { type: 'disabled' };
  }

  // 非思考模式下才传 temperature
  if (!thinkingEnabled) {
    body.temperature = 0.7;
    body.max_tokens = 4096;
  }

  // On Android/iOS, CapacitorHttp patches window.fetch to use native HTTP.
  // Native HTTP doesn't support streaming responses (response.body.getReader()).
  // Use the original WebView fetch (saved as CapacitorWebFetch) for streaming.
  const fetchFn = (window as any).CapacitorWebFetch || fetch;

  const response = await fetchFn(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData?.error?.message || `请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  let finishReason: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;

        // finish_reason 在最后一帧出现
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        if (!delta) continue;

        // 思维链内容
        if (delta.reasoning_content) {
          callbacks.onReasoning(delta.reasoning_content);
        }
        // 正文内容
        if (delta.content) {
          callbacks.onContent(delta.content);
        }
        // 工具调用增量（流式期间累积）
        if (delta.tool_calls && Array.isArray(delta.tool_calls) && callbacks.onToolCall) {
          callbacks.onToolCall(delta.tool_calls as ToolCallDelta[]);
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  return { finishReason };
}