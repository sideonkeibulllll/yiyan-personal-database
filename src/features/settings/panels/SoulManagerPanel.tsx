/**
 * Soul 事实库管理面板（v3.4.0 · 档案进化）
 *
 * 弹层形态（覆盖在设置页之上，复用 memory-* 样式类）：
 * - 事实列表（分类分组；编辑 / 废除 / 删除）+ 手动添加
 * - 预览注入效果（chat / 怕了么）
 * - 迁移：旧版档案文本 → AI 拆解为事实（确认导入后清空旧文本，P3 拍板「直接删」）
 * - 蒸馏：从收件箱提炼事实变更组（模型可选；应用后默认清理已提炼素材）
 * - 撤销：恢复上一次批次应用（事实库 + 收件箱；单槽位，新批次覆盖）
 */
import { useCallback, useMemo, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  addSoulFactManually,
  applySoulChanges,
  clearLegacySoul,
  getLegacySoulText,
  getSoulUndoSnapshot,
  listSoulFacts,
  previewSoulChanges,
  removeSoulFact,
  renderSoulPortrait,
  retireSoulFact,
  reviveSoulFact,
  undoLastSoulApply,
  updateSoulFactDirect,
  recordSoulUndoSnapshot,
  snapshotMemories,
  type SoulChangeOutcome,
  type SoulUndoSnapshot,
} from '@/services/soulFacts';
import {
  distillFromInbox,
  extractFromLegacySoul,
  getSoulDistillModelValue,
  setSoulDistillModelValue,
  type DistillResult,
  type ExtractResult,
} from '@/services/soulDistill';
import { buildWorryModelOptions } from '@/services/worryAI';
import { listMemories, replaceAllMemories } from '@/services/aiMemory';
import { ModelPicker } from '@/features/worry/components/ModelPicker';
import { SOUL_CATEGORY_LABELS } from '@/types';
import type { SoulFact, SoulFactCategory } from '@/types';
import '@/features/worry/Worry.css';

const CATEGORY_ORDER: SoulFactCategory[] = ['identity', 'situation', 'state', 'goal', 'history'];

interface SoulManagerPanelProps {
  onClose: () => void;
  /** 事实数量变化时通知父组件（刷新入口按钮文案） */
  onFactsChanged?: () => void;
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function SoulManagerPanel({ onClose, onFactsChanged }: SoulManagerPanelProps) {
  const settings = useSettingsStore(state => state.settings);

  const [facts, setFacts] = useState<SoulFact[]>(() => listSoulFacts(true));
  // 手动添加
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<SoulFactCategory>('situation');
  // 行内编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState<SoulFactCategory>('situation');
  // 注入预览
  const [previewView, setPreviewView] = useState<'chat' | 'worry'>('chat');
  // 迁移（旧档案拆解）
  const [legacyText, setLegacyText] = useState(() => getLegacySoulText());
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [migratePreview, setMigratePreview] = useState<ExtractResult | null>(null);
  // 蒸馏（收件箱提炼）
  const [modelValue, setModelValue] = useState(() => getSoulDistillModelValue());
  const modelOptions = useMemo(() => buildWorryModelOptions(settings.ai), [settings.ai]);
  const [distillBusy, setDistillBusy] = useState(false);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [distillDraft, setDistillDraft] = useState<{ result: DistillResult; outcome: SoulChangeOutcome } | null>(null);
  const [distillCleanup, setDistillCleanup] = useState(true);
  const [distillDone, setDistillDone] = useState<string | null>(null);
  // 撤销快照
  const [undoSnap, setUndoSnap] = useState<SoulUndoSnapshot | null>(() => getSoulUndoSnapshot());

  const refresh = useCallback(() => {
    setFacts(listSoulFacts(true));
    setUndoSnap(getSoulUndoSnapshot());
    setLegacyText(getLegacySoulText());
    onFactsChanged?.();
  }, [onFactsChanged]);

  /* ---- 派生数据 ---- */
  const activeGrouped = useMemo(() => {
    const active = facts.filter(f => f.status === 'active');
    return CATEGORY_ORDER
      .map(cat => ({ cat, items: active.filter(f => f.category === cat) }))
      .filter(g => g.items.length > 0);
  }, [facts]);
  const retiredFacts = useMemo(() => facts.filter(f => f.status === 'retired'), [facts]);
  const activeCount = facts.filter(f => f.status === 'active').length;
  const previewText = useMemo(
    () => renderSoulPortrait(previewView) ?? '（暂无事实）',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewView, facts],
  );

