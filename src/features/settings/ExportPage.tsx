/**
 * 数据导出页面
 * 支持 JSON/Markdown 格式，支持选择范围
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntryStore } from '@/stores/entryStore';
import { useTagStore } from '@/stores/tagStore';
import { exportAndDownload, type ExportOptions } from '@/utils/export';
import { BottomNav } from '@/components/BottomNav';
import './ExportPage.css';

export function ExportPage() {
  const navigate = useNavigate();
  const entries = useEntryStore(state => state.entries);
  const tags = useTagStore(state => state.tags);

  const [format, setFormat] = useState<'json' | 'markdown'>('json');
  const [scope, setScope] = useState<ExportOptions['scope']>('all');
  const [selectedTagId, setSelectedTagId] = useState<string>('');
  const [includeLinks, setIncludeLinks] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // 计算导出数量
  const getExportCount = useCallback(() => {
    switch (scope) {
      case 'all':
        return entries.length;
      case 'starred':
        return entries.filter(e => e.isStarred).length;
      case 'tag':
        return entries.filter(e => e.tags?.some(t => t.id === selectedTagId)).length;
      default:
        return entries.length;
    }
  }, [entries, scope, selectedTagId]);

  // 执行导出
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      await exportAndDownload({
        format,
        scope,
        tagId: scope === 'tag' ? selectedTagId : undefined,
        includeLinks: format === 'json' ? includeLinks : undefined,
      });
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    } catch (error) {
      console.error('导出失败:', error);
    } finally {
      setIsExporting(false);
    }
  }, [format, scope, selectedTagId, includeLinks]);

  return (
    <div className="export-page">
      <header className="page-header">
        <button className="back-btn" onClick={() => navigate(-1)}>←</button>
        <h1 className="page-title">数据导出</h1>
        <div className="header-spacer" />
      </header>

      <main className="page-content">
        {/* 格式选择 */}
        <section className="export-section">
          <h3 className="section-title">导出格式</h3>
          <div className="format-options">
            <button
              className={`format-btn glass ${format === 'json' ? 'selected' : ''}`}
              onClick={() => setFormat('json')}
            >
              <span className="format-icon">📄</span>
              <div className="format-info">
                <span className="format-name">JSON</span>
                <span className="format-desc">结构化数据，适合备份</span>
              </div>
            </button>
            <button
              className={`format-btn glass ${format === 'markdown' ? 'selected' : ''}`}
              onClick={() => setFormat('markdown')}
            >
              <span className="format-icon">📝</span>
              <div className="format-info">
                <span className="format-name">Markdown</span>
                <span className="format-desc">可读文档，适合阅读</span>
              </div>
            </button>
          </div>
        </section>

        {/* 范围选择 */}
        <section className="export-section">
          <h3 className="section-title">导出范围</h3>
          <div className="scope-options">
            <button
              className={`scope-btn ${scope === 'all' ? 'selected' : ''}`}
              onClick={() => setScope('all')}
            >
              <span>全部 ({entries.length})</span>
            </button>
            <button
              className={`scope-btn ${scope === 'starred' ? 'selected' : ''}`}
              onClick={() => setScope('starred')}
            >
              <span>⭐ 仅星标 ({entries.filter(e => e.isStarred).length})</span>
            </button>
            <button
              className={`scope-btn ${scope === 'tag' ? 'selected' : ''}`}
              onClick={() => setScope('tag')}
            >
              <span>🏷️ 按标签</span>
            </button>
          </div>

          {/* 标签选择 */}
          {scope === 'tag' && (
            <div className="tag-select glass">
              <select
                className="tag-select-input"
                value={selectedTagId}
                onChange={e => setSelectedTagId(e.target.value)}
              >
                <option value="">选择标签...</option>
                {tags.map(tag => (
                  <option key={tag.id} value={tag.id}>
                    #{tag.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        {/* JSON 选项 */}
        {format === 'json' && (
          <section className="export-section">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeLinks}
                onChange={e => setIncludeLinks(e.target.checked)}
              />
              <span>包含连线数据</span>
            </label>
          </section>
        )}

        {/* 导出按钮 */}
        <button
          className="export-btn"
          onClick={handleExport}
          disabled={isExporting || (scope === 'tag' && !selectedTagId)}
        >
          {isExporting ? '导出中...' : `导出 ${getExportCount()} 条记录`}
        </button>
      </main>

      {/* 轻提示 */}
      {showToast && (
        <div className="toast glass">
          <span>导出成功</span>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
