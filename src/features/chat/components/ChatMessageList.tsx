/**
 * Chat 页消息列表 - 消息渲染、思维链、工具调用结果、危险操作确认卡片、选中模式
 *
 * 状态与业务逻辑由父组件 ChatPage 持有，本组件只负责展示。
 *
 * 性能说明：单条消息由 React.memo 隔离、Markdown 渲染结果按 content 缓存。
 * 流式期间父组件高频更新 messages 时，只有「正在写入的最后一条」消息重渲染，
 * 历史消息（引用未变）全部跳过 —— 修复长对话下流式卡顿的主因之一。
 */
import { memo, useMemo } from 'react';
import type { RefObject } from 'react';
import { renderMarkdown } from '@/utils/markdown';
import { IconMessage, IconCheck, IconBrain } from '@/components/icons';
import { formatTime } from '../chatUtils';
import type { ChatMessage } from '../chatTypes';

interface ChatMessageListProps {
  messages: ChatMessage[];
  selectMode: boolean;
  selectedMsgIds: Set<string>;
  isLoading: boolean;
  hasApiKey: boolean;
  containerRef: RefObject<HTMLDivElement>;
  endRef: RefObject<HTMLDivElement>;
  onToggleSelect: (msgId: string) => void;
  /** 危险操作确认：confirmId + 是否批准 */
  onConfirmAction?: (confirmId: string, approved: boolean) => void;
}

/* === 单条消息（React.memo 隔离：props 全稳定时跳过重渲染）=== */
interface ChatMessageItemProps {
  msg: ChatMessage;
  selectMode: boolean;
  isSelected: boolean;
  /** 是否为「正在流式的最后一条消息」（控制思维链默认展开） */
  streamingActive: boolean;
  onToggleSelect: (msgId: string) => void;
  onConfirmAction?: (confirmId: string, approved: boolean) => void;
}

const ChatMessageItem = memo(function ChatMessageItem({
  msg,
  selectMode,
  isSelected,
  streamingActive,
  onToggleSelect,
  onConfirmAction,
}: ChatMessageItemProps) {
  const confirm = msg.confirmRequest;
  const isSelectable = selectMode && msg.role !== 'tool' && !confirm;

  // Markdown 渲染结果按 content 缓存：非流式消息的 content 不变 → 不重复解析
  const html = useMemo(
    () => (confirm ? '' : renderMarkdown(msg.role === 'assistant' ? (msg.content || '…') : msg.content)),
    [confirm, msg.role, msg.content],
  );

  return (
    <div
      className={`chat-message ${msg.role} ${selectMode ? 'select-mode' : ''} ${isSelected ? 'selected' : ''} ${confirm ? 'confirm-msg' : ''}`}
      data-msg-id={msg.id}
      onClick={isSelectable ? () => onToggleSelect(msg.id) : undefined}
    >
      {/* 选中模式下显示圆圈 checkbox */}
      {isSelectable && (
        <div className={`msg-select-checkbox ${isSelected ? 'checked' : ''}`}>
          {isSelected && <IconCheck />}
        </div>
      )}
      <div className="message-avatar">
        {confirm ? '⚠️' : msg.role === 'user' ? '我' : msg.role === 'tool' ? '🔧' : 'AI'}
      </div>
      <div className="message-body">
        {/* 思维链内容（可折叠） */}
        {msg.reasoningContent && (
          <details className="reasoning-block" open={streamingActive}>
            <summary className="reasoning-summary">
              <IconBrain />
              <span>思考过程</span>
              {msg.thinkingEffort && <span className="reasoning-effort">{msg.thinkingEffort}</span>}
            </summary>
            <div className="reasoning-content">{msg.reasoningContent}</div>
          </details>
        )}

        {/* 危险操作确认卡片（删除类工具） */}
        {confirm ? (
          <div className={`confirm-card ${confirm.status}`}>
            <div className="confirm-card-head">⚠️ 需要你确认</div>
            <div className="confirm-card-summary">{confirm.summary}</div>
            <div className="confirm-card-tool">工具：{confirm.toolName}</div>
            {confirm.status === 'pending' ? (
              <div className="confirm-card-actions">
                <button
                  className="confirm-btn cancel"
                  onClick={(e) => { e.stopPropagation(); onConfirmAction?.(confirm.id, false); }}
                >
                  取消
                </button>
                <button
                  className="confirm-btn approve"
                  onClick={(e) => { e.stopPropagation(); onConfirmAction?.(confirm.id, true); }}
                >
                  确认执行
                </button>
              </div>
            ) : (
              <div className="confirm-card-status">
                {confirm.status === 'approved' ? '✅ 已确认执行' : '🚫 已取消'}
              </div>
            )}
          </div>
        ) : msg.role === 'tool' ? (
          /* tool 消息：返回详情（长 JSON）默认折叠，点击展开 */
          <details className="tool-json-fold">
            <summary className="tool-json-fold-summary">查看工具返回详情</summary>
            <div className="message-content markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
          </details>
        ) : (
          <div className="message-content markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        )}

        {msg.isThinking && !msg.reasoningContent && (
          <span className="message-tag">深度思考 · {msg.thinkingEffort}</span>
        )}

        {msg.toolCallResults && msg.toolCallResults.length > 0 && (
          <div className="tool-calls">
            {msg.toolCallResults.map((tc, i) => (
              <div key={i} className={`tool-call-badge ${tc.success ? 'success' : 'error'}`}>
                🔧 {tc.name} {tc.success ? '✅' : '❌'}
              </div>
            ))}
          </div>
        )}

        {msg.model && msg.role === 'assistant' && !confirm && (
          <span className="message-model-tag">{msg.model}</span>
        )}
        <span className="message-time">{formatTime(msg.timestamp)}</span>
      </div>
    </div>
  );
});

export function ChatMessageList({
  messages,
  selectMode,
  selectedMsgIds,
  isLoading,
  hasApiKey,
  containerRef,
  endRef,
  onToggleSelect,
  onConfirmAction,
}: ChatMessageListProps) {
  return (
    <div className="chat-messages" ref={containerRef}>
      {messages.length === 0 ? (
        <div className="chat-welcome">
          <span className="welcome-icon"><IconMessage /></span>
          <h2 className="welcome-title">开始一段新对话</h2>
          <p className="welcome-hint">
            {hasApiKey ? '输入消息开始与 AI 对话' : '请先在设置页面配置 AI API Key'}
          </p>
        </div>
      ) : (
        messages.map((msg, idx) => (
          <ChatMessageItem
            key={msg.id}
            msg={msg}
            selectMode={selectMode}
            isSelected={selectedMsgIds.has(msg.id)}
            streamingActive={isLoading && idx === messages.length - 1}
            onToggleSelect={onToggleSelect}
            onConfirmAction={onConfirmAction}
          />
        ))
      )}

      {isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
        <div className="chat-message assistant">
          <div className="message-avatar">AI</div>
          <div className="message-body">
            <div className="message-content loading-dots">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
