/**
 * 随机浏览页面
 * 加权随机"抽卡"浏览体验
 */
import { useState, useEffect, useCallback } from 'react';
import { useEntryStore } from '@/stores/entryStore';
import { weightedRandomSelect, filterEntries } from '@/services/random';
import { BottomNav } from '@/components/BottomNav';
import { QuickMenu } from './QuickMenu';
import type { Entry } from '@/types';
import './RandomPage.css';

export function RandomPage() {
  const entries = useEntryStore(state => state.entries);
  const markAsUsed = useEntryStore(state => state.markAsUsed);
  const toggleStar = useEntryStore(state => state.toggleStar);

  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [isPressed, setIsPressed] = useState(false);

  // 获取随机条目
  const getRandomEntry = useCallback(() => {
    const filtered = filterEntries(entries);
    const selected = weightedRandomSelect(filtered);
    setCurrentEntry(selected);
    setIsLoading(false);
  }, [entries]);

  // 初始加载
  useEffect(() => {
    if (entries.length > 0) {
      getRandomEntry();
    } else {
      setIsLoading(false);
    }
  }, [entries, getRandomEntry]);

  // 复制内容
  const handleCopy = useCallback(async () => {
    if (!currentEntry) return;

    try {
      await navigator.clipboard.writeText(currentEntry.content);
      markAsUsed(currentEntry.id);
    } catch {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = currentEntry.content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      markAsUsed(currentEntry.id);
    }
  }, [currentEntry, markAsUsed]);

  // 长按开始
  const handlePressStart = useCallback(() => {
    setIsPressed(true);
    const timer = setTimeout(() => {
      setShowMenu(true);
      setIsPressed(false);
    }, 500);
    setLongPressTimer(timer);
  }, []);

  // 长按结束
  const handlePressEnd = useCallback(() => {
    setIsPressed(false);
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  }, [longPressTimer]);

  // 切换星标
  const handleToggleStar = useCallback(() => {
    if (currentEntry) {
      toggleStar(currentEntry.id);
      setCurrentEntry({ ...currentEntry, isStarred: !currentEntry.isStarred });
    }
  }, [currentEntry, toggleStar]);

  // 下一张
  const handleNext = useCallback(() => {
    getRandomEntry();
  }, [getRandomEntry]);

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

  if (!currentEntry) {
    return (
      <div className="random-page">
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <p className="empty-text">还没有任何记忆</p>
          <p className="empty-hint">去录入页面添加第一条吧</p>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="random-page">
      <header className="page-header">
        <h1 className="page-title">随机浏览</h1>
        <p className="page-subtitle">长按卡片呼出菜单</p>
      </header>

      <main className="page-content">
        <div
          className={`card-container ${isPressed ? 'pressed' : ''}`}
          onClick={handleCopy}
          onMouseDown={handlePressStart}
          onMouseUp={handlePressEnd}
          onMouseLeave={handlePressEnd}
          onTouchStart={handlePressStart}
          onTouchEnd={handlePressEnd}
        >
          <div className="entry-card glass">
            <div className="card-content">
              {currentEntry.content}
            </div>

            <div className="card-meta">
              {currentEntry.isStarred && (
                <span className="meta-star">⭐</span>
              )}
              {currentEntry.tags && currentEntry.tags.length > 0 && (
                <div className="meta-tags">
                  {currentEntry.tags.map(tag => (
                    <span key={tag.id} className="meta-tag">#{tag.name}</span>
                  ))}
                </div>
              )}
              <span className="meta-time">
                {new Date(currentEntry.createdAt).toLocaleDateString('zh-CN')}
              </span>
            </div>
          </div>
        </div>

        <div className="card-actions">
          <button className="nav-btn glass" onClick={handleNext}>
            <span>🎴</span>
            <span>下一张</span>
          </button>
          <button className="nav-btn glass" onClick={handleToggleStar}>
            <span>{currentEntry.isStarred ? '⭐' : '☆'}</span>
            <span>{currentEntry.isStarred ? '已星标' : '星标'}</span>
          </button>
        </div>
      </main>

      {/* 快捷菜单 */}
      {showMenu && (
        <QuickMenu
          entry={currentEntry}
          onClose={() => setShowMenu(false)}
          onToggleStar={handleToggleStar}
        />
      )}

      <BottomNav />
    </div>
  );
}
