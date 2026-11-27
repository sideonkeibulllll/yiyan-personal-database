/**
 * Chat 页底部输入区 —— 一条会长的输入条（+ / 输入 / 发送）
 *
 * 结构决策：工具栏不再常驻一排按钮，全部收进左下角「+」升起的底部面板；
 * 输入条本身保持安静（默认 46px 单行，最多长到 3 行）。
 *
 * 状态与业务逻辑由父组件 ChatPage 持有，本组件只负责展示。
 * MCP 分组与提示词条目都来自 settings（v3.6.0 起不再硬编码分组）。
 */
import { useState } from 'react';
import type { ClipboardEvent, RefObject } from 'react';
import { IconUpload, IconBrain, IconTool, IconClose, IconSendAlt, IconCheck, IconUndo, IconRedo, IconImage, IconCamera, IconClipboard, IconFile, IconPlus } from '@/components/icons';
import { PromptPickerPanel } from './PromptPickerPanel';
import type { McpGroupConfig } from '@/types';
import type { PendingChatImage, PendingChatFile, ThinkingEffort } from '../chatTypes';

/** 字节数转可读文案（文件胶囊用） */
function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

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
  /** v3.6.0：MCP 分组（来自 settings.ai.mcpGroups，已过滤掉隐藏组） */
  mcpGroups: McpGroupConfig[];

  /* === 提示词挂载（v3.6.0） === */
  promptPickerOpen: boolean;
  onTogglePromptPicker: () => void;
  onClosePromptPicker: () => void;
  onPickPrompt: (id: string) => void;
  /** 已挂载的提示词（只有 id + 名称；正文在发送时才展开） */
  attachedPrompts: { id: string; title: string }[];
  onDetachPrompt: (id: string) => void;

  input: string;
  onInputChange: (value: string) => void;
  /** 撤销 / 重做（模拟 Ctrl+Z / Ctrl+Y，供手机端点击） */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  isLoading: boolean;
  onSend: () => void;
  onStop: () => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** v4.3.0：删除轮次后的 5 秒撤销条 */
  undo?: { onUndo: () => void } | null;

  /* === 图片输入（v3.5.3） === */
  /** 尚未发送的图片（预览条） */
  pendingImages: PendingChatImage[];
  /** 是否展示「拍照」入口（仅 Android 有原生相机） */
  showCameraButton: boolean;
  onPickImages: () => void;
  onTakePhoto: () => void;
  onRemovePendingImage: (id: string) => void;
  /** 粘贴图片（桌面端 Ctrl+V / 手机端剪贴板） */
  onPasteImages: (files: File[]) => void;

  /* === 文本文件输入（v3.6.3） === */
  /** 尚未发送的文本文件（内容发送时拼进正文） */
  pendingFiles: PendingChatFile[];
  onPickFiles: () => void;
  onRemovePendingFile: (id: string) => void;
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
  mcpGroups,
  promptPickerOpen,
  onTogglePromptPicker,
  onClosePromptPicker,
  onPickPrompt,
  attachedPrompts,
  onDetachPrompt,
  input,
  onInputChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isLoading,
  onSend,
  onStop,
  textareaRef,
  undo,
  pendingImages,
  showCameraButton,
  onPickImages,
  onTakePhoto,
  onRemovePendingImage,
  onPasteImages,
  pendingFiles,
  onPickFiles,
  onRemovePendingFile,
}: ChatInputAreaProps) {
  /** 「+」面板开合（纯展示态） */
  const [plusOpen, setPlusOpen] = useState(false);

  // 切换某一组工具：选中则全部启用，取消则全部移除（保留其它组）
  const toggleGroup = (tools: string[], enable: boolean) => {
    const next = enable
      ? Array.from(new Set([...mcpActiveTools, ...tools]))
      : mcpActiveTools.filter(t => !tools.includes(t));
    onSetMcpTools(next);
  };

  /** 输入框粘贴：剪贴板里有图片文件时截获（桌面端最顺手的发图方式） */
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
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

  const canSend = input.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0 || attachedPrompts.length > 0;
  /** 面板里的行都先关面板再动作，避免面板挡住刚打开的选择器 */
  const runFromSheet = (fn: () => void) => () => {
    setPlusOpen(false);
    fn();
  };

  return (
    <footer className="chat5-dock">
      {/* v4.3.0：删除轮次后的撤销条 —— 浮在输入条上方，胶囊深色玻璃，5 秒倒计时 */}
      {undo && (
        <div className="chat5-undo" role="status" aria-live="polite">
          <span className="chat5-undo-text">已删除这一轮</span>
          <button type="button" className="chat5-undo-action" onClick={undo.onUndo}>撤销</button>
          <i className="chat5-undo-bar" aria-hidden="true" />
        </div>
      )}

      {/* 已挂载的提示词胶囊 */}
      {attachedPrompts.length > 0 && (
        <div className="chat5-chips">
          {attachedPrompts.map(p => (
            <span className="prompt-chip" key={p.id}>
              <span className="prompt-chip-name">{p.title}</span>
              <button
                type="button"
                className="prompt-chip-x"
                onClick={() => onDetachPrompt(p.id)}
                aria-label={`移除 ${p.title}`}
                title="这次不带了"
              >
                ✕
              </button>
            </span>
          ))}
          <span className="chat5-chips-hint">发送时展开为正文</span>
        </div>
      )}

      {/* 待发送文件胶囊 */}
      {pendingFiles.length > 0 && (
        <div className="chat5-chips">
          {pendingFiles.map(f => (
            <span className="chat-pending-file" key={f.id}>
              <IconFile size={12} />
              <span className="pending-file-name">{f.name}</span>
              <span className="pending-file-meta">
                {formatBytes(f.size)}{f.truncated ? ' · 已截断' : ''}
              </span>
              <button
                type="button"
                className="pending-file-remove"
                onClick={() => onRemovePendingFile(f.id)}
                aria-label={`移除 ${f.name}`}
                title="移除"
              >
                <IconClose size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 待发送图片 */}
      {pendingImages.length > 0 && (
        <div className="chat5-attach">
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
          <span className="chat5-attach-hint">{pendingImages.length} 张随消息发送</span>
        </div>
      )}

      {/* 输入条：默认 46px 单行，随内容长到最多 3 行 */}
      <div className="chat5-composer">
        <button
          type="button"
          className={`chat5-plus ${plusOpen ? 'open' : ''}`}
          onClick={() => setPlusOpen(v => !v)}
          aria-label="添加附件或工具"
          aria-expanded={plusOpen}
          title="数据 / 图片 / 文件 / 思考 / 工具"
        >
          <IconPlus size={18} />
        </button>

        <textarea
          ref={textareaRef}
          className="chat5-input"
          placeholder="说点什么…"
          value={input}
          onChange={e => onInputChange(e.target.value)}
          onPaste={handlePaste}
          rows={1}
          disabled={isLoading}
        />

        {isLoading ? (
          <button className="chat5-send stop" onClick={onStop} title="停止生成" aria-label="停止生成">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
        ) : (
          <button
            className={`chat5-send ${canSend ? 'ready' : ''}`}
            onClick={onSend}
            disabled={!canSend}
            title="发送"
            aria-label="发送"
          >
            <IconSendAlt size={16} />
          </button>
        )}
      </div>

      {/* === 「+」面板 === */}
      {plusOpen && (
        <div className="chat5-sheet-wrap">
          <div className="chat5-scrim" onClick={() => setPlusOpen(false)} />
          <section className="s-sheet chat5-sheet" role="dialog" aria-label="添加">
            <span className="s-sheet-grip" />
            <div className="chat5-sheet-head">
              <div className="chat5-sheet-titles">
                <b>给这条消息加点东西</b>
                <span>选完就收起来，不挡输入</span>
              </div>
              <button className="chat5-icon-btn" onClick={() => setPlusOpen(false)} aria-label="关闭">
                <IconClose size={14} />
              </button>
            </div>

            <div className="chat5-sheet-scroll">
              <div className="chat5-sheet-label">带上内容</div>

              <button className="chat5-sheet-row" onClick={runFromSheet(onOpenPicker)}>
                <span className="chat5-sheet-ico"><IconUpload size={16} /></span>
                <span className="chat5-sheet-text"><b>数据</b><i>挑几条记忆或待办当上下文</i></span>
                {pickerSelectedCount > 0 && <span className="chat5-sheet-badge">{pickerSelectedCount}</span>}
              </button>

              <button
                className={`chat5-sheet-row ${recentPickerEnabled ? 'on' : ''}`}
                onClick={() => onToggleRecent(!recentPickerEnabled)}
                role="switch"
                aria-checked={recentPickerEnabled}
              >
                <span className="chat5-sheet-ico"><IconClipboard size={16} /></span>
                <span className="chat5-sheet-text"><b>最近</b><i>自动勾上最近 30 条</i></span>
                <span className={`chat5-switch ${recentPickerEnabled ? 'on' : ''}`} aria-hidden="true" />
              </button>

              <button className="chat5-sheet-row" onClick={runFromSheet(onPickImages)}>
                <span className="chat5-sheet-ico"><IconImage size={16} /></span>
                <span className="chat5-sheet-text"><b>图片</b><i>桌面端可以直接 Ctrl+V 粘贴</i></span>
                {pendingImages.length > 0 && <span className="chat5-sheet-badge">{pendingImages.length}</span>}
              </button>

              {showCameraButton && (
                <button className="chat5-sheet-row" onClick={runFromSheet(onTakePhoto)}>
                  <span className="chat5-sheet-ico"><IconCamera size={16} /></span>
                  <span className="chat5-sheet-text"><b>拍照</b><i>拍一张直接发过去</i></span>
                </button>
              )}

              <button className="chat5-sheet-row" onClick={runFromSheet(onPickFiles)}>
                <span className="chat5-sheet-ico"><IconFile size={16} /></span>
                <span className="chat5-sheet-text"><b>文件</b><i>txt / md / csv / 代码，内容拼进正文</i></span>
                {pendingFiles.length > 0 && <span className="chat5-sheet-badge">{pendingFiles.length}</span>}
              </button>

              <button className="chat5-sheet-row" onClick={runFromSheet(onTogglePromptPicker)}>
                <span className="chat5-sheet-ico"><IconClipboard size={16} /></span>
                <span className="chat5-sheet-text"><b>提示词</b><i>挂一条，正文发送时才展开</i></span>
                {attachedPrompts.length > 0 && <span className="chat5-sheet-badge">{attachedPrompts.length}</span>}
              </button>

              <div className="chat5-sheet-label">怎么回答</div>

              <button
                className={`chat5-sheet-row ${thinkingEnabled ? 'on' : ''}`}
                onClick={onToggleThinking}
                role="switch"
                aria-checked={thinkingEnabled}
              >
                <span className="chat5-sheet-ico"><IconBrain size={16} /></span>
                <span className="chat5-sheet-text"><b>深度思考</b><i>先想一遍再回答，慢一点但更稳</i></span>
                <span className={`chat5-switch ${thinkingEnabled ? 'on' : ''}`} aria-hidden="true" />
              </button>

              {thinkingEnabled && (
                <button className="chat5-sheet-row deep" onClick={onToggleEffort}>
                  <span className="chat5-sheet-ico"><IconBrain size={16} /></span>
                  <span className="chat5-sheet-text"><b>思考强度</b><i>点一下在 High / MAX 之间切</i></span>
                  <span className={`chat5-sheet-badge ${thinkingEffort === 'max' ? 'strong' : ''}`}>
                    {thinkingEffort === 'max' ? 'MAX' : 'High'}
                  </span>
                </button>
              )}

              <button className="chat5-sheet-row" onClick={runFromSheet(onToggleMcp)}>
                <span className="chat5-sheet-ico"><IconTool size={16} /></span>
                <span className="chat5-sheet-text"><b>工具</b><i>让 AI 读写记忆库 / 文件 / 作品</i></span>
                {mcpActiveTools.length > 0 && <span className="chat5-sheet-badge">{mcpActiveTools.length}</span>}
              </button>

              {mcpEnabled && mcpSearchCount > 0 && (
                <button className="chat5-sheet-row" onClick={runFromSheet(onOpenMcpResults)}>
                  <span className="chat5-sheet-ico"><IconTool size={16} /></span>
                  <span className="chat5-sheet-text"><b>已选上下文</b><i>回看这一轮带上的条目</i></span>
                  <span className="chat5-sheet-badge">{mcpSearchCount}</span>
                </button>
              )}

              <div className="chat5-sheet-label">输入</div>

              <div className="chat5-sheet-duo">
                <button type="button" className="chat5-duo-btn" onClick={onUndo} disabled={!canUndo} title="撤销输入">
                  <IconUndo size={16} />
                  <span>撤销</span>
                </button>
                <button type="button" className="chat5-duo-btn" onClick={onRedo} disabled={!canRedo} title="重做输入">
                  <IconRedo size={16} />
                  <span>重做</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* === MCP 工具面板（选中即生效，整组开关）=== */}
      {mcpPickerOpen && (
        <div className="chat5-sheet-wrap">
          <div className="chat5-scrim" onClick={onCloseMcpPicker} />
          <section className="s-sheet chat5-sheet" role="dialog" aria-label="选择工具">
            <span className="s-sheet-grip" />
            <div className="chat5-sheet-head">
              <div className="chat5-sheet-titles">
                <b>让 AI 能动手</b>
                <span>
                  {mcpActiveTools.length > 0 ? `已启用 ${mcpActiveTools.length} 个工具` : '一组一组开，关面板不会关工具'}
                </span>
              </div>
              <button className="chat5-icon-btn" onClick={onCloseMcpPicker} aria-label="关闭">
                <IconClose size={14} />
              </button>
            </div>
            <div className="chat5-sheet-scroll mcp-picker-options">
              {mcpGroups.map(g => {
                const selected = g.tools.filter(t => mcpActiveTools.includes(t)).length;
                const allOn = selected === g.tools.length && g.tools.length > 0;
                const partial = selected > 0 && !allOn;
                return (
                  <button
                    key={g.id}
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
                      <div className="mcp-picker-title">{g.label}</div>
                      <div className="mcp-picker-desc">{g.desc}</div>
                    </div>
                    {selected > 0 && (
                      <span className="mcp-picker-count-badge">{selected}/{g.tools.length}</span>
                    )}
                  </button>
                );
              })}
              {mcpGroups.length === 0 && (
                <div className="mcp-picker-desc" style={{ padding: '8px 4px' }}>
                  所有分组都被隐藏了 —— 去设置里的「MCP 分组」把要用的组打开。
                </div>
              )}
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
          </section>
        </div>
      )}

      {/* 提示词面板：样式上就是同一块底部抽屉（PromptPicker.css） */}
      {promptPickerOpen && (
        <PromptPickerPanel
          attachedIds={attachedPrompts.map(p => p.id)}
          onPick={onPickPrompt}
          onClose={onClosePromptPicker}
        />
      )}
    </footer>
  );
}
