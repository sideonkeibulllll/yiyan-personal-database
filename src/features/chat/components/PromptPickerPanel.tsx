/**
 * Chat 输入区的「提示词」选择面板（v3.6.0）
 *
 * 只做一件事：列出库里可用的提示词，点一条就挂到输入区（折叠成胶囊），
 * 正文不占输入框、也不自动发送 —— 决定权仍在用户手里（可能要配张作业照片）。
 *
 * 库里没有数据时给一条直达设置的路，避免用户在这里干瞪眼。
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '@/stores/settingsStore';
import { sortPrompts } from '@/services/promptLibrary';
import { IconClose } from '@/components/icons';
import './PromptPicker.css';

interface PromptPickerPanelProps {
  /** 已挂载的 id（列表里打勾，避免重复挂） */
  attachedIds: string[];
  onPick: (id: string) => void;
  onClose: () => void;
}

export function PromptPickerPanel({ attachedIds, onPick, onClose }: PromptPickerPanelProps) {
  const library = useSettingsStore(state => state.settings.ai.promptLibrary);
  const [keyword, setKeyword] = useState('');
  const navigate = useNavigate();

  const available = useMemo(() => (library ?? []).filter(p => !p.archived), [library]);

  const items = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const base = kw
      ? available.filter(p =>
          p.title.toLowerCase().includes(kw) ||
          (p.scene ?? '').toLowerCase().includes(kw) ||
          p.content.toLowerCase().includes(kw))
      : available;
    return sortPrompts(base).slice(0, 40);
  }, [available, keyword]);

  const goManage = () => {
    onClose();
    navigate('/settings?tab=promptLib');
  };

  return (
    <div className="prompt-picker-panel glass">
      <div className="prompt-picker-header">
        <h4>
          挂载提示词
          {attachedIds.length > 0 && <span className="prompt-picker-count">已挂 {attachedIds.length} 条</span>}
        </h4>
        <button className="prompt-picker-close" onClick={onClose} title="关闭" type="button">
          <IconClose />
        </button>
      </div>

      {available.length > 0 && (
        <input
          type="text"
          className="prompt-picker-search"
          placeholder="搜索名称 / 场景 / 正文…"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
      )}

      <div className="prompt-picker-list">
        {available.length === 0 ? (
          <div className="prompt-picker-empty">
            提示词库还是空的。
            <button className="prompt-picker-link" onClick={goManage} type="button">去设置里建一条 →</button>
          </div>
        ) : items.length === 0 ? (
          <div className="prompt-picker-empty">没有匹配的条目，换个关键词试试。</div>
        ) : (
          items.map(p => {
            const attached = attachedIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`prompt-picker-item ${attached ? 'attached' : ''}`}
                onClick={() => onPick(p.id)}
                title={attached ? '已挂载，再点一次移除' : '挂到输入区'}
              >
                <span className="prompt-picker-item-main">
                  <span className="prompt-picker-item-title">
                    {p.pinned ? <span className="prompt-picker-pin">置顶</span> : null}
                    {p.title}
                  </span>
                  {p.scene && <span className="prompt-picker-item-scene">{p.scene}</span>}
                </span>
                <span className="prompt-picker-item-meta">
                  {p.content.length >= 1000 ? `${(p.content.length / 1000).toFixed(1)}k` : p.content.length}
                </span>
                {attached && <span className="prompt-picker-check">✓</span>}
              </button>
            );
          })
        )}
      </div>

      <div className="prompt-picker-footer">
        <span className="prompt-picker-hint">挂载后发送时才展开正文</span>
        <button className="prompt-picker-link" onClick={goManage} type="button">管理</button>
      </div>
    </div>
  );
}
