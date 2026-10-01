/**
 * 预设编辑器：新增 / 重命名 / 删除场景预设
 *
 * 预设保存在 localStorage，与数据库解耦；
 * 用户可自定义自己的常用场景（主人要求「场景预设可以自己编辑以及添加盘」）。
 */
import { useState } from 'react';
import type { WheelPreset } from './PresetBar';
import { parseOptionsText, optionsToText } from './PresetBar';

interface PresetEditorProps {
  presets: WheelPreset[];
  onSave: (presets: WheelPreset[]) => void;
  onClose: () => void;
}

function genId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function PresetEditor({ presets, onSave, onClose }: PresetEditorProps) {
  const [draft, setDraft] = useState<WheelPreset[]>(
    presets.map(p => ({ ...p, options: p.options.map(o => ({ ...o })) }))
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  const updateName = (id: string, name: string) => {
    setDraft(d => d.map(p => (p.id === id ? { ...p, name } : p)));
  };

  const updateOptionsText = (id: string, text: string) => {
    setDraft(d => d.map(p => (p.id === id ? { ...p, options: parseOptionsText(text) } : p)));
  };

  const removePreset = (id: string) => {
    if (!confirm('删除这个预设？')) return;
    setDraft(d => d.filter(p => p.id !== id));
  };

  const addPreset = () => {
    const item: WheelPreset = {
      id: genId(),
      name: '新预设',
      options: [{ name: '选项A', weight: 1 }, { name: '选项B', weight: 1 }],
    };
    setDraft(d => [...d, item]);
    setEditingId(item.id);
  };

  const handleSave = () => {
    onSave(draft.filter(p => p.name.trim()));
    onClose();
  };

  return (
    <div className="wheel-menu-mask" onClick={onClose}>
      <div className="wheel-preset-editor" onClick={e => e.stopPropagation()}>
        <div className="wheel-preset-editor-head">
          <span className="wheel-menu-label">编辑场景预设</span>
          <button className="wheel-mini-btn" onClick={addPreset}>+ 新增</button>
        </div>

        <div className="wheel-preset-editor-list">
          {draft.map(p => (
            <div key={p.id} className="wheel-preset-item">
              <div className="wheel-preset-item-head">
                <input
                  className="wheel-preset-name-input"
                  value={p.name}
                  maxLength={16}
                  onChange={e => updateName(p.id, e.target.value)}
                />
                <button className="wheel-mini-btn" onClick={() => setEditingId(editingId === p.id ? null : p.id)}>
                  {editingId === p.id ? '收起' : '编辑选项'}
                </button>
                <button className="wheel-mini-btn danger" onClick={() => removePreset(p.id)}>删除</button>
              </div>
              {editingId === p.id && (
                <textarea
                  className="wheel-preset-options-textarea"
                  rows={4}
                  placeholder={'每行一个：名称 或 名称: 权重'}
                  value={optionsToText(p.options)}
                  onChange={e => updateOptionsText(p.id, e.target.value)}
                />
              )}
            </div>
          ))}
          {draft.length === 0 && <div className="wheel-empty-hint">还没有预设</div>}
        </div>

        <div className="wheel-preset-editor-foot">
          <button className="wheel-mini-btn" onClick={onClose}>取消</button>
          <button className="wheel-mini-btn primary" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
