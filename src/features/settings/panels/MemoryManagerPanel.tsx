/**
 * 长期记忆管理面板（v2.11.0）
 *
 * 弹层形态（覆盖在设置页之上）：
 * - 列表：内容 / 来源（AI 保存 · 手动添加）/ 时间
 * - 行内编辑、删除（带确认）
 * - 底部手动添加输入框
 *
 * 数据层见 services/aiMemory.ts（localStorage，全本地、不进云备份）。
 */
import { useCallback, useState } from 'react';
import { listMemories, saveMemory, updateMemory, deleteMemory, MEMORY_COUNT_MAX } from '@/services/aiMemory';
import type { AIMemory } from '@/services/aiMemory';

interface MemoryManagerPanelProps {
  onClose: () => void;
  /** 记忆数量变化时通知父组件（刷新入口按钮文案） */
  onChanged?: () => void;
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

export function MemoryManagerPanel({ onClose, onChanged }: MemoryManagerPanelProps) {
  const [memories, setMemories] = useState<AIMemory[]>(() => listMemories());
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const refresh = useCallback(() => {
    setMemories(listMemories());
    onChanged?.();
  }, [onChanged]);

  const handleAdd = useCallback(() => {
    const result = saveMemory(newContent, 'user');
    if (!result.success) {
      alert(result.error || '添加失败');
      return;
    }
    setNewContent('');
    refresh();
  }, [newContent, refresh]);

  const handleStartEdit = useCallback((m: AIMemory) => {
    setEditingId(m.id);
    setEditContent(m.content);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const result = updateMemory(editingId, editContent);
    if (!result.success) {
      alert(result.error || '保存失败');
      return;
    }
    setEditingId(null);
    refresh();
  }, [editingId, editContent, refresh]);

  const handleDelete = useCallback((m: AIMemory) => {
    if (!confirm(`确定删除这条记忆吗？\n「${m.content}」`)) return;
    deleteMemory(m.id);
    refresh();
  }, [refresh]);

  return (
    <div className="memory-overlay" onClick={onClose}>
      <div className="memory-panel glass" onClick={e => e.stopPropagation()}>
        <div className="memory-header">
          <h3>长期记忆</h3>
          <button className="memory-close" onClick={onClose} title="关闭"><CloseIcon /></button>
        </div>
        <p className="memory-hint">
          开启长期记忆后，AI 会把值得记住的信息存在这里、并在对话中自然运用（全本地存储）。
          你手动添加的内容同样对 AI 可见。
        </p>

        <div className="memory-add">
          <input
            type="text"
            className="memory-add-input"
            placeholder="手动添加一条，如：我习惯用「近7天」筛选"
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
          <button className="memory-add-btn" onClick={handleAdd} disabled={!newContent.trim()}>
            添加
          </button>
        </div>

        <div className="memory-list">
          {memories.length === 0 ? (
            <div className="memory-empty">
              还没有记忆。<br />开启开关后，AI 会在对话中自动记住重要信息；也可以先手动添加一条。
            </div>
          ) : (
            memories.map(m => (
              <div key={m.id} className="memory-item">
                {editingId === m.id ? (
                  <div className="memory-item-edit">
                    <input
                      type="text"
                      className="memory-edit-input"
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); }}
                      autoFocus
                    />
                    <div className="memory-item-edit-actions">
                      <button className="memory-btn" onClick={() => setEditingId(null)}>取消</button>
                      <button className="memory-btn primary" onClick={handleSaveEdit} disabled={!editContent.trim()}>保存</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="memory-item-content">{m.content}</div>
                    <div className="memory-item-meta">
                      <span className={`memory-source ${m.source}`}>{m.source === 'user' ? '手动添加' : 'AI 保存'}</span>
                      <span className="memory-item-time">{new Date(m.updatedAt).toLocaleDateString('zh-CN')}</span>
                      <span className="memory-item-actions">
                        <button className="memory-btn" onClick={() => handleStartEdit(m)}>编辑</button>
                        <button className="memory-btn danger" onClick={() => handleDelete(m)}>删除</button>
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <div className="memory-footer">
          共 {memories.length} / {MEMORY_COUNT_MAX} 条
        </div>
      </div>
    </div>
  );
}
