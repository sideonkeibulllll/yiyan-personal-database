/**
 * 信息附加面板组件
 * 添加来源、所属组、补充信息
 */
import { useState, useCallback } from 'react';
import { getDatabase } from '@/services/database';
import type { Entry } from '@/types';
import './InfoAdder.css';

interface InfoAdderProps {
  entry: Entry;
  onClose: () => void;
  onSave: (updates: { source?: string; groupId?: string; supplement?: string }) => void;
}

/** X (close) icon */
const XCloseSvg = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** Folder icon */
const FolderSvg = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

export function InfoAdder({ entry, onClose, onSave }: InfoAdderProps) {
  const [source, setSource] = useState(entry.source || '');
  const [supplement, setSupplement] = useState(entry.supplement || '');
  const [groupId, setGroupId] = useState(entry.groupId);
  const [presetSources, setPresetSources] = useState<string[]>([]);

  useState(() => {
    try {
      const stored = localStorage.getItem('yiyan_preset_sources');
      if (stored) {
        setPresetSources(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  });

  const handleSave = useCallback(() => {
    onSave({
      source: source || undefined,
      groupId,
      supplement: supplement || undefined,
    });

    if (source && !presetSources.includes(source)) {
      const newPresets = [...presetSources, source].slice(-10);
      setPresetSources(newPresets);
      localStorage.setItem('yiyan_preset_sources', JSON.stringify(newPresets));
    }
  }, [source, groupId, supplement, onSave, presetSources]);

  return (
    <div className="info-adder">
      <div className="adder-header">
        <h3 className="adder-title">添加信息</h3>
        <button className="adder-close" onClick={onClose}><XCloseSvg /></button>
      </div>

      <div className="adder-content">
        <div className="form-section">
          <label className="form-label">来源</label>
          <input
            type="text"
            className="form-input glass"
            placeholder="输入来源..."
            value={source}
            onChange={e => setSource(e.target.value)}
          />
          {presetSources.length > 0 && (
            <div className="preset-sources">
              {presetSources.map((preset, index) => (
                <button
                  key={index}
                  className={`preset-chip ${source === preset ? 'selected' : ''}`}
                  onClick={() => setSource(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="form-section">
          <label className="form-label">所属组</label>
          <GroupSelect value={groupId} onChange={setGroupId} />
        </div>

        <div className="form-section">
          <label className="form-label">补充信息</label>
          <textarea
            className="form-textarea glass"
            placeholder="添加补充说明..."
            value={supplement}
            onChange={e => setSupplement(e.target.value)}
            rows={3}
          />
        </div>
      </div>

      <div className="adder-actions">
        <button className="action-btn secondary" onClick={onClose}>
          取消
        </button>
        <button className="action-btn primary" onClick={handleSave}>
          保存
        </button>
      </div>
    </div>
  );
}

function GroupSelect({ value, onChange }: { value?: string; onChange: (groupId?: string) => void }) {
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  useState(() => {
    const loadGroups = async () => {
      try {
        const db = await getDatabase();
        const allGroups = await db.getAllGroups();
        setGroups(allGroups);
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    };
    loadGroups();
  });

  if (isLoading) {
    return <div className="loading-text">加载中...</div>;
  }

  return (
    <div className="group-select">
      <button
        className={`group-option ${!value ? 'selected' : ''}`}
        onClick={() => onChange(undefined)}
      >
        未分组
      </button>
      {groups.map(group => (
        <button
          key={group.id}
          className={`group-option ${value === group.id ? 'selected' : ''}`}
          onClick={() => onChange(group.id)}
        >
          <FolderSvg /> {group.name}
        </button>
      ))}
    </div>
  );
}

export type { InfoAdderProps };