  /* ---- 手动操作 ---- */
  const handleAdd = useCallback(() => {
    const res = addSoulFactManually(newContent, newCategory);
    if (!res.ok) {
      alert(res.error || '添加失败');
      return;
    }
    setNewContent('');
    refresh();
  }, [newContent, newCategory, refresh]);

  const handleStartEdit = useCallback((f: SoulFact) => {
    setEditingId(f.id);
    setEditContent(f.content);
    setEditCategory(f.category);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return;
    const res = updateSoulFactDirect(editingId, editContent, editCategory);
    if (!res.ok) {
      alert(res.error || '保存失败');
      return;
    }
    setEditingId(null);
    refresh();
  }, [editingId, editContent, editCategory, refresh]);

  const handleRetire = useCallback((f: SoulFact) => {
    retireSoulFact(f.id);
    refresh();
  }, [refresh]);

  const handleRevive = useCallback((f: SoulFact) => {
    reviveSoulFact(f.id);
    refresh();
  }, [refresh]);

  const handleRemove = useCallback((f: SoulFact) => {
    if (!confirm(`确定删除这条事实吗？（物理删除，不可恢复）\n「${f.content}」`)) return;
    removeSoulFact(f.id);
    refresh();
  }, [refresh]);

  /* ---- 迁移：旧档案 → AI 拆解 ---- */
  const handleMigrate = useCallback(async () => {
    if (!legacyText.trim()) return;
    setMigrateBusy(true);
    setMigrateError(null);
    setMigratePreview(null);
    try {
      const result = await extractFromLegacySoul(legacyText);
      setMigratePreview(result);
    } catch (e) {
      setMigrateError(e instanceof Error ? e.message : '拆解失败，请重试');
    } finally {
      setMigrateBusy(false);
    }
  }, [legacyText]);

  const handleRemoveMigrateItem = useCallback((idx: number) => {
    setMigratePreview(prev => prev ? { ...prev, facts: prev.facts.filter((_, i) => i !== idx) } : prev);
  }, []);

  const handleConfirmMigrate = useCallback(() => {
    if (!migratePreview || migratePreview.facts.length === 0) return;
    const outcome = applySoulChanges(
      { add: migratePreview.facts.map(f => ({ content: f.content, category: f.category })), update: [], retire: [] },
      'migrated',
    );
    if (outcome.added === 0) {
      alert(outcome.errors[0] || '导入失败（可能与现有事实重复）');
      return;
    }
    clearLegacySoul();
    setMigratePreview(null);
    refresh();
  }, [migratePreview, refresh]);

  /* ---- 蒸馏：收件箱 → 变更组 ---- */
  const handleDistill = useCallback(async () => {
    setDistillBusy(true);
    setDistillError(null);
    setDistillDraft(null);
    setDistillDone(null);
    try {
      const result = await distillFromInbox();
      const outcome = previewSoulChanges(result.changes);
      setDistillDraft({ result, outcome });
    } catch (e) {
      setDistillError(e instanceof Error ? e.message : '提炼失败，请重试');
    } finally {
      setDistillBusy(false);
    }
  }, []);

  const handleApplyDistill = useCallback(() => {
    if (!distillDraft) return;
    // 应用前记录快照（含收件箱），支持「撤销本次修改」
    recordSoulUndoSnapshot('从收件箱提炼', snapshotMemories());
    const outcome = applySoulChanges(distillDraft.result.changes, 'ai');
    let cleaned = 0;
    if (distillCleanup) {
      const usedIds = new Set(distillDraft.result.usedMemories.map(m => m.id));
      replaceAllMemories(listMemories().filter(m => !usedIds.has(m.id)));
      cleaned = distillDraft.result.usedMemories.length;
    }
    setDistillDraft(null);
    setDistillDone(
      `已应用：新增 ${outcome.added} 条 · 修改 ${outcome.updated} 条 · 废除 ${outcome.retired} 条`
      + (cleaned > 0 ? ` · 清理素材 ${cleaned} 条` : ''),
    );
    refresh();
  }, [distillDraft, distillCleanup, refresh]);

  const handleUndo = useCallback(() => {
    const res = undoLastSoulApply();
    if (!res.ok) {
      alert(res.error || '撤销失败');
      return;
    }
    setDistillDone('已撤销上次应用（事实库与收件箱已恢复到应用前的状态）。');
    refresh();
  }, [refresh]);

