/**
 * 预设栏：场景预设切换 + 预设编辑 + 复制/导入文本
 *
 * 设计：预设存 localStorage（不进数据库），可自行编辑与新增；
 * 「添加盘」按钮由父组件接管（新建一个转盘记录）。
 */
import { useState } from 'react';
import type { WheelOption } from '@/types';

/** 一个场景预设 */
export interface WheelPreset {
  id: string;
  name: string;
  options: WheelOption[];
}

export const PRESET_STORAGE_KEY = 'yiyan_wheel_presets_v1';

/** 内置预设（首次使用时写入 localStorage，之后以 localStorage 为准） */
const BUILTIN_PRESETS: WheelPreset[] = [
  {
    id: 'p_eat',
    name: '今天吃什么',
    options: [
      { name: '火锅', weight: 1 }, { name: '日料', weight: 1 },
      { name: '炒菜', weight: 1 }, { name: '面食', weight: 1 },
      { name: '汉堡', weight: 1 }, { name: '沙拉', weight: 1 },
    ],
  },
  {
    id: 'p_weekend',
    name: '周末去哪玩',
    options: [
      { name: '公园', weight: 1 }, { name: '逛街', weight: 1 },
      { name: '看展', weight: 1 }, { name: '爬山', weight: 1 },
      { name: '在家躺', weight: 1 }, { name: '短途旅行', weight: 1 },
    ],
  },
  {
    id: 'p_night',
    name: '晚上做什么',
    options: [
      { name: '看书', weight: 1 }, { name: '打游戏', weight: 1 },
      { name: '看剧', weight: 1 }, { name: '运动', weight: 1 },
      { name: '早睡', weight: 1 }, { name: '整理房间', weight: 1 },
    ],
  },
  {
    id: 'p_movie',
    name: '看什么电影',
    options: [
      { name: '科幻', weight: 1 }, { name: '喜剧', weight: 1 },
      { name: '悬疑', weight: 1 }, { name: '动画', weight: 1 },
      { name: '爱情', weight: 1 }, { name: '恐怖', weight: 1 },
    ],
  },
];

export function loadPresets(): WheelPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as WheelPreset[];
    }
  } catch { /* 忽略 */ }
  try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(BUILTIN_PRESETS)); } catch { /* 忽略 */ }
  return BUILTIN_PRESETS.map(p => ({ ...p, options: p.options.map(o => ({ ...o })) }));
}

export function savePresets(presets: WheelPreset[]): void {
  try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets)); } catch { /* 忽略 */ }
}

/** 解析导入文本：支持换行 / 逗号 / 分号 / 顿号 / JSON 数组 / "名称: 权重" / "名称 权重" */
export function parseOptionsText(text: string): WheelOption[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // JSON 数组
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr
          .map((item: any) => {
            if (typeof item === 'string') return { name: item.trim(), weight: 1 };
            if (item && typeof item.name === 'string') {
              return { name: String(item.name).trim(), weight: clampWeight(item.weight) };
            }
            return null;
          })
          .filter((x): x is WheelOption => !!x && x.name.length > 0);
      }
    } catch { /* 落到普通文本解析 */ }
  }

  const parts = trimmed
    .split(/[\n,，;；、]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const out: WheelOption[] = [];
  const merged = new Map<string, number>();
  for (const part of parts) {
    let name = part;
    let weight = 1;
    // "名称: 权重" / "名称：权重"
    const m = /^(.+?)\s*[:：]\s*(\d+)$/.exec(part);
    if (m) {
      name = m[1].trim();
      weight = clampWeight(Number(m[2]));
    } else {
      // "名称 权重"
      const m2 = /^(.+?)\s+(\d+)$/.exec(part);
      if (m2) {
        name = m2[1].trim();
        weight = clampWeight(Number(m2[2]));
      }
    }
    if (!name) continue;
    name = name.slice(0, 12);
    // 同名合并权重
    if (merged.has(name)) {
      merged.set(name, clampWeight(merged.get(name)! + weight));
    } else {
      merged.set(name, weight);
    }
  }
  for (const [name, weight] of merged) out.push({ name, weight });
  return out;
}

