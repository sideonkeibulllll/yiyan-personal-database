/**
 * Chat 页消息列表 - 消息渲染、思维链、工具调用结果、选中模式
 *
 * 状态与业务逻辑由父组件 ChatPage 持有，本组件只负责展示。
 */
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
}

export function ChatMessageList({
  messages,
  selectMode,
  selectedMsgIds,
  isLoading,
  hasApiKey,
  containerRef,
  endRef,
  onToggleSelect,
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
        messages.map(msg => {
          const isSelectable = selectMode && msg.role !== 'tool';
          const isSelected = selectedMsgIds.has(msg.id);
          return (
          <div
            key={msg.id}
            className={`chat-message ${msg.role} ${selectMode ? 'select-mode' : ''} ${isSelected ? 'selected' : ''}`}
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
              {msg.role === 'user' ? '我' : msg.role === 'tool' ? '🔧' : 'AI'}
            </div>
            <div className="message-body">
              {/* 思维链内容（可折叠） */}
              {msg.reasoningContent && (
                <details className="reasoning-block" open={isLoading && msg.id === messages[messages.length - 1]?.id}>
                  <summary className="reasoning-summary">
                    <IconBrain />
                    <span>思考过程</span>
                    {msg.thinkingEffort && <span className="reasoning-effort">{msg.thinkingEffort}</span>}
                  </summary>
                  <div className="reasoning-content">{msg.reasoningContent}</div>
                </details>
              )}

              <div
                className="message-content markdown-body"
                dangerouslySetInnerHTML={{
                  __html: msg.role === 'assistant'
                    ? renderMarkdown(msg.content || '…')
                    : renderMarkdown(msg.content)
                }}
              />

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

              {msg.model && msg.role === 'assistant' && (
                <span className="message-model-tag">{msg.model}</span>
              )}
              <span className="message-time">{formatTime(msg.timestamp)}</span>
            </div>
          </div>
          );
        })
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