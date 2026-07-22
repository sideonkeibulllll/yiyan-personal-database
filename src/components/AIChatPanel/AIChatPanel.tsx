/**
 * AI 对话面板组件
 * 基于条目内容与 AI 展开讨论
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDatabase } from '@/services/database';
import ai from '@/services/ai';
import type { Entry } from '@/types';
import './AIChatPanel.css';

interface AIChatPanelProps {
  entry: Entry;
  onClose: () => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** X (close) icon */
const XCloseSvg = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** Message circle icon */
const MessageCircleSvg = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

export function AIChatPanel({ entry, onClose }: AIChatPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    if (!settings.ai.apiKey) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: '请先配置 AI API Key（在设置页面）',
        timestamp: Date.now(),
      }]);
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      ai.setConfig({
        ...settings.ai,
        prompts: settings.ai.prompts,
      });

      const db = await getDatabase();
      const recentEntries = await db.getRecentEntries(settings.context.recentWindow);
      const recentContext = recentEntries
        .map(e => e.content)
        .slice(0, 5)
        .join('\n---\n');

      const systemPrompt = settings.ai.prompts.dialogueContext
        .replace('{longTermMemory}', '暂无长期记忆')
        .replace('{recentEntries}', recentContext || '暂无')
        .replace('{currentEntry}', entry.content);

      const fullMessage = `当前条目：${entry.content}\n\n用户问题：${input.trim()}`;

      const response = await ai.chat({
        systemPrompt,
        userMessage: fullMessage,
      });

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `出错了: ${(error as Error).message}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, settings, entry]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="ai-chat-panel">
      <div className="chat-header">
        <div className="header-info">
          <h3 className="header-title">AI 对话</h3>
          <p className="header-subtitle">围绕当前条目展开讨论</p>
        </div>
        <button className="header-close" onClick={onClose}><XCloseSvg /></button>
      </div>

      <div className="entry-preview glass">
        <p className="preview-text">{entry.content}</p>
      </div>

      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <span className="empty-icon"><MessageCircleSvg /></span>
            <p className="empty-text">开始与 AI 对话</p>
            <p className="empty-hint">可以询问关于这条目的问题</p>
          </div>
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              className={`message ${msg.role}`}
            >
              <div className="message-bubble">
                {msg.content}
              </div>
              <span className="message-time">
                {new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          ))
        )}

        {isLoading && (
          <div className="message assistant">
            <div className="message-bubble loading">
              <span className="loading-dot" />
              <span className="loading-dot" />
              <span className="loading-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-wrapper glass">
        <textarea
          className="chat-input"
          placeholder="输入问题..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
        >
          发送
        </button>
      </div>
    </div>
  );
}

export type { AIChatPanelProps };