/**
 * 连线展示页面
 * 显示与某条目相关的所有连线
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getDatabase } from '@/services/database';
import { BottomNav } from '@/components/BottomNav';
import type { Entry, Link } from '@/types';
import './LinkPage.css';

export function LinkPage() {
  const { entryId } = useParams<{ entryId: string }>();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [links, setLinks] = useState<(Link & { targetEntry: Entry })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 加载连线数据
  useEffect(() => {
    const loadLinks = async () => {
      if (!entryId) return;

      try {
        const db = await getDatabase();
        const entryData = await db.getEntryById(entryId);
        setEntry(entryData);

        if (entryData) {
          const linkData = await db.getLinksByEntryId(entryId);
          const linksWithEntries = await Promise.all(
            linkData.map(async link => {
              const targetId = link.sourceId === entryId ? link.targetId : link.sourceId;
              const targetEntry = await db.getEntryById(targetId);
              return { ...link, targetEntry: targetEntry! };
            })
          );
          setLinks(linksWithEntries.filter(l => l.targetEntry));
        }
      } catch (error) {
        console.error('加载连线失败:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadLinks();
  }, [entryId]);

  // 跳转到目标条目
  const handleGoToEntry = useCallback((targetId: string) => {
    // 在当前页面显示目标条目详情
    navigate(`/links/${targetId}`);
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="link-page">
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="link-page">
      <header className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1 className="page-title">连线</h1>
        <div className="header-spacer" />
      </header>

      <main className="page-content">
        {/* 当前条目 */}
        {entry && (
          <div className="current-entry glass">
            <h3 className="section-title">当前条目</h3>
            <p className="entry-content">{entry.content}</p>
          </div>
        )}

        {/* 连线列表 */}
        <div className="links-container">
          <h3 className="section-title">相关条目 ({links.length})</h3>

          {links.length > 0 ? (
            links.map(link => (
              <div
                key={link.id}
                className="link-item glass"
                onClick={() => handleGoToEntry(link.targetEntry.id)}
              >
                <div className="link-content">
                  {link.targetEntry.content}
                </div>
                {link.description && (
                  <div className="link-description">
                    <span className="link-icon">🔗</span>
                    <span>{link.description}</span>
                  </div>
                )}
                <div className="link-meta">
                  {link.targetEntry.isStarred && <span className="meta-icon">⭐</span>}
                  <span className="meta-time">
                    {new Date(link.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-links">
              <span className="empty-icon">🔗</span>
              <p className="empty-text">暂无连线</p>
              <p className="empty-hint">在随机浏览或搜索中可以为条目建立连线</p>
            </div>
          )}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
