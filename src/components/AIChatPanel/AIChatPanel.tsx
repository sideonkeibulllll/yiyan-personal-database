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

export function AIChatPanel({ entry, onClose }: AIChatPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息
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
      // 设置 AI 配置
      ai.setConfig({
        ...settings.ai,
        prompts: settings.ai.prompts,
      });

      // 构建上下文
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

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="ai-chat-panel">
      {/* 头部 */}
      <div className="chat-header">
        <div className="header-info">
          <h3 className="header-title">AI 对话</h3>
          <p className="header-subtitle">围绕当前条目展开讨论</p>
        </div>
        <button className="header-close" onClick={onClose}>✕</button>
      </div>

      {/* 当前条目预览 */}
      <div className="entry-preview glass">
        <p className="preview-text">{entry.content}</p>
      </div>

      {/* 消息列表 */}
      <div className="messages-container">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <span className="empty-icon">💬</span>
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

      {/* 输入框 */}
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
