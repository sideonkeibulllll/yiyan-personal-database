/**
 * Chat 页底部输入区 - 工具栏（数据/最近/思考/MCP）、MCP 类型选择、输入框
 *
 * 状态与业务逻辑由父组件 ChatPage 持有，本组件只负责展示。
 */
import type { KeyboardEvent, RefObject } from 'react';
import { ENTRY_TOOLS, TODO_TOOLS } from '@/services/chatBridge';
import { IconUpload, IconBrain, IconTool, IconClose, IconBack, IconSendAlt } from '@/components/icons';
import type { ThinkingEffort } from '../chatTypes';

interface ChatInputAreaProps {
  pickerSelectedCount: number;
  onOpenPicker: () => void;
  recentPickerEnabled: boolean;
  onToggleRecent: (enabled: boolean) => void;
  thinkingEnabled: boolean;
  onToggleThinking: () => void;
  thinkingEffort: ThinkingEffort;
  onToggleEffort: () => void;
  mcpEnabled: boolean;
  mcpPickerOpen: boolean;
  mcpActiveTools: string[];
  onToggleMcp: () => void;
  onCloseMcpPicker: () => void;
  onSetMcpTools: (toolNames: string[]) => void;
  mcpSearchCount: number;
  onOpenMcpResults: () => void;
  input: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  isLoading: boolean;
  onSend: () => void;
  onStop: () => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

export function ChatInputArea({
  pickerSelectedCount,
  onOpenPicker,
  recentPickerEnabled,
  onToggleRecent,
  thinkingEnabled,
  onToggleThinking,
  thinkingEffort,
  onToggleEffort,
  mcpEnabled,
  mcpPickerOpen,
  mcpActiveTools,
  onToggleMcp,
  onCloseMcpPicker,
  onSetMcpTools,
  mcpSearchCount,
  onOpenMcpResults,
  input,
  onInputChange,
  onKeyDown,
  isLoading,
  onSend,
  onStop,
  textareaRef,
}: ChatInputAreaProps) {
  return (
    <footer className="chat-input-area glass">
      <div className="input-toolbar">
        {/* 上传按钮：打开条目选择器 */}
        <button
          className={`toolbar-btn ${pickerSelectedCount > 0 ? 'active upload' : ''}`}
          onClick={onOpenPicker}
          title="选择数据作为上下文"
        >
          <IconUpload size={16} />
          <span>数据</span>
        </button>

        {/* e.2: 「最近」勾选项 */}
        <label className="recent-picker-toggle" title="自动选中最近30条">
          <input
            type="checkbox"
            checked={recentPickerEnabled}
            onChange={e => onToggleRecent(e.target.checked)}
          />
          <span>最近</span>
        </label>

        {/* 深度思考 */}
        <button
          className={`toolbar-btn ${thinkingEnabled ? 'active thinking' : ''}`}
          onClick={onToggleThinking}
          title="深度思考模式"
        >
          <IconBrain />
          <span>思考</span>
        </button>

        {/* 思考强度 */}
        {thinkingEnabled && (
          <button
            className={`toolbar-btn effort-btn ${thinkingEffort}`}
            onClick={onToggleEffort}
            title="思考强度"
          >
            {thinkingEffort === 'max' ? 'MAX' : 'High'}
          </button>
        )}

        {/* MCP 开关 - 点击展开选择器面板 */}
        <button
          className={`toolbar-btn ${mcpEnabled ? 'active mcp' : ''}`}
          onClick={onToggleMcp}
          title="MCP 桥梁通道（对话级持久化）"
        >
          <IconTool />
          <span>MCP{mcpActiveTools.length > 0 ? ` (${mcpActiveTools.length})` : ''}</span>
        </button>

        {/* MCP 类型选择面板 */}
        {mcpPickerOpen && (
          <div className="mcp-picker-panel glass">
            <div className="mcp-picker-header">
              <h4>选择 MCP 类型</h4>
              <button className="mcp-picker-close" onClick={onCloseMcpPicker}>
                <IconClose />
              </button>
            </div>
            <div className="mcp-picker-options">
              <button
                className="mcp-picker-option"
                onClick={() => {
                  const next = [...new Set([...mcpActiveTools, ...ENTRY_TOOLS])];
                  onSetMcpTools(next);
                  onCloseMcpPicker();
                }}
              >
                <div className="mcp-picker-icon">📊</div>
                <div className="mcp-picker-text">
                  <div className="mcp-picker-title">数据卡片 MCP</div>
                  <div className="mcp-picker-desc">为本次对话启用数据卡片工具</div>
                </div>
              </button>
              <button
                className="mcp-picker-option"
                onClick={() => {
                  const next = [...new Set([...mcpActiveTools, ...TODO_TOOLS])];
                  onSetMcpTools(next);
                  onCloseMcpPicker();
                }}
              >
                <div className="mcp-picker-icon">✅</div>
                <div className="mcp-picker-text">
                  <div className="mcp-picker-title">待办卡片 MCP</div>
                  <div className="mcp-picker-desc">为本次对话启用待办工具</div>
                </div>
              </button>
              {/* 清空工具按钮：方便用户取消已选的工具 */}
              {mcpActiveTools.length > 0 && (
                <button
                  className="mcp-picker-option"
                  onClick={() => {
                    onSetMcpTools([]);
                    onCloseMcpPicker();
                  }}
                >
                  <div className="mcp-picker-icon">🗑️</div>
                  <div className="mcp-picker-text">
                    <div className="mcp-picker-title">清空已启用工具</div>
                    <div className="mcp-picker-desc">当前已启用 {mcpActiveTools.length} 个工具</div>
                  </div>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 搜索回看按钮 */}
        {mcpEnabled && mcpSearchCount > 0 && (
          <button
            className="toolbar-btn mcp-back"
            onClick={onOpenMcpResults}
            title="重新选择上下文"
          >
            <IconBack />
            <span>{mcpSearchCount}</span>
          </button>
        )}
      </div>

      <div className="input-row">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="输入消息… (Enter 发送, Shift+Enter 换行)"
          value={input}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={isLoading}
        />
        {isLoading ? (
          <button className="chat-send-btn stop" onClick={onStop} title="停止生成">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
        ) : (
          <button className="chat-send-btn" onClick={onSend} disabled={!input.trim()}>
            <IconSendAlt />
          </button>
        )}
      </div>
    </footer>
  );
}