/**
 * Chat 页头部 - 模型选择器、余额查询、分享/清空/导出操作
 *
 * 状态与业务逻辑由父组件 ChatPage 持有，本组件只负责展示。
 */
import { IconMenu, IconChevronDown, IconTool, IconShare, IconTrash, IconClose } from '@/components/icons';
import { MODEL_OPTIONS } from '../chatUtils';

interface BalanceInfo {
  currentBalance: number | null;
  lastBalance: number | null;
  isQuerying: boolean;
}

interface ChatHeaderProps {
  isMobile: boolean;
  onOpenSidebar: () => void;
  title: string;
  currentSessionModel: string;
  currentModel: string;
  modelPickerOpen: boolean;
  onToggleModelPicker: () => void;
  onSelectModel: (model: string) => void;
  balanceInfo: BalanceInfo;
  onQueryBalance: () => void;
  messagesCount: number;
  mcpResultsCount: number;
  onOpenMcpResults: () => void;
  selectMode: boolean;
  selectedCount: number;
  isExporting: boolean;
  onEnterSelectMode: () => void;
  onExitSelectMode: () => void;
  onClearMessages: () => void;
  onExportSelected: () => void;
}

export function ChatHeader({
  isMobile,
  onOpenSidebar,
  title,
  currentSessionModel,
  currentModel,
  modelPickerOpen,
  onToggleModelPicker,
  onSelectModel,
  balanceInfo,
  onQueryBalance,
  messagesCount,
  mcpResultsCount,
  onOpenMcpResults,
  selectMode,
  selectedCount,
  isExporting,
  onEnterSelectMode,
  onExitSelectMode,
  onClearMessages,
  onExportSelected,
}: ChatHeaderProps) {
  const currentModelLabel = MODEL_OPTIONS.find(m => m.value === currentSessionModel)?.label || currentModel;

  return (
    <header className="chat-header">
      {isMobile && (
        <button className="chat-menu-btn" onClick={onOpenSidebar}>
          <IconMenu />
        </button>
      )}
      {/* 模型选择器 */}
      <div className="model-picker-wrapper">
        <button
          className={`model-picker-btn ${modelPickerOpen ? 'open' : ''}`}
          onClick={onToggleModelPicker}
        >
          <span className="model-picker-label">{currentModelLabel}</span>
          <IconChevronDown size={12} strokeWidth={2} />
        </button>
        {modelPickerOpen && (
          <div className="model-picker-dropdown">
            {MODEL_OPTIONS.map(opt => (
              <div
                key={opt.value || 'default'}
                className={`model-option ${currentSessionModel === opt.value ? 'active' : ''}`}
                onClick={() => onSelectModel(opt.value)}
              >
                {opt.label}
                {currentSessionModel === opt.value && <span className="check">✓</span>}
              </div>
            ))}

            <div className="model-picker-divider" />

            <div
              className={`model-option balance-option ${balanceInfo.isQuerying ? 'disabled' : ''}`}
              onClick={() => !balanceInfo.isQuerying && onQueryBalance()}
            >
              <span className="balance-label">
                {balanceInfo.isQuerying
                  ? '查询中...'
                  : balanceInfo.currentBalance !== null
                    ? `${balanceInfo.currentBalance.toFixed(2)} 元`
                    : '余额查询'}
              </span>
              {balanceInfo.currentBalance !== null && !balanceInfo.isQuerying && (
                <span className="balance-refresh-hint">点击刷新</span>
              )}
            </div>

            {balanceInfo.currentBalance !== null && balanceInfo.lastBalance !== null && (
              <div className="balance-usage-info">
                使用 {(balanceInfo.lastBalance - balanceInfo.currentBalance).toFixed(2)} 元
              </div>
            )}
          </div>
        )}
      </div>

      <h1 className="chat-header-title">{title}</h1>

      {/* MCP 搜索结果回看按钮 */}
      {mcpResultsCount > 0 && !selectMode && (
        <button
          className="chat-mcp-back-btn"
          onClick={onOpenMcpResults}
          title={`查看已选 ${mcpResultsCount} 条上下文`}
        >
          <IconTool />
          <span className="mcp-back-count">{mcpResultsCount}</span>
        </button>
      )}

      {messagesCount > 0 && !selectMode && (
        <>
          <button className="chat-share-btn" onClick={onEnterSelectMode} title="分享对话">
            <IconShare />
          </button>
          <button className="chat-clear-btn" onClick={onClearMessages} title="清空对话">
            <IconTrash size={14} />
          </button>
        </>
      )}

      {/* 选中模式：取消 + 已选数量 + 导出按钮 */}
      {selectMode && (
        <>
          <button className="chat-select-cancel-btn" onClick={onExitSelectMode} title="取消">
            <IconClose size={14} strokeWidth={2} />
          </button>
          <span className="chat-select-count">
            已选 {selectedCount} 条
          </span>
          <button
            className="chat-export-btn"
            onClick={onExportSelected}
            disabled={selectedCount === 0 || isExporting}
            title="导出为图片"
          >
            <IconShare />
            <span>导出为图片</span>
          </button>
        </>
      )}
    </header>
  );
}