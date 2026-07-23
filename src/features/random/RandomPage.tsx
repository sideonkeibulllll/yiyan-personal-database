/**
 * 随机浏览页面
 * 卡片堆叠流式排列，自动填屏 + 分页刷新
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTodoStore } from '@/stores/todoStore';
import { weightedRandomSelect, filterEntries } from '@/services/random';
import { BottomNav } from '@/components/BottomNav';
import { QuickMenu } from './QuickMenu';
import { TagSelector } from '@/components/TagSelector';
import { AIChatPanel } from '@/components/AIChatPanel';
import { ImageViewer } from '@/components/ImageViewer';
import { readThumbAsSrc } from '@/services/attachmentService';
import { hasLocalOriginal, addMissingOriginal } from '@/services/syncService';
import type { Entry } from '@/types';
import './RandomPage.css';

/** 卡片间距 (px) */
const CARD_GAP = 12;

/** SVG icons (stroke-based, viewBox="0 0 24 24", strokeWidth="1.5") */
const FunnelIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>
    <path d="m3 3 9 9-3 3 9 9"/>
  </svg>
);

const RefreshIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
  </svg>
);

const StarFilledIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const StarOutlineIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
  </svg>
);

const InboxIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </svg>
);

const PaperclipIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export function RandomPage() {
  const navigate = useNavigate();
  const entries = useEntryStore(state => state.entries);
  const markAsUsed = useEntryStore(state => state.markAsUsed);
  const toggleStar = useEntryStore(state => state.toggleStar);
  const tags = useTagStore(state => state.tags);
  const settings = useSettingsStore(state => state.settings);
  const cardsPerPage = settings.random?.cardsPerPage ?? 7;
  const attachmentMode = settings.random?.attachmentDisplayMode ?? 'inline';

  // 当前展示的一批条目
  const [currentEntries, setCurrentEntries] = useState<Entry[]>([]);
  // 上次抽取的 id 列表，用于避免连续两屏重复
  const lastIdsRef = useRef<Set<string>>(new Set());

  // 每条 entry 的缩略图 src 数组（与 entry.attachments 顺序一致）
  const [thumbSrcsByEntry, setThumbSrcsByEntry] = useState<Record<string, string[]>>({});
  // 图片查看器状态
  const [viewerState, setViewerState] = useState<{ images: string[]; startIndex: number } | null>(null);

  const [showMenu, setShowMenu] = useState(false);
  const [menuEntry, setMenuEntry] = useState<Entry | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [tagSelectorEntry, setTagSelectorEntry] = useState<Entry | null>(null);
  const [showAIChat, setShowAIChat] = useState(false);
  const [chatEntry, setChatEntry] = useState<Entry | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 每张卡片的长按计时器
  const longPressTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [pressedId, setPressedId] = useState<string | null>(null);

  // 筛选条件
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [filterStarred, setFilterStarred] = useState<boolean | undefined>(undefined);

  // 抽取一批随机条目
  const getRandomEntries = useCallback(() => {
    const filtered = filterEntries(entries, {
      tagIds: filterTagIds.length > 0 ? filterTagIds : undefined,
      isStarred: filterStarred,
    });

    if (filtered.length === 0) {
      setCurrentEntries([]);
      setIsLoading(false);
      return;
    }

    // 排除上一屏出现过的条目（如果过滤后仍足够多）
    const lastIds = lastIdsRef.current;
    let candidates = filtered;
    if (filtered.length > lastIds.size + cardsPerPage) {
      candidates = filtered.filter(e => !lastIds.has(e.id));
    }

    // Fisher-Yates 部分洗牌：只洗前 cardsPerPage 个位置
    const result: Entry[] = [];
    const usedIds = new Set<string>();
    const pickCount = Math.min(cardsPerPage, candidates.length);

    for (let i = 0; i < pickCount; i++) {
      const remaining = candidates.filter(e => !usedIds.has(e.id));
      if (remaining.length === 0) break;
      const selected = weightedRandomSelect(remaining);
      if (!selected) break;
      result.push(selected);
      usedIds.add(selected.id);
    }

    // 如果排除后不够，从全量里补
    if (result.length < cardsPerPage && filtered.length > result.length) {
      for (let i = result.length; i < Math.min(cardsPerPage, filtered.length); i++) {
        const remaining = filtered.filter(e => !usedIds.has(e.id));
        if (remaining.length === 0) break;
        const selected = weightedRandomSelect(remaining);
        if (!selected) break;
        result.push(selected);
        usedIds.add(selected.id);
      }
    }

    // 更新 lastIds
    lastIdsRef.current = new Set(result.map(e => e.id));

    setCurrentEntries(result);
    setIsLoading(false);
  }, [entries, filterTagIds, filterStarred, cardsPerPage]);

  // 初始加载
  useEffect(() => {
    if (entries.length > 0) {
      getRandomEntries();
    } else {
      setIsLoading(false);
    }
  }, [entries, getRandomEntries]);

  // 加载当前批次的缩略图
  useEffect(() => {
    let cancelled = false;
    const loadThumbs = async () => {
      const entriesWithAtts = currentEntries.filter(
        e => e.attachments && e.attachments.length > 0
      );
      if (entriesWithAtts.length === 0) {
        setThumbSrcsByEntry({});
        return;
      }
      const map: Record<string, string[]> = {};
      await Promise.all(entriesWithAtts.map(async (entry) => {
        const srcs = await Promise.all(
          (entry.attachments || []).map(a => readThumbAsSrc(a.thumbPath))
        );
        if (!cancelled) map[entry.id] = srcs.filter(Boolean);
      }));
      if (!cancelled) setThumbSrcsByEntry(map);
    };
    loadThumbs();
    return () => { cancelled = true; };
  }, [currentEntries]);

  // 打开图片查看器
  const openViewer = useCallback((entryId: string, startIndex: number) => {
    const images = thumbSrcsByEntry[entryId] || [];
    if (images.length === 0) return;
    setViewerState({ images, startIndex });

    // 点开大图时，检查本地是否有原图；缺失的加入待拉取队列
    // 队列会在下次同步连接到任意有原图的设备时批量拉取（省电，不时刻保持连接）
    const entry = currentEntries.find(e => e.id === entryId);
    if (entry?.attachments) {
      // 不阻塞 UI，异步检查
      Promise.all(
        entry.attachments.map(async (att) => {
          const has = await hasLocalOriginal(att.filePath);
          if (!has) addMissingOriginal(att.id, att.filePath);
        })
      ).catch(() => { /* ignore */ });
    }
  }, [thumbSrcsByEntry, currentEntries]);

  // 阻止冒泡（避免触发卡片复制/长按）
  const stopPropagation = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  // 复制内容
  const handleCopy = useCallback(async (entry: Entry) => {
    // === 修复 2：记录复制时间戳到全局 ===
    const COPY_KEY = '__yiyan_last_copy_at__';
    const copyMap: Record<string, number> = (window as any)[COPY_KEY] || {};
    copyMap[entry.id] = Date.now();
    (window as any)[COPY_KEY] = copyMap;

    try {
      await navigator.clipboard.writeText(entry.content);
      markAsUsed(entry.id);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = entry.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markAsUsed(entry.id);
    }
  }, [markAsUsed]);

  const addTodo = useTodoStore(state => state.addTodo);

  // 转为待办
  const handleConvertToTodo = useCallback(async (e: Entry) => {
    const today = new Date();
    const folderDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await addTodo({
      title: e.content.slice(0, 80) + (e.content.length > 80 ? '...' : ''),
      folderDate,
      isToday: true,
    });
  }, [addTodo]);

  // 长按开始
  const handlePressStart = useCallback((entryId: string) => {
    setPressedId(entryId);
    const timer = setTimeout(() => {
      const entry = currentEntries.find(e => e.id === entryId);
      if (entry) {
        // === 修复 2：记录长按菜单时间戳到全局 ===
        const MENU_KEY = '__yiyan_last_menu_at__';
        const menuMap: Record<string, number> = (window as any)[MENU_KEY] || {};
        menuMap[entryId] = Date.now();
        (window as any)[MENU_KEY] = menuMap;

        setMenuEntry(entry);
        setShowMenu(true);
      }
      setPressedId(null);
    }, 500);
    longPressTimersRef.current.set(entryId, timer);
  }, [currentEntries]);

  // 长按结束
  const handlePressEnd = useCallback((entryId: string) => {
    setPressedId(null);
    const timer = longPressTimersRef.current.get(entryId);
    if (timer) {
      clearTimeout(timer);
      longPressTimersRef.current.delete(entryId);
    }
  }, []);

  // 切换星标
  const handleToggleStar = useCallback((entryId: string) => {
    const entry = currentEntries.find(e => e.id === entryId);
    if (!entry) return;
    toggleStar(entryId);
    // 更新本地状态
    setCurrentEntries(prev =>
      prev.map(e =>
        e.id === entryId ? { ...e, isStarred: !e.isStarred } : e
      )
    );
    if (menuEntry && menuEntry.id === entryId) {
      setMenuEntry({ ...menuEntry, isStarred: !menuEntry.isStarred });
    }
  }, [currentEntries, toggleStar, menuEntry]);

  // 下一屏（重新随机抽取）
  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    getRandomEntries();
  }, [getRandomEntries]);

  // 筛选变更
  const handleFilterChange = useCallback((tagIds: string[], starred?: boolean) => {
    setFilterTagIds(tagIds);
    setFilterStarred(starred);
    setShowFilter(false);
    lastIdsRef.current = new Set();
    setIsLoading(true);

    // 重新获取随机条目
    const filtered = filterEntries(entries, {
      tagIds: tagIds.length > 0 ? tagIds : undefined,
      isStarred: starred,
    });

    if (filtered.length === 0) {
      setCurrentEntries([]);
      setIsLoading(false);
      return;
    }

    const result: Entry[] = [];
    const usedIds = new Set<string>();
    const pickCount = Math.min(cardsPerPage, filtered.length);

    for (let i = 0; i < pickCount; i++) {
      const remaining = filtered.filter(e => !usedIds.has(e.id));
      if (remaining.length === 0) break;
      const selected = weightedRandomSelect(remaining);
      if (!selected) break;
      result.push(selected);
      usedIds.add(selected.id);
    }

    lastIdsRef.current = new Set(result.map(e => e.id));
    setCurrentEntries(result);
    setIsLoading(false);
  }, [entries, cardsPerPage]);

  // 清理长按计时器
  useEffect(() => {
    return () => {
      longPressTimersRef.current.forEach(timer => clearTimeout(timer));
      longPressTimersRef.current.clear();
    };
  }, []);

  if (isLoading) {
    return (
      <div className="random-page">
        <div className="loading-card glass">
          <div className="loading-spinner" />
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="random-page">
      {/* 筛选按钮 - 右上角浮动 */}
      <button className="filter-btn" onClick={() => setShowFilter(true)}>
        <FunnelIcon />
      </button>

      {/* 筛选标签显示 */}
      {(filterTagIds.length > 0 || filterStarred !== undefined) && (
        <div className="active-filters">
          {filterStarred !== undefined && (
            <span className="filter-badge">
              {filterStarred ? <><StarFilledIcon /> 已星标</> : <><StarOutlineIcon /> 未星标</>}
              <button onClick={() => handleFilterChange(filterTagIds, undefined)}><CloseIcon /></button>
            </span>
          )}
          {filterTagIds.map(tagId => {
            const tag = tags.find(t => t.id === tagId);
            return tag ? (
              <span key={tagId} className="filter-badge">
                #{tag.name}
                <button onClick={() => handleFilterChange(filterTagIds.filter(id => id !== tagId), filterStarred)}><CloseIcon /></button>
              </span>
            ) : null;
          })}
        </div>
      )}

      <main className="page-content">
        {currentEntries.length > 0 ? (
          <>
            <div className="cards-stack">
              {currentEntries.map((entry) => {
                return (
                  <div
                    key={entry.id}
                    className={`card-item ${pressedId === entry.id ? 'pressed' : ''}`}
                    onClick={() => handleCopy(entry)}
                    onMouseDown={() => handlePressStart(entry.id)}
                    onMouseUp={() => handlePressEnd(entry.id)}
                    onMouseLeave={() => handlePressEnd(entry.id)}
                    onTouchStart={() => handlePressStart(entry.id)}
                    onTouchEnd={() => handlePressEnd(entry.id)}
                  >
                    <div className="entry-card glass">
                      <div className="card-content">
                        {entry.content}
                      </div>

                      {/* 图片附件展示 - inline 模式：纵向堆叠在文本下方 */}
                      {attachmentMode === 'inline'
                        && entry.attachments
                        && entry.attachments.length > 0
                        && (thumbSrcsByEntry[entry.id] || []).length > 0 && (
                        <div
                          className="card-attachments"
                          onClick={stopPropagation}
                          onMouseDown={stopPropagation}
                          onMouseUp={stopPropagation}
                          onTouchStart={stopPropagation}
                          onTouchEnd={stopPropagation}
                        >
                          {thumbSrcsByEntry[entry.id].map((src, idx) => (
                            <img
                              key={idx}
                              src={src}
                              alt={`附件 ${idx + 1}`}
                              className="card-attachment-img"
                              loading="lazy"
                              onClick={() => openViewer(entry.id, idx)}
                            />
                          ))}
                        </div>
                      )}

                      <div className="card-meta">
                        {entry.isStarred && (
                          <span className="meta-star"><StarFilledIcon /></span>
                        )}
                        {entry.tags && entry.tags.length > 0 && (
                          <div className="meta-tags">
                            {entry.tags.map(tag => (
                              <span key={tag.id} className="meta-tag">#{tag.name}</span>
                            ))}
                          </div>
                        )}
                        {/* 图片附件展示 - badge 模式：仅显示附件数量徽标 */}
                        {attachmentMode === 'badge'
                          && entry.attachments
                          && entry.attachments.length > 0 && (
                          <span
                            className="meta-attachment-badge"
                            onClick={(e) => {
                              e.stopPropagation();
                              openViewer(entry.id, 0);
                            }}
                            onTouchStart={(e) => e.stopPropagation()}
                          >
                            <PaperclipIcon /> ×{entry.attachments.length}
                          </span>
                        )}
                        <span className="meta-time">
                          {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card-actions">
              <button className="nav-btn glass" onClick={handleRefresh}>
                <RefreshIcon />
                <span>刷新下一屏</span>
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-icon"><InboxIcon /></span>
            <p className="empty-text">没有符合条件的记忆</p>
            <p className="empty-hint">尝试调整筛选条件</p>
          </div>
        )}
      </main>

      {/* 快捷菜单 */}
      {showMenu && menuEntry && (
        <QuickMenu
          entry={menuEntry}
          onClose={() => setShowMenu(false)}
          onToggleStar={() => handleToggleStar(menuEntry.id)}
          onViewLinks={() => {
            setShowMenu(false);
            navigate(`/links/${menuEntry.id}`);
          }}
          onEditTags={() => {
            setShowMenu(false);
            setTagSelectorEntry(menuEntry);
            setShowTagSelector(true);
          }}
          onAIChat={(entryId) => {
            setShowMenu(false);
            const e = currentEntries.find(x => x.id === entryId);
            if (e) {
              setChatEntry(e);
              setShowAIChat(true);
            }
          }}
          onConvertToTodo={handleConvertToTodo}
          onEditInfo={(entry) => {
            setShowMenu(false);
            navigate(`/entry/${entry.id}/edit`);
          }}
        />
      )}

      {/* AI 对话面板 */}
      {showAIChat && chatEntry && (
        <div className="ai-chat-overlay" onClick={() => setShowAIChat(false)}>
          <div className="ai-chat-container" onClick={e => e.stopPropagation()}>
            <AIChatPanel
              entry={chatEntry}
              onClose={() => setShowAIChat(false)}
            />
          </div>
        </div>
      )}

      {/* 筛选面板 */}
      {showFilter && (
        <div className="filter-overlay" onClick={() => setShowFilter(false)}>
          <div className="filter-panel glass" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <h3>筛选条件</h3>
              <button onClick={() => setShowFilter(false)}><CloseIcon /></button>
            </div>

            {/* 星标筛选 */}
            <div className="filter-section">
              <label className="filter-label">星标状态</label>
              <div className="star-filter">
                <button
                  className={filterStarred === undefined ? 'active' : ''}
                  onClick={() => handleFilterChange(filterTagIds, undefined)}
                >
                  全部
                </button>
                <button
                  className={filterStarred === true ? 'active' : ''}
                  onClick={() => handleFilterChange(filterTagIds, true)}
                >
                  <StarFilledIcon /> 已星标
                </button>
                <button
                  className={filterStarred === false ? 'active' : ''}
                  onClick={() => handleFilterChange(filterTagIds, false)}
                >
                  <StarOutlineIcon /> 未星标
                </button>
              </div>
            </div>

            {/* 标签筛选 */}
            <div className="filter-section">
              <label className="filter-label">标签筛选</label>
              <TagSelector
                selectedTagIds={filterTagIds}
                onSelectionChange={setFilterTagIds}
              />
            </div>
          </div>
        </div>
      )}

      {/* 标签选择器 */}
      {showTagSelector && tagSelectorEntry && (
        <div className="filter-overlay" onClick={() => setShowTagSelector(false)}>
          <div className="filter-panel glass" onClick={e => e.stopPropagation()}>
            <TagSelector
              selectedTagIds={tagSelectorEntry.tags?.map(t => t.id) || []}
              onSelectionChange={async (tagIds) => {
                // TODO: 保存标签变更
                setShowTagSelector(false);
              }}
              onClose={() => setShowTagSelector(false)}
            />
          </div>
        </div>
      )}

      {/* 图片查看器 */}
      {viewerState && (
        <ImageViewer
          images={viewerState.images}
          startIndex={viewerState.startIndex}
          onClose={() => setViewerState(null)}
        />
      )}

      <BottomNav />
    </div>
  );
}
