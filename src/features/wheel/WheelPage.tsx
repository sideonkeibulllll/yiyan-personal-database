/**
 * 转盘页：一个转盘，一次揭晓
 *
 * 结构（v5）：
 * 1. 44px 顶条：返回 / 盘名（点击改名）/ 音效 / ⋯（换盘・新建・删除・编辑选项）
 * 2. 舞台：一圈极淡的 36 格刻度环 + 转盘本体 + 揭晓（抽完盘面压暗，中间浮出结果）
 * 3. 最近记录：一行横向可滑的小胶囊
 * 4. 底部拇指区：左「再转一次」描边、右「就这么定」主色
 * 5. 选项 / 预设收进底部抽屉（不占首屏）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Wheel, WheelOption, WheelHistoryItem } from '@/types';
import {
  getWheel, getLastOrCreateWheel, saveWheel, deleteWheel, createWheel,
  getAllWheels, setLastWheelId,
} from '@/services/wheelDatabase';
import { pushWheelRecent, removeWheelRecent, sortWheelsByRecent } from '@/utils/wheelRecent';
import { syncWheelWidgets } from '@/services/wheelWidgetService';
import { WheelCanvas, pickWeightedIndex, computeTargetRotation } from './components/WheelCanvas';
import { OptionList } from './components/OptionList';
import { HistoryList } from './components/HistoryList';
import { RemoveAfterSpinToggle } from './components/RemoveAfterSpinToggle';
import { PresetBar, loadPresets, savePresets, type WheelPreset } from './components/PresetBar';
import { PresetEditor } from './components/PresetEditor';
import { playSpinStart, playSpinEnd, playTap } from './wheelSound';
import './Wheel.css';

const SPIN_DURATION = 3800;
const HISTORY_KEEP = 5;

export function WheelPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [wheel, setWheel] = useState<Wheel | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  const [result, setResult] = useState<WheelHistoryItem | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [showPresetEditor, setShowPresetEditor] = useState(false);
  /** 底部抽屉：选项管理 + 预设（不占首屏） */
  const [showPanel, setShowPanel] = useState(false);
  const [presets, setPresets] = useState<WheelPreset[]>(() => loadPresets());
  const [allWheels, setAllWheels] = useState<Wheel[]>([]);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // === 加载转盘 ===
  const loadWheel = useCallback(async () => {
    setLoading(true);
    try {
      const w = id ? await getWheel(id) : await getLastOrCreateWheel();
      if (!w) {
        // id 找不到时退回默认盘
        const fallback = await getLastOrCreateWheel();
        setWheel(fallback);
        setLastWheelId(fallback.id);
      } else {
        setWheel(w);
        setLastWheelId(w.id);
      }
      setAllWheels(await getAllWheels());
    } catch (err) {
      console.error('[WheelPage] 加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { loadWheel(); }, [loadWheel]);

  useEffect(() => () => { if (spinTimerRef.current) clearTimeout(spinTimerRef.current); }, []);

  /** 持久化当前转盘 */
  const persist = useCallback(async (next: Wheel) => {
    setWheel(next);
    await saveWheel(next);
  }, []);

  const options = wheel?.options ?? [];

  // === 旋转 ===
  const handleSpin = useCallback(async () => {
    if (!wheel || spinning || options.length < 2) return;
    if (wheel.soundEnabled) void playSpinStart();

    // 上一次抽中的索引（用最近一条历史反查，避免连击）
    const lastText = wheel.history[0]?.text;
    const lastIndex = lastText ? options.findIndex(o => o.name === lastText) : -1;

    const picked = pickWeightedIndex(options, lastIndex >= 0 ? lastIndex : null);
    const target = computeTargetRotation(rotation, options, picked, 5);
    const pickedName = options[picked].name;

    setResult(null);
    setHighlightIndex(null);
    setSpinning(true);
    setRotation(target);

    spinTimerRef.current = setTimeout(async () => {
      setSpinning(false);
      const item: WheelHistoryItem = { text: pickedName, time: Date.now(), index: picked };
      setResult(item);
      if (wheel.soundEnabled) void playSpinEnd();

      // 写入历史（保留最近 N 条）
      const nextHistory = [item, ...wheel.history].slice(0, HISTORY_KEEP);

      // 「移除已选中选项」：移除到只剩 1 个为止（保留极限值 1，GO 会自动禁用）
      let nextOptions = options;
      if (wheel.removeAfterSpin && options.length > 1) {
        nextOptions = options.filter((_, i) => i !== picked);
        setHighlightIndex(null);
      }

      await persist({ ...wheel, options: nextOptions, history: nextHistory });

      // 「转动才算使用」：记录 MRU（插队首 + 去重 + 上限 5）→ 同步小组件盘序
      pushWheelRecent(wheel.id);
      void syncWheelWidgets();
    }, SPIN_DURATION);
  }, [wheel, spinning, options, rotation, persist]);

  const handleOptionsChange = useCallback(async (next: WheelOption[]) => {
    if (!wheel) return;
    await persist({ ...wheel, options: next });
  }, [wheel, persist]);

  const handleClearHistory = useCallback(async () => {
    if (!wheel) return;
    await persist({ ...wheel, history: [] });
  }, [wheel, persist]);

  const handleApplyPreset = useCallback(async (preset: WheelPreset) => {
    if (!wheel) return;
    if (!confirm(`用「${preset.name}」替换当前所有选项？`)) return;
    if (wheel.soundEnabled) void playTap();
    await persist({ ...wheel, name: preset.name, options: preset.options.map(o => ({ ...o })) });
  }, [wheel, persist]);

  const handleAddWheel = useCallback(async () => {
    const created = await createWheel('新转盘');
    setAllWheels(await getAllWheels());
    navigate(`/wheel/${created.id}`);
    setWheel(created);
    setLastWheelId(created.id);
    setShowMenu(false);
    void syncWheelWidgets();
  }, [navigate]);

  const handleSwitchWheel = useCallback((targetId: string) => {
    setShowMenu(false);
    navigate(`/wheel/${targetId}`);
  }, [navigate]);

  const handleDeleteWheel = useCallback(async () => {
    if (!wheel) return;
    if (!confirm(`确定删除转盘「${wheel.name}」？`)) return;
    await deleteWheel(wheel.id);
    removeWheelRecent(wheel.id);
    const rest = await getAllWheels();
    if (rest.length > 0) {
      navigate(`/wheel/${rest[0].id}`);
    } else {
      const created = await createWheel('今天吃什么');
      navigate(`/wheel/${created.id}`);
    }
    setShowMenu(false);
    void syncWheelWidgets();
  }, [wheel, navigate]);

  const handleRename = useCallback(async () => {
    if (!wheel) return;
    const name = renameText.trim();
    if (!name) { setShowRename(false); return; }
    await persist({ ...wheel, name });
    setShowRename(false);
  }, [wheel, renameText, persist]);

  const handleToggleSound = useCallback(async () => {
    if (!wheel) return;
    await persist({ ...wheel, soundEnabled: !wheel.soundEnabled });
  }, [wheel, persist]);

  /** 切换「移除已选中选项」 */
  const handleToggleRemoveAfterSpin = useCallback(async (checked: boolean) => {
    if (!wheel) return;
    if (wheel.soundEnabled) void playTap();
    await persist({ ...wheel, removeAfterSpin: checked });
  }, [wheel, persist]);

  const handleSavePresets = useCallback((next: WheelPreset[]) => {
    setPresets(next);
    savePresets(next);
  }, []);

  const title = useMemo(() => wheel?.name || '转盘', [wheel]);

  if (loading) {
    return (
      <div className="wheel-page wheel-loading">
        <span className="wheel-loading-dots"><i /><i /><i /></span>
        <span className="wheel-loading-text">正在把盘摆好…</span>
      </div>
    );
  }

  const revealed = !!result;

  return (
    <div className="wheel-page">
      {/* 1. 44px 顶条 */}
      <header className="wheel-bar">
        <button className="wheel-bar-btn" onClick={() => navigate(-1)} aria-label="返回">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button
          className="wheel-title"
          onClick={() => { setRenameText(title); setShowRename(true); }}
          title="点击重命名"
        >
          {title}
        </button>
        <div className="wheel-bar-right">
          <button
            className={`wheel-bar-btn ${wheel?.soundEnabled ? 'on' : ''}`}
            onClick={() => void handleToggleSound()}
            aria-label={wheel?.soundEnabled ? '关闭音效' : '开启音效'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4V5z" />
              {wheel?.soundEnabled
                ? <><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>
                : <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>}
            </svg>
          </button>
          <button
            className="wheel-bar-btn"
            onClick={() => setShowMenu(v => !v)}
            aria-label="更多"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
            </svg>
          </button>
        </div>
      </header>

      {/* 更多菜单（锚在右上） */}
      {showMenu && (
        <div className="wheel-menu-mask" onClick={() => setShowMenu(false)}>
          <div className="wheel-menu" onClick={e => e.stopPropagation()}>
            <div className="wheel-menu-label">换一个盘</div>
            <div className="wheel-menu-scroll">
              {sortWheelsByRecent(allWheels).map(w => (
                <button
                  key={w.id}
                  className={`wheel-menu-item ${w.id === wheel?.id ? 'active' : ''}`}
                  onClick={() => handleSwitchWheel(w.id)}
                >
                  {w.name}
                </button>
              ))}
            </div>
            <div className="wheel-menu-sep" />
            <button className="wheel-menu-item" onClick={() => { setShowMenu(false); setShowPanel(true); }}>
              编辑选项与预设
            </button>
            <button className="wheel-menu-item" onClick={() => void handleAddWheel()}>新建一个盘</button>
            <button className="wheel-menu-item danger" onClick={() => void handleDeleteWheel()}>删掉这个盘</button>
          </div>
        </div>
      )}

      {/* 重命名弹窗 */}
      {showRename && (
        <div className="wheel-menu-mask is-modal" onClick={() => setShowRename(false)}>
          <div className="wheel-rename-panel" onClick={e => e.stopPropagation()}>
            <div className="wheel-sheet-title">给盘起个名</div>
            <input
              className="wheel-rename-input"
              value={renameText}
              autoFocus
              maxLength={16}
              onChange={e => setRenameText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
            />
            <div className="wheel-rename-btns">
              <button onClick={() => setShowRename(false)}>算了</button>
              <button className="primary" onClick={() => void handleRename()}>改名</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 舞台：刻度环 + 转盘 + 揭晓 */}
      <div className="wheel-body">
        <section className={`wheel-stage ${revealed ? 'is-revealed' : ''}`}>
          <div className="wheel-instrument">
            <span className="wheel-scale" aria-hidden />
            <WheelCanvas
              options={options}
              rotation={rotation}
              spinning={spinning}
              highlightIndex={highlightIndex}
              onSpin={handleSpin}
              duration={SPIN_DURATION}
            />
          </div>

          {result && (
            <div className="wheel-reveal">
              <b className="wheel-reveal-text">{result.text}</b>
              <span className="wheel-reveal-sub">
                {wheel?.removeAfterSpin ? '这一项已经从盘上撤下' : '盘替你选了这一个'}
              </span>
            </div>
          )}
        </section>

        {/* 3. 最近记录（一行横向胶囊） */}
        <HistoryList history={wheel?.history ?? []} onClear={handleClearHistory} />
      </div>

      {/* 4. 底部拇指区 */}
      <div className="wheel-dock">
        {revealed ? (
          <>
            <button
              className="wheel-dock-btn ghost"
              disabled={spinning}
              onClick={() => void handleSpin()}
            >
              再转一次
            </button>
            <button className="wheel-dock-btn primary" onClick={() => setResult(null)}>
              就这么定
            </button>
          </>
        ) : (
          <>
            <button className="wheel-dock-btn ghost" onClick={() => setShowPanel(true)}>
              编辑选项
            </button>
            <button
              className="wheel-dock-btn primary"
              disabled={spinning || options.length < 2}
              onClick={() => void handleSpin()}
            >
              {spinning ? '转着…' : '转一次'}
            </button>
          </>
        )}
      </div>

      {/* 5. 选项 / 预设抽屉 */}
      {showPanel && (
        <>
          <div className="wheel-panel-mask" onClick={() => setShowPanel(false)} />
          <div className="wheel-panel">
            <span className="wheel-panel-grip" />
            <div className="wheel-panel-head">
              <span className="wheel-sheet-title">选项与预设</span>
              <button className="wheel-panel-done" onClick={() => setShowPanel(false)}>好了</button>
            </div>
            <div className="wheel-panel-scroll">
              <OptionList options={options} disabled={spinning} onChange={handleOptionsChange} />

              {/* 选项管理 与 场景预设 之间：移除已选中选项 */}
              <RemoveAfterSpinToggle
                checked={!!wheel?.removeAfterSpin}
                disabled={spinning}
                optionCount={options.length}
                onChange={handleToggleRemoveAfterSpin}
              />

              <PresetBar
                presets={presets}
                presetsVersion={0}
                disabled={spinning}
                onApply={handleApplyPreset}
                onEditPresets={() => setShowPresetEditor(true)}
                onAddWheel={handleAddWheel}
                options={options}
                onImportOptions={handleOptionsChange}
              />
            </div>
          </div>
        </>
      )}

      {/* 预设编辑器 */}
      {showPresetEditor && (
        <PresetEditor
          presets={presets}
          onSave={handleSavePresets}
          onClose={() => setShowPresetEditor(false)}
        />
      )}
    </div>
  );
}