  return (
    <div className="memory-overlay" onClick={onClose}>
      <div className="memory-panel glass" onClick={e => e.stopPropagation()}>
        <div className="memory-header">
          <h3>Soul 事实档案</h3>
          <button className="memory-close" onClick={onClose} title="关闭"><CloseIcon /></button>
        </div>
        <p className="memory-hint">
          只存事实与状态（不存指令/偏好）。AI 只能提议变更，须经你确认后才会写入；聊天与「怕了么」读取的是这里渲染出的画像。
        </p>

        {/* 撤销条：存在可撤销批次时显示 */}
        {undoSnap && (
          <div className="soul-undo-bar">
            <span>「{undoSnap.label}」可撤销（回到 {formatDay(undoSnap.createdAt)} 应用前的状态）</span>
            <button className="memory-btn" onClick={handleUndo}>撤销</button>
          </div>
        )}

        {/* 迁移卡：旧档案文本待整理 */}
        {!!legacyText.trim() && !migratePreview && (
          <div className="soul-card">
            <div className="soul-card-title">旧版档案待整理（{legacyText.length} 字）</div>
            <div className="soul-card-desc">
              可以让 AI 把它拆解成事实条目（指令/偏好类会丢弃）；你确认后导入，清空旧文本。
            </div>
            <div className="soul-row-end">
              <button className="memory-btn primary" onClick={handleMigrate} disabled={migrateBusy}>
                {migrateBusy ? '拆解中…' : 'AI 拆解为事实'}
              </button>
            </div>
            {migrateError && <div className="soul-error">{migrateError}</div>}
          </div>
        )}
        {migratePreview && (
          <div className="soul-card">
            <div className="soul-card-title">拆解结果（{migratePreview.facts.length} 条）· 确认后导入</div>
            {migratePreview.dropped && <div className="soul-card-desc">已丢弃：{migratePreview.dropped}</div>}
            <div className="soul-preview-list">
              {migratePreview.facts.map((f, i) => (
                <div key={i} className="soul-preview-item">
                  <span className="soul-cat-tag">{SOUL_CATEGORY_LABELS[f.category] || '经历'}</span>
                  <span className="soul-preview-text">{f.content}</span>
                  <button className="memory-btn danger" onClick={() => handleRemoveMigrateItem(i)}>移除</button>
                </div>
              ))}
            </div>
            <div className="memory-item-edit-actions">
              <button className="memory-btn" onClick={() => setMigratePreview(null)}>放弃</button>
              <button
                className="memory-btn primary"
                onClick={handleConfirmMigrate}
                disabled={migratePreview.facts.length === 0}
              >
                导入 {migratePreview.facts.length} 条并清空旧文本
              </button>
            </div>
          </div>
        )}

        {/* 蒸馏：收件箱提炼 */}
        <div className="soul-card">
          <div className="soul-card-title">从收件箱提炼</div>
          <div className="soul-distill-row">
            <ModelPicker
              options={modelOptions}
              currentValue={modelValue}
              onSelect={v => { setModelValue(v); setSoulDistillModelValue(v); }}
            />
            <button className="memory-btn primary" onClick={handleDistill} disabled={distillBusy}>
              {distillBusy ? '提炼中…' : '开始提炼'}
            </button>
          </div>
          {distillError && <div className="soul-error">{distillError}</div>}
          {distillDone && <div className="soul-done">{distillDone}</div>}
          {distillDraft && (
            <div className="soul-draft">
              {distillDraft.result.note && <div className="soul-card-desc">{distillDraft.result.note}</div>}
              <div className="soul-changes">
                {distillDraft.outcome.details.map((d, i) => (
                  <div key={i} className="soul-change-line">· {d}</div>
                ))}
                {distillDraft.outcome.errors.map((e, i) => (
                  <div key={`err-${i}`} className="soul-error">· {e}</div>
                ))}
                {distillDraft.outcome.details.length === 0 && (
                  <div className="soul-card-desc">没有值得提炼的新事实。</div>
                )}
              </div>
              <label className="soul-check">
                <input
                  type="checkbox"
                  checked={distillCleanup}
                  onChange={e => setDistillCleanup(e.target.checked)}
                />
                <span>应用后清理已提炼的 {distillDraft.result.usedMemories.length} 条素材（可在此撤销）</span>
              </label>
              <div className="memory-item-edit-actions">
                <button className="memory-btn" onClick={() => setDistillDraft(null)}>放弃</button>
                <button
                  className="memory-btn primary"
                  onClick={handleApplyDistill}
                  disabled={distillDraft.outcome.added + distillDraft.outcome.updated + distillDraft.outcome.retired === 0}
                >
                  应用变更
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 手动添加 */}
        <div className="soul-add-row">
          <select
            className="soul-cat-select"
            value={newCategory}
            onChange={e => setNewCategory(e.target.value as SoulFactCategory)}
          >
            {CATEGORY_ORDER.map(c => <option key={c} value={c}>{SOUL_CATEGORY_LABELS[c]}</option>)}
          </select>
          <input
            type="text"
            className="memory-add-input"
            placeholder="手动添加一条事实，如：最近在学 Unity"
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
          <button className="memory-add-btn" onClick={handleAdd} disabled={!newContent.trim()}>
            添加
          </button>
        </div>

        {/* 事实列表 */}
        <div className="memory-list">
          {activeCount === 0 ? (
            <div className="memory-empty">
              还没有事实。<br />
              AI 会在对话中提议新增；也可以手动添加，或整理上面的旧档案 / 收件箱。
            </div>
          ) : (
            activeGrouped.map(g => (
              <div key={g.cat} className="soul-group">
                <div className="soul-group-title">{SOUL_CATEGORY_LABELS[g.cat]}（{g.items.length}）</div>
                {g.items.map(f => (
                  <div key={f.id} className="memory-item">
                    {editingId === f.id ? (
                      <div className="memory-item-edit">
                        <div className="soul-add-row">
                          <select
                            className="soul-cat-select"
                            value={editCategory}
                            onChange={e => setEditCategory(e.target.value as SoulFactCategory)}
                          >
                            {CATEGORY_ORDER.map(c => <option key={c} value={c}>{SOUL_CATEGORY_LABELS[c]}</option>)}
                          </select>
                        </div>
                        <textarea
                          className="memory-edit-input"
                          style={{ minHeight: 52, resize: 'vertical', fontFamily: 'inherit' }}
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          autoFocus
                        />
                        <div className="memory-item-edit-actions">
                          <button className="memory-btn" onClick={() => setEditingId(null)}>取消</button>
                          <button className="memory-btn primary" onClick={handleSaveEdit} disabled={!editContent.trim()}>保存</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="memory-item-content">{f.content}</div>
                        <div className="memory-item-meta">
                          <span className={`memory-source ${f.source === 'user' ? 'user' : 'ai'}`}>
                            {f.source === 'user' ? '手动' : f.source === 'migrated' ? '迁移' : 'AI'}
                          </span>
                          <span className="memory-item-time">{formatDay(f.updatedAt)}</span>
                          <span className="memory-item-actions">
                            <button className="memory-btn" onClick={() => handleStartEdit(f)}>编辑</button>
                            <button className="memory-btn" onClick={() => handleRetire(f)}>废除</button>
                            <button className="memory-btn danger" onClick={() => handleRemove(f)}>删除</button>
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}

          {retiredFacts.length > 0 && (
            <details className="soul-retired">
              <summary>已废除（{retiredFacts.length}）</summary>
              {retiredFacts.map(f => (
                <div key={f.id} className="memory-item soul-retired-item">
                  <div className="memory-item-content">{f.content}</div>
                  <div className="memory-item-meta">
                    <span className="memory-item-time">{formatDay(f.updatedAt)}</span>
                    <span className="memory-item-actions">
                      <button className="memory-btn" onClick={() => handleRevive(f)}>恢复</button>
                      <button className="memory-btn danger" onClick={() => handleRemove(f)}>删除</button>
                    </span>
                  </div>
                </div>
              ))}
            </details>
          )}
        </div>

        {/* 注入预览 */}
        <details className="soul-preview">
          <summary>预览注入效果（AI 实际看到的画像）</summary>
          <div className="soul-preview-tabs">
            <button
              className={`memory-btn ${previewView === 'chat' ? 'primary' : ''}`}
              onClick={() => setPreviewView('chat')}
            >
              Chat
            </button>
            <button
              className={`memory-btn ${previewView === 'worry' ? 'primary' : ''}`}
              onClick={() => setPreviewView('worry')}
            >
              怕了么
            </button>
          </div>
          <pre className="soul-preview-text-block">{previewText}</pre>
        </details>

        <div className="memory-footer">
          活跃 {activeCount} 条 · 已废除 {retiredFacts.length} 条
        </div>
      </div>
    </div>
  );
}
