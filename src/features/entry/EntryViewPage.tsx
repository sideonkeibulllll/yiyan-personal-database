/**
 * 卡片浏览页（v2.12.0）
 *
 * 只读地「看一张卡」——与编辑页（/entry/:id/edit）职责分离：修改一律交给编辑页。
 * 入口：
 *  - 记忆来信通知点击直达（冷启动 / 热启动均可）
 *  - 随机页、搜索页卡片的右箭头
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getDatabase } from '@/services/database';
import { readThumbAsSrc } from '@/services/attachmentService';
import { ImageViewer } from '@/components/ImageViewer';
import type { Entry, Tag, Attachment } from '@/types';
import './EntryViewPage.css';

const IconArrowLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
  </svg>
);

const IconStarFilled = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

/** 时间格式化 YYYY-MM-DD HH:mm */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function EntryViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [entry, setEntry] = useState<Entry | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(true);
  /** 附件缩略图：attachment.id → src */
  const [thumbSrcs, setThumbSrcs] = useState<Record<string, string>>({});
  /** 图片查看器起始索引（null = 未打开） */
  const [viewerStart, setViewerStart] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!id) {
        setLoading(false);
        return;
      }
      try {
        const db = await getDatabase();
        const e = await db.getEntryById(id);
        if (cancelled) return;
        if (!e) {
          setEntry(null);
          setLoading(false);
          return;
        }
        setEntry(e);

        // 标签（独立查询，与编辑页口径一致）
        try {
          const entryTags = await db.getTagsByEntryId(id);
          if (!cancelled) setTags(entryTags);
        } catch { /* 标签加载失败不影响正文 */ }

        // 分组名
        if (e.groupId) {
          try {
            const groups = await db.getAllGroups();
            const g = groups.find(x => x.id === e.groupId);
            if (!cancelled && g) setGroupName(g.name);
          } catch { /* 忽略 */ }
        }

        // 附件缩略图
        const atts = e.attachments || [];
        if (atts.length > 0) {
          const map: Record<string, string> = {};
          await Promise.all(atts.map(async att => {
            map[att.id] = await readThumbAsSrc(att.thumbPath);
          }));
          if (!cancelled) setThumbSrcs(map);
        }
      } catch (err) {
        console.error('加载卡片失败:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id]);

  // 返回：冷启动直达（无历史栈）时回随机页；否则正常回退
  const handleBack = useCallback(() => {
    if (location.key === 'default') {
      navigate('/random', { replace: true });
    } else {
      navigate(-1);
    }
  }, [location.key, navigate]);

  // 编辑：修改全部交由编辑页接管
  const handleEdit = useCallback(() => {
    if (!id) return;
    navigate(`/entry/${id}/edit`);
  }, [id, navigate]);

  // 可查看的附件（有缩略图的），索引与查看器列表一致
  const viewableAtts: Attachment[] = useMemo(() => {
    if (!entry?.attachments) return [];
    return entry.attachments.filter(att => !!thumbSrcs[att.id]);
  }, [entry, thumbSrcs]);
  const viewerImages = useMemo(
    () => viewableAtts.map(att => thumbSrcs[att.id]),
    [viewableAtts, thumbSrcs],
  );

  if (loading) {
    return (
      <div className="entry-view-page">
        <div className="entry-view-loading">加载中...</div>
      </div>
    );
  }

  // 卡片不存在（被删除 / 通知过期）——优雅兜底
  if (!entry) {
    return (
      <div className="entry-view-page">
        <header className="entry-view-header">
          <button className="entry-view-back" onClick={handleBack}><IconArrowLeft /></button>
          <h1 className="entry-view-title">卡片</h1>
          <div className="entry-view-header-spacer" />
        </header>
        <div className="entry-view-empty">
          <p className="entry-view-empty-text">这张卡已经不在抽屉里了</p>
          <p className="entry-view-empty-hint">也许它已被删除，或者是从旧消息点进来的</p>
          <button className="entry-view-empty-btn" onClick={() => navigate('/random', { replace: true })}>
            去随机页逛逛
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-view-page">
      {/* 顶部栏 */}
      <header className="entry-view-header">
        <button className="entry-view-back" onClick={handleBack}><IconArrowLeft /></button>
        <h1 className="entry-view-title">卡片</h1>
        <button className="entry-view-edit" onClick={handleEdit}>编辑</button>
      </header>

      {/* 内容区 */}
      <div className="entry-view-body">
        {/* 正文（全文，不折叠） */}
        {entry.content && <div className="entry-view-content">{entry.content}</div>}

        {/* 图片附件 */}
        {viewableAtts.length > 0 && (
          <div className="entry-view-attachments">
            {viewableAtts.map((att, idx) => (
              <img
                key={att.id}
                src={thumbSrcs[att.id]}
                alt={`附件 ${idx + 1}`}
                className="entry-view-att-img"
                onClick={() => setViewerStart(idx)}
                title="点击查看大图"
              />
            ))}
          </div>
        )}

        {/* 信息区（只读展示；修改请走编辑页） */}
        <div className="entry-view-meta">
          {entry.isStarred && (
            <div className="entry-view-meta-row">
              <span className="entry-view-meta-label">星标</span>
              <span className="entry-view-meta-value entry-view-star"><IconStarFilled /> 已星标</span>
            </div>
          )}
          {tags.length > 0 && (
            <div className="entry-view-meta-row">
              <span className="entry-view-meta-label">标签</span>
              <span className="entry-view-meta-value entry-view-tags">
                {tags.map(t => <span key={t.id} className="entry-view-tag">#{t.name}</span>)}
              </span>
            </div>
          )}
          {groupName && (
            <div className="entry-view-meta-row">
              <span className="entry-view-meta-label">分组</span>
              <span className="entry-view-meta-value">{groupName}</span>
            </div>
          )}
          {entry.source && (
            <div className="entry-view-meta-row">
              <span className="entry-view-meta-label">来源</span>
              <span className="entry-view-meta-value">{entry.source}</span>
            </div>
          )}
          {entry.supplement && (
            <div className="entry-view-meta-row">
              <span className="entry-view-meta-label">补充</span>
              <span className="entry-view-meta-value">{entry.supplement}</span>
            </div>
          )}
          <div className="entry-view-meta-row">
            <span className="entry-view-meta-label">修改时间</span>
            <span className="entry-view-meta-value">{formatTime(entry.updatedAt || entry.createdAt)}</span>
          </div>
          <div className="entry-view-meta-row">
            <span className="entry-view-meta-label">创建时间</span>
            <span className="entry-view-meta-value">{formatTime(entry.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* 图片查看器 */}
      {viewerStart !== null && viewerImages.length > 0 && (
        <ImageViewer
          images={viewerImages}
          startIndex={viewerStart}
          onClose={() => setViewerStart(null)}
        />
      )}
    </div>
  );
}
