/**
 * Chat 页底部输入区 - 工具栏（数据/图片/拍照/最近/思考/MCP）、MCP 工具多选、输入框
 *
 * 状态与业务逻辑由父组件 ChatPage 持有，本组件只负责展示。
 */
import type { ClipboardEvent, KeyboardEvent, RefObject } from 'react';
import { ENTRY_TOOLS, TODO_TOOLS, MEMO_TOOLS, SOUL_TOOLS } from '@/services/chatBridge';
import { IconUpload, IconBrain, IconTool, IconClose, IconBack, IconSendAlt, IconCheck, IconUndo, IconRedo, IconImage, IconCamera } from '@/components/icons';
import { VISION_UNSUPPORTED_HINT } from '@/utils/modelCapability';
import type { PendingChatImage, ThinkingEffort } from '../chatTypes';

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
  /** 撤销 / 重做（模拟 Ctrl+Z / Ctrl+Y，供手机端点击） */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** 是否移动端（决定输入框提示文案：手机没有 Ctrl 键） */
  isMobile: boolean;
  isLoading: boolean;
  onSend: () => void;
  onStop: () => void;
  textareaRef: RefObject<HTMLTextAreaElement>;

  /* === 图片输入（v3.5.3） === */
  /** 尚未发送的图片（预览条） */
  pendingImages: PendingChatImage[];
  /** 当前模型是否支持看图（false → 图片入口置灰） */
  visionSupported: boolean;
  /** 是否展示「拍照」入口（仅 Android 有原生相机） */
  showCameraButton: boolean;
  onPickImages: () => void;
  onTakePhoto: () => void;
  onRemovePendingImage: (id: string) => void;
  /** 粘贴图片（桌面端 Ctrl+V / 手机端剪贴板） */
  onPasteImages: (files: File[]) => void;
}

