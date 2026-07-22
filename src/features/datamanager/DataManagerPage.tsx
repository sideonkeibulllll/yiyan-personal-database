/**
 * 数据管理器主页面
 * MT管理器风格双栏文件管理
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDatabase } from '@/services/database';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { incrementalImport } from '@/utils/import';
import { SideMenu } from './SideMenu';
import { FileManagerWindow } from './FileManagerWindow';
import type { ManagerMode, WindowState, PathSegment, SortBy, ImportResult } from './types';
import { createInitialWindowState } from './types';
import './DataManagerPage.css';

export function DataManagerPage() {
  const navigate = useNavigate();
  const params = useParams<{ mode?: string }>();

  // 确定初始模式
  const initialMode: ManagerMode = (() => {
    const m = params.mode;
    if (m === 'tags' || m === 'groups' || m === 'data') return m;
    return 'tags';
  })();

  // 两个窗口的状态
  const [leftWindow, setLeftWindow] = useState<WindowState>(() => createInitialWindowState(initialMode));
  const [rightWindow, setRightWindow] = useState<WindowState>(() => createInitialWindowState(initialMode));
  const [activeWindow, setActiveWindow] = useState<'left' | 'right'>('left');

  // 当 URL 参数变化时，同步模式
  useEffect(() => {
    const m = params.mode;
    const mode: ManagerMode = (m === 'tags' || m === 'groups' || m === 'data') ? m : 'tags';
    const currentMode = leftWindow.mode;
    if (mode !== currentMode) {
      setLeftWindow(createInitialWindowState(mode));
      setRightWindow(createInitialWindowState(mode));
    }
  }, [params.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // UI 状态
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [showImportResult, setShowImportResult] = useState<ImportResult | null>(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [actionMenuEntryId, setActionMenuEntryId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadEntries = useEntryStore(state => state.loadEntries);
  const loadTags = useTagStore(state => state.loadTags);

  // 显示提示
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  // 模式切换
  const handleModeChange = useCallback((mode: ManagerMode) => {
    const newLeft = createInitialWindowState(mode);
    const newRight = createInitialWindowState(mode);
    setLeftWindow(newLeft);
    setRightWindow(newRight);
    navigate(`/data-manager/${mode}`);
  }, [navigate]);

  // 路径导航
  const navigateTo = useCallback((side: 'left' | 'right', path: PathSegment[]) => {
    const setter = side === 'left' ? setLeftWindow : setRightWindow;
    setter(prev => {
      const newHistory = prev.history.slice(0, prev.historyIndex + 1);
      newHistory.push(path);
      return {
        ...prev,
        path,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        selectedIds: new Set(),
      };
    });
  }, []);

  // 监听子组件导航事件
  useEffect(() => {
    const handleNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { side: 'left' | 'right'; path: PathSegment[] };
      navigateTo(detail.side, detail.path);
    };
    const handleClearSelection = (e: Event) => {
      const detail = (e as CustomEvent).detail as { side: 'left' | 'right' };
      const setter = detail.side === 'left' ? setLeftWindow : setRightWindow;
      setter(prev => ({ ...prev, selectedIds: new Set() }));
    };
    window.addEventListener('dm-navigate', handleNavigate);
    window.addEventListener('dm-clear-selection', handleClearSelection);
    return () => {
      window.removeEventListener('dm-navigate', handleNavigate);
      window.removeEventListener('dm-clear-selection', handleClearSelection);
    };
  }, [navigateTo]);

  // 选中条目
  const handleSelect = useCallback((id: string) => {
    const setter = activeWindow === 'left' ? setLeftWindow : setRightWindow;
    setter(prev => {
      const newSelected = new Set<string>();
      newSelected.add(id);
      return { ...prev, selectedIds: newSelected };
    });
  }, [activeWindow]);

  // 多选切换
  const handleMultiSelectToggle = useCallback((id: string) => {
    const setter = activeWindow === 'left' ? setLeftWindow : setRightWindow;
    setter(prev => {
      const newSelected = new Set(prev.selectedIds);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return { ...prev, selectedIds: newSelected };
    });
  }, [activeWindow]);

  // 长按
  const handleLongPress = useCallback((id: string) => {
    setActionMenuEntryId(id);
    setShowActionMenu(true);
  }, []);

  // 底部操作：返回上一路径
  const handleBack = useCallback(() => {
    const setter = activeWindow === 'left' ? setLeftWindow : setRightWindow;
    setter(prev => {
      if (prev.historyIndex <= 0) return prev;
      const newIndex = prev.historyIndex - 1;
      return {
        ...prev,
        path: prev.history[newIndex],
        historyIndex: newIndex,
        selectedIds: new Set(),
      };
    });
  }, [activeWindow]);

  // 底部操作：前进
  const handleForward = useCallback(() => {
    const setter = activeWindow === 'left' ? setLeftWindow : setRightWindow;
    setter(prev => {
      if (prev.historyIndex >= prev.history.length - 1) return prev;
      const newIndex = prev.historyIndex + 1;
      return {
        ...prev,
        path: prev.history[newIndex],
        historyIndex: newIndex,
        selectedIds: new Set(),
      };
    });
  }, [activeWindow]);

  // 底部操作：返回上级
  const handleUp = useCallback(() => {
    const setter = activeWindow === 'left' ? setLeftWindow : setRightWindow;
    setter(prev => {
      if (prev.path.length <= 1) return prev;
      const newPath = prev.path.slice(0, -1);
      const newHistory = prev.history.slice(0, prev.historyIndex + 1);
      newHistory.push(newPath);
      return {
        ...prev,
        path: newPath,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        selectedIds: new Set(),
      };
    });
  }, [activeWindow]);

  // 底部操作：新建
  const handleNew = useCallback(() => {
    const currentWindow = activeWindow === 'left' ? leftWindow : rightWindow;
    const isRoot = currentWindow.path.length === 1;
    if (isRoot && (currentWindow.mode === 'tags' || currentWindow.mode === 'groups')) {
      setShowNewDialog(true);
      setNewName('');
    } else {
      showToast('只能在此模式的根路径下新建');
    }
  }, [activeWindow, leftWindow, rightWindow, showToast]);

  // 确认新建
  const confirmNew = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      const db = await getDatabase();
      const currentWindow = activeWindow === 'left' ? leftWindow : rightWindow;
      if (currentWindow.mode === 'tags') {
        await db.createTag(newName.trim());
        showToast(`标签 "${newName.trim()}" 已创建`);
      } else if (currentWindow.mode === 'groups') {
        await db.createGroup(newName.trim());
        showToast(`组 "${newName.trim()}" 已创建`);
      }
      setShowNewDialog(false);
      setNewName('');
      // 刷新两个窗口
      setLeftWindow(prev => ({ ...prev }));
      setRightWindow(prev => ({ ...prev }));
      await loadTags();
    } catch (err) {
      showToast('创建失败: ' + (err as Error).message);
    }
  }, [newName, activeWindow, leftWindow, rightWindow, showToast, loadTags]);

  // 底部操作：窗口复制
  const handleSwap = useCallback(() => {
    const sourceWindow = activeWindow === 'left' ? leftWindow : rightWindow;
    const targetSetter = activeWindow === 'left' ? setRightWindow : setLeftWindow;
    targetSetter(prev => {
      const newHistory = [...prev.history];
      newHistory.push(sourceWindow.path);
      return {
        ...prev,
        mode: sourceWindow.mode,
        path: sourceWindow.path,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        selectedIds: new Set(),
      };
    });
    showToast('已复制路径到另一窗口');
  }, [activeWindow, leftWindow, rightWindow, showToast]);

  // 排序方式切换
  const handleSortChange = useCallback((sortBy: SortBy) => {
    const setter = activeWindow === 'left' ? setLeftWindow : setRightWindow;
    setter(prev => ({ ...prev, sortBy }));
    setShowSortMenu(false);
  }, [activeWindow]);

  // 刷新
  const handleRefresh = useCallback(() => {
    setLeftWindow(prev => ({ ...prev }));
    setRightWindow(prev => ({ ...prev }));
    setShowMoreMenu(false);
    showToast('已刷新');
  }, [showToast]);

  // 全选
  const handleSelectAll = useCallback(() => {
    const setter = activeWindow === 'left' ? setLeftWindow : setRightWindow;
    setter(prev => {
      // 全选当前列表中的所有条目ID（仅文件类型）
      // 由于我们没有直接访问items，触发一个刷新
      return { ...prev };
    });
    setShowMoreMenu(false);
    // 通过自定义事件通知窗口全选
    const event = new CustomEvent('dm-select-all', { detail: { side: activeWindow } });
    window.dispatchEvent(event);
    showToast('全选');
  }, [activeWindow, showToast]);

  // 搜索（简化：跳转到搜索页）
  const handleSearch = useCallback(() => {
    setShowMoreMenu(false);
    navigate('/search');
  }, [navigate]);

  // 导入
  const handleImport = useCallback(() => {
    setShowMoreMenu(false);
    fileInputRef.current?.click();
  }, []);

  // 文件选择处理
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = await incrementalImport(text);
      setShowImportResult(result);
      // 刷新数据
      await loadEntries();
      await loadTags();
      setLeftWindow(prev => ({ ...prev }));
      setRightWindow(prev => ({ ...prev }));
    } catch (err) {
      showToast('导入失败: ' + (err as Error).message);
    }

    // 清空 input
    e.target.value = '';
  }, [loadEntries, loadTags, showToast]);

  // 操作菜单：复制内容
  const handleCopyContent = useCallback(async () => {
    if (!actionMenuEntryId) return;
    try {
      const db = await getDatabase();
      const entry = await db.getEntryById(actionMenuEntryId);
      if (entry) {
        await navigator.clipboard.writeText(entry.content);
        await db.updateEntry(entry.id, {
          copyCount: (entry.copyCount || 0) + 1,
          lastUsedAt: Date.now(),
        });
        showToast('已复制到剪贴板');
      }
    } catch {
      showToast('复制失败');
    }
    setShowActionMenu(false);
    setActionMenuEntryId(null);
  }, [actionMenuEntryId, showToast]);

  // 操作菜单：复制到另一窗口
  const handleCopyToOther = useCallback(async () => {
    const sourceWindow = activeWindow === 'left' ? leftWindow : rightWindow;
    const targetWindow = activeWindow === 'left' ? rightWindow : leftWindow;
    const selectedIds = sourceWindow.selectedIds;

    if (selectedIds.size === 0) {
      showToast('请先选择条目');
      setShowActionMenu(false);
      return;
    }

    try {
      const db = await getDatabase();
      const targetPath = targetWindow.path;

      // 目标必须是某个文件夹内
      if (targetPath.length < 2) {
        showToast('目标窗口需要在某个文件夹内');
        setShowActionMenu(false);
        return;
      }

      const targetFolderId = targetPath[targetPath.length - 1].id;

      for (const entryId of selectedIds) {
        if (targetWindow.mode === 'tags') {
          await db.addTagToEntry(entryId, targetFolderId);
        } else if (targetWindow.mode === 'groups') {
          await db.updateEntry(entryId, { groupId: targetFolderId });
        }
      }

      showToast(`已复制 ${selectedIds.size} 条到另一窗口`);
      // 刷新
      setLeftWindow(prev => ({ ...prev }));
      setRightWindow(prev => ({ ...prev }));
      await loadEntries();
    } catch (err) {
      showToast('操作失败: ' + (err as Error).message);
    }

    setShowActionMenu(false);
    setActionMenuEntryId(null);
  }, [activeWindow, leftWindow, rightWindow, showToast, loadEntries]);

  // 操作菜单：移动到另一窗口
  const handleMoveToOther = useCallback(async () => {
    const sourceWindow = activeWindow === 'left' ? leftWindow : rightWindow;
    const targetWindow = activeWindow === 'left' ? rightWindow : leftWindow;
    const selectedIds = sourceWindow.selectedIds;

    if (selectedIds.size === 0) {
      showToast('请先选择条目');
      setShowActionMenu(false);
      return;
    }

    try {
      const db = await getDatabase();
      const sourcePath = sourceWindow.path;
      const targetPath = targetWindow.path;

      if (targetPath.length < 2) {
        showToast('目标窗口需要在某个文件夹内');
        setShowActionMenu(false);
        return;
      }

      const targetFolderId = targetPath[targetPath.length - 1].id;
      const sourceFolderId = sourcePath.length >= 2 ? sourcePath[sourcePath.length - 1].id : null;

      for (const entryId of selectedIds) {
        if (sourceWindow.mode === 'tags' && sourceFolderId) {
          // 移除旧标签
          await db.removeTagFromEntry(entryId, sourceFolderId);
        }
        if (targetWindow.mode === 'tags') {
          await db.addTagToEntry(entryId, targetFolderId);
        } else if (targetWindow.mode === 'groups') {
          await db.updateEntry(entryId, { groupId: targetFolderId });
        }
      }

      showToast(`已移动 ${selectedIds.size} 条到另一窗口`);
      setLeftWindow(prev => ({ ...prev }));
      setRightWindow(prev => ({ ...prev }));
      await loadEntries();
    } catch (err) {
      showToast('操作失败: ' + (err as Error).message);
    }

    setShowActionMenu(false);
    setActionMenuEntryId(null);
  }, [activeWindow, leftWindow, rightWindow, showToast, loadEntries]);

  // 操作菜单：删除属性
  const handleDeleteProperty = useCallback(async () => {
    const sourceWindow = activeWindow === 'left' ? leftWindow : rightWindow;
    const selectedIds = sourceWindow.selectedIds;

    if (selectedIds.size === 0) {
      showToast('请先选择条目');
      setShowActionMenu(false);
      return;
    }

    try {
      const db = await getDatabase();
      const sourcePath = sourceWindow.path;
      const sourceFolderId = sourcePath.length >= 2 ? sourcePath[sourcePath.length - 1].id : null;

      if (sourceWindow.mode === 'data') {
        // 数据模式：真正删除条目
        if (!confirm(`确定删除 ${selectedIds.size} 条条目？此操作不可恢复！`)) {
          setShowActionMenu(false);
          return;
        }
        for (const entryId of selectedIds) {
          await db.deleteEntry(entryId);
        }
        showToast(`已删除 ${selectedIds.size} 条条目`);
      } else if (sourceWindow.mode === 'tags' && sourceFolderId) {
        // 标签模式：移除标签
        if (!confirm(`确定从 ${selectedIds.size} 条条目移除此标签？`)) {
          setShowActionMenu(false);
          return;
        }
        for (const entryId of selectedIds) {
          await db.removeTagFromEntry(entryId, sourceFolderId);
        }
        showToast(`已移除 ${selectedIds.size} 条条目的标签`);
      } else if (sourceWindow.mode === 'groups' && sourceFolderId) {
        // 组模式：清除 groupId
        if (!confirm(`确定从 ${selectedIds.size} 条条目移除组归属？`)) {
          setShowActionMenu(false);
          return;
        }
        for (const entryId of selectedIds) {
          await db.updateEntry(entryId, { groupId: undefined });
        }
        showToast(`已移除 ${selectedIds.size} 条条目的组归属`);
      }

      setLeftWindow(prev => ({ ...prev }));
      setRightWindow(prev => ({ ...prev }));
      await loadEntries();
    } catch (err) {
      showToast('操作失败: ' + (err as Error).message);
    }

    setShowActionMenu(false);
    setActionMenuEntryId(null);
  }, [activeWindow, leftWindow, rightWindow, showToast, loadEntries]);

  // 操作菜单：查看详情
  const handleViewDetail = useCallback(async () => {
    if (!actionMenuEntryId) return;
    setShowActionMenu(false);
    // 简化：弹出详情
    try {
      const db = await getDatabase();
      const entry = await db.getEntryById(actionMenuEntryId);
      if (entry) {
        const tagNames = entry.tags?.map(t => t.name).join(', ') || '无';
        showToast(`内容: ${entry.content.slice(0, 60)}... | 标签: ${tagNames} | 来源: ${entry.source || '无'}`);
      }
    } catch {
      showToast('查看失败');
    }
    setActionMenuEntryId(null);
  }, [actionMenuEntryId, showToast]);

  // 当前窗口
  const currentWindow = activeWindow === 'left' ? leftWindow : rightWindow;
  const canGoBack = currentWindow.historyIndex > 0;
  const canGoForward = currentWindow.historyIndex < currentWindow.history.length - 1;
  const canGoUp = currentWindow.path.length > 1;
  const canCreate = currentWindow.path.length === 1 && currentWindow.mode !== 'data';

  return (
    <div className="dm-page">
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 顶部栏 */}
      <header className="dm-header">
        <button className="dm-header-btn" onClick={() => setSideMenuOpen(true)}>
          ☰
        </button>
        <div className="dm-breadcrumb">
          {currentWindow.path.map((seg, i) => (
            <span key={i} className="dm-crumb">
              {i > 0 && <span className="dm-crumb-sep">/</span>}
              <span className="dm-crumb-label">{seg.label}</span>
            </span>
          ))}
        </div>
        <button className="dm-header-btn" onClick={() => setShowMoreMenu(!showMoreMenu)}>
          ⋮
        </button>
      </header>

      {/* 三点菜单 */}
      {showMoreMenu && (
        <>
          <div className="dm-overlay" onClick={() => setShowMoreMenu(false)} />
          <div className="dm-more-menu glass">
            <button className="dm-more-item" onClick={handleRefresh}>
              <span>🔄</span> 刷新
            </button>
            <button className="dm-more-item" onClick={handleSearch}>
              <span>🔍</span> 搜索
            </button>
            <button className="dm-more-item" onClick={handleSelectAll}>
              <span>☑️</span> 全选
            </button>
            <button className="dm-more-item" onClick={() => { setShowSortMenu(!showSortMenu); }}>
              <span>📊</span> 排序方式
            </button>
            {currentWindow.mode === 'data' && (
              <button className="dm-more-item" onClick={handleImport}>
                <span>📥</span> 导入数据
              </button>
            )}
          </div>
        </>
      )}

      {/* 排序子菜单 */}
      {showSortMenu && (
        <div className="dm-sort-menu glass">
          <button
            className={`dm-sort-item ${currentWindow.sortBy === 'time' ? 'active' : ''}`}
            onClick={() => handleSortChange('time')}
          >
            按时间
          </button>
          <button
            className={`dm-sort-item ${currentWindow.sortBy === 'name' ? 'active' : ''}`}
            onClick={() => handleSortChange('name')}
          >
            按名称
          </button>
          <button
            className={`dm-sort-item ${currentWindow.sortBy === 'usage' ? 'active' : ''}`}
            onClick={() => handleSortChange('usage')}
          >
            按使用次数
          </button>
        </div>
      )}

      {/* 双栏窗口 */}
      <div className="dm-windows">
        <div className="dm-window-wrapper" onClick={() => setActiveWindow('left')}>
          <FileManagerWindow
            side="left"
            state={leftWindow}
            isActive={activeWindow === 'left'}
            onSelect={handleSelect}
            onMultiSelectToggle={handleMultiSelectToggle}
            onLongPress={handleLongPress}
          />
        </div>
        <div className="dm-window-wrapper" onClick={() => setActiveWindow('right')}>
          <FileManagerWindow
            side="right"
            state={rightWindow}
            isActive={activeWindow === 'right'}
            onSelect={handleSelect}
            onMultiSelectToggle={handleMultiSelectToggle}
            onLongPress={handleLongPress}
          />
        </div>
      </div>

      {/* 底部操作栏 */}
      <footer className="dm-footer">
        <button
          className="dm-footer-btn"
          disabled={!canGoBack}
          onClick={handleBack}
          title="后退"
        >
          ←
        </button>
        <button
          className="dm-footer-btn"
          disabled={!canGoForward}
          onClick={handleForward}
          title="前进"
        >
          →
        </button>
        <button
          className="dm-footer-btn"
          disabled={!canCreate}
          onClick={handleNew}
          title="新建"
        >
          +
        </button>
        <button
          className="dm-footer-btn"
          onClick={handleSwap}
          title="复制路径到另一窗口"
        >
          ⇄
        </button>
        <button
          className="dm-footer-btn"
          disabled={!canGoUp}
          onClick={handleUp}
          title="返回上级"
        >
          ↑
        </button>
      </footer>

      {/* 侧边栏 */}
      <SideMenu
        open={sideMenuOpen}
        currentMode={currentWindow.mode}
        onModeChange={handleModeChange}
        onClose={() => setSideMenuOpen(false)}
      />

      {/* 新建对话框 */}
      {showNewDialog && (
        <div className="dm-dialog-overlay" onClick={() => setShowNewDialog(false)}>
          <div className="dm-dialog glass" onClick={e => e.stopPropagation()}>
            <h3 className="dm-dialog-title">
              新建{currentWindow.mode === 'tags' ? '标签' : '组'}
            </h3>
            <input
              className="dm-dialog-input"
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={`输入${currentWindow.mode === 'tags' ? '标签' : '组'}名称`}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') confirmNew();
                if (e.key === 'Escape') setShowNewDialog(false);
              }}
            />
            <div className="dm-dialog-actions">
              <button className="dm-dialog-btn cancel" onClick={() => setShowNewDialog(false)}>
                取消
              </button>
              <button className="dm-dialog-btn confirm" onClick={confirmNew}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 条目操作菜单 */}
      {showActionMenu && (
        <>
          <div className="dm-overlay" onClick={() => { setShowActionMenu(false); setActionMenuEntryId(null); }} />
          <div className="dm-action-menu glass">
            <button className="dm-action-item" onClick={handleCopyContent}>
              <span>📋</span> 复制内容
            </button>
            <button className="dm-action-item" onClick={handleCopyToOther}>
              <span>📑</span> 复制到另一窗口
            </button>
            <button className="dm-action-item" onClick={handleMoveToOther}>
              <span>✂️</span> 移动到另一窗口
            </button>
            <button className="dm-action-item danger" onClick={handleDeleteProperty}>
              <span>🗑️</span> 删除
            </button>
            <button className="dm-action-item" onClick={handleViewDetail}>
              <span>ℹ️</span> 查看详情
            </button>
          </div>
        </>
      )}

      {/* 导入结果 */}
      {showImportResult && (
        <div className="dm-dialog-overlay" onClick={() => setShowImportResult(null)}>
          <div className="dm-dialog glass" onClick={e => e.stopPropagation()}>
            <h3 className="dm-dialog-title">导入完成</h3>
            <div className="dm-import-result">
              <div className="dm-import-stat">
                <span className="dm-import-stat-label">总计</span>
                <span className="dm-import-stat-value">{showImportResult.total}</span>
              </div>
              <div className="dm-import-stat">
                <span className="dm-import-stat-label">新增</span>
                <span className="dm-import-stat-value success">{showImportResult.imported}</span>
              </div>
              <div className="dm-import-stat">
                <span className="dm-import-stat-label">跳过</span>
                <span className="dm-import-stat-value warning">{showImportResult.skipped}</span>
              </div>
              {showImportResult.errors.length > 0 && (
                <div className="dm-import-errors">
                  {showImportResult.errors.map((err, i) => (
                    <div key={i} className="dm-import-error">{err}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="dm-dialog-actions">
              <button className="dm-dialog-btn confirm" onClick={() => setShowImportResult(null)}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="dm-toast glass">{toast}</div>
      )}
    </div>
  );
}