function clampWeight(w: unknown): number {
  const n = Number(w);
  if (!Number.isFinite(n)) return 1;
  return Math.min(99, Math.max(1, Math.round(n)));
}

/** 导出为纯文本：每行 "名称: 权重"（权重 1 时省略） */
export function optionsToText(options: WheelOption[]): string {
  return options.map(o => (o.weight === 1 ? o.name : `${o.name}: ${o.weight}`)).join('\n');
}

interface PresetBarProps {
  presets: WheelPreset[];
  presetsVersion: number;
  disabled: boolean;
  onApply: (preset: WheelPreset) => void;
  onEditPresets: () => void;
  onAddWheel: () => void;
  options: WheelOption[];
  onImportOptions: (options: WheelOption[]) => void;
}

export function PresetBar({
  presets,
  disabled,
  onApply,
  onEditPresets,
  onAddWheel,
  options,
  onImportOptions,
}: PresetBarProps) {
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [copied, setCopied] = useState(false);

  const preview = parseOptionsText(importText);

  const handleCopy = async () => {
    const text = optionsToText(options);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用：退化为选中提示
      setImportText(text);
      setShowImport(true);
    }
  };

  return (
    <div className="wheel-preset-bar">
      <div className="wheel-section-title">
        场景预设
        <div className="wheel-preset-actions">
          <button className="wheel-mini-btn" disabled={disabled} onClick={onEditPresets}>编辑</button>
          <button className="wheel-mini-btn" disabled={disabled} onClick={onAddWheel}>+ 新盘</button>
        </div>
      </div>

      <div className="wheel-preset-chips">
        {presets.map(p => (
          <button
            key={p.id}
            className="wheel-preset-chip"
            disabled={disabled}
            onClick={() => onApply(p)}
            title={`应用「${p.name}」`}
          >
            {p.name}
          </button>
        ))}
        {presets.length === 0 && <span className="wheel-empty-hint">暂无预设，点「编辑」添加</span>}
      </div>

      <div className="wheel-io-row">
        <button className="wheel-mini-btn" disabled={disabled} onClick={handleCopy}>
          {copied ? '已复制' : '复制文本'}
        </button>
        <button className="wheel-mini-btn" disabled={disabled} onClick={() => setShowImport(v => !v)}>
          {showImport ? '收起导入' : '导入文本'}
        </button>
      </div>

      {showImport && (
        <div className="wheel-import-panel">
          <textarea
            className="wheel-import-textarea"
            rows={5}
            placeholder={'每行一个选项，支持「名称」或「名称: 权重」\n也可粘贴逗号/顿号分隔的文本或 JSON 数组'}
            value={importText}
            onChange={e => setImportText(e.target.value)}
          />
          {importText.trim() && (
            <div className="wheel-import-preview">
              识别到 <strong>{preview.length}</strong> 个选项
              {preview.length > 0 && (
                <span className="wheel-import-preview-list">
                  {preview.slice(0, 6).map((o, i) => (
                    <em key={i}>{o.name}{o.weight > 1 ? `(${o.weight})` : ''}</em>
                  ))}
                  {preview.length > 6 && <em>…</em>}
                </span>
              )}
            </div>
          )}
          <div className="wheel-import-btns">
            <button
              className="wheel-mini-btn"
              disabled={preview.length === 0}
              onClick={() => {
                onImportOptions(preview);
                setImportText('');
                setShowImport(false);
              }}
            >
              替换为这些选项
            </button>
            <button
              className="wheel-mini-btn"
              disabled={preview.length === 0}
              onClick={() => {
                onImportOptions([...options, ...preview]);
                setImportText('');
                setShowImport(false);
              }}
            >
              追加到现有
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