/** MCP 工具分组（面板上按组多选，勾选即启用整组工具） */
const MCP_GROUPS: { key: string; icon: string; title: string; desc: string; tools: string[] }[] = [
  { key: 'entry', icon: '📊', title: '数据卡片', desc: '搜索 / 创建 / 编辑 / 标签 / 星标 / 删除', tools: ENTRY_TOOLS },
  { key: 'todo', icon: '✅', title: '待办事项', desc: '搜索 / 创建 / 编辑 / 完成 / 删除 / 标签管理', tools: TODO_TOOLS },
  { key: 'memo', icon: '📝', title: '备忘录', desc: '搜索 / 读取 / 新建 / 追加 / 删除', tools: MEMO_TOOLS },
  { key: 'soul', icon: '🪞', title: 'Soul 事实档案', desc: '让 AI 查看事实库并提议变更（需你确认）', tools: SOUL_TOOLS },
];

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
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isMobile,
  isLoading,
  onSend,
  onStop,
  textareaRef,
  pendingImages,
  visionSupported,
  showCameraButton,
  onPickImages,
  onTakePhoto,
  onRemovePendingImage,
  onPasteImages,
}: ChatInputAreaProps) {
  // 切换某一组工具：选中则全部启用，取消则全部移除（保留其它组）
  const toggleGroup = (tools: string[], enable: boolean) => {
    const next = enable
      ? Array.from(new Set([...mcpActiveTools, ...tools]))
      : mcpActiveTools.filter(t => !tools.includes(t));
    onSetMcpTools(next);
  };

  /** 输入框粘贴：剪贴板里有图片文件时截获（桌面端最顺手的发图方式） */
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!visionSupported) return;
    const items = Array.from(e.clipboardData?.items || []);
    const files: File[] = [];
    for (const item of items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
      const f = item.getAsFile();
      if (f) files.push(f);
    }
    if (files.length > 0) {
      e.preventDefault();
      onPasteImages(files);
    }
  };

  const canSend = input.trim().length > 0 || pendingImages.length > 0;

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

        {/* 图片：相册 / 文件选择（全平台） */}
        <button
          className={`toolbar-btn ${pendingImages.length > 0 ? 'active image' : ''} ${visionSupported ? '' : 'no-vision'}`}
          onClick={onPickImages}
          title={visionSupported ? '选择图片（桌面端可直接 Ctrl+V 粘贴）' : VISION_UNSUPPORTED_HINT}
        >
          <IconImage />
          <span>图片{pendingImages.length > 0 ? ` (${pendingImages.length})` : ''}</span>
        </button>

        {/* 拍照：仅 Android（原生相机） */}
        {showCameraButton && (
          <button
            className={`toolbar-btn ${visionSupported ? '' : 'no-vision'}`}
            onClick={onTakePhoto}
            title={visionSupported ? '拍一张照片发给 AI' : VISION_UNSUPPORTED_HINT}
          >
            <IconCamera />
            <span>拍照</span>
          </button>
        )}

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

        {/* MCP 开关 - 点击展开多选面板 */}
        <button
          className={`toolbar-btn ${mcpEnabled ? 'active mcp' : ''}`}
          onClick={onToggleMcp}
          title="MCP 桥梁通道（对话级持久化）"
        >
          <IconTool />
          <span>MCP{mcpActiveTools.length > 0 ? ` (${mcpActiveTools.length})` : ''}</span>
        </button>

        {/* MCP 工具多选面板 */}
        {mcpPickerOpen && (
          <div className="mcp-picker-panel glass">
            <div className="mcp-picker-header">
              <h4>
                选择 MCP 工具
                {mcpActiveTools.length > 0 && (
                  <span className="mcp-picker-count">已启用 {mcpActiveTools.length} 个</span>
                )}
              </h4>
              <button className="mcp-picker-close" onClick={onCloseMcpPicker}>
                <IconClose />
              </button>
            </div>
            <div className="mcp-picker-options">
              {MCP_GROUPS.map(g => {
                const selected = g.tools.filter(t => mcpActiveTools.includes(t)).length;
                const allOn = selected === g.tools.length && g.tools.length > 0;
                const partial = selected > 0 && !allOn;
                return (
                  <button
                    key={g.key}
                    type="button"
                    className={`mcp-picker-option ${allOn ? 'checked' : ''}`}
                    onClick={() => toggleGroup(g.tools, !allOn)}
                    title={allOn ? '点击取消该组' : '点击启用该组'}
                  >
                    <span className={`mcp-picker-checkbox ${allOn ? 'checked' : partial ? 'partial' : ''}`}>
                      {allOn && <IconCheck />}
                      {partial && <span style={{ color: '#fff', fontSize: 12, lineHeight: 1 }}>–</span>}
                    </span>
                    <div className="mcp-picker-icon">{g.icon}</div>
                    <div className="mcp-picker-text">
                      <div className="mcp-picker-title">{g.title}</div>
                      <div className="mcp-picker-desc">{g.desc}</div>
                    </div>
                    {selected > 0 && (
                      <span className="mcp-picker-count-badge">{selected}/{g.tools.length}</span>
                    )}
                  </button>
                );
              })}
              {mcpActiveTools.length > 0 && (
                <button
                  className="mcp-picker-clear"
                  onClick={() => onSetMcpTools([])}
                  type="button"
                >
                  清空已启用工具
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

        {/* 撤销 / 重做（模拟 Ctrl+Z / Ctrl+Y，固定在工具栏最右侧，方便手机端点按） */}
        <div className="chat-input-actions">
          <button
            type="button"
            className="chat-history-btn"
            onMouseDown={e => e.preventDefault()}
            onClick={onUndo}
            disabled={!canUndo}
            title="撤销 (Ctrl+Z)"
            aria-label="撤销"
          >
            <IconUndo size={18} />
          </button>
          <button
            type="button"
            className="chat-history-btn"
            onMouseDown={e => e.preventDefault()}
            onClick={onRedo}
            disabled={!canRedo}
            title="重做 (Ctrl+Y)"
            aria-label="重做"
          >
            <IconRedo size={18} />
          </button>
        </div>
      </div>

      {/* 待发送图片预览条 */}
      {pendingImages.length > 0 && (
        <div className="chat-pending-images">
          {pendingImages.map(img => (
            <div className="chat-pending-image" key={img.id}>
              <img src={img.preview} alt="待发送图片" />
              <button
                type="button"
                className="pending-image-remove"
                onClick={() => onRemovePendingImage(img.id)}
                aria-label="移除这张图片"
                title="移除"
              >
                <IconClose size={9} />
              </button>
            </div>
          ))}
          <span className="pending-images-hint">
            {pendingImages.length} 张将随消息发送
          </span>
        </div>
      )}

      <div className="input-row">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={isMobile ? '输入消息…' : '输入消息… (Enter 换行, Ctrl+Enter 发送)'}
          value={input}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          rows={1}
          disabled={isLoading}
        />
        {isLoading ? (
          <button className="chat-send-btn stop" onClick={onStop} title="停止生成">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
        ) : (
          <button className="chat-send-btn" onClick={onSend} disabled={!canSend}>
            <IconSendAlt />
          </button>
        )}
      </div>
    </footer>
  );
}
