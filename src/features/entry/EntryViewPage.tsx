/**
 * 卡片浏览页（v2.12.0 / UI v5）
 *
 * 结构决策：这不是「一张卡」，是「一张纸」。
 *  - 顶部只有一条 44px 的返回条，所有动作收进右侧 ⋯
 *  - 正文没有容器、没有边框，直接铺在页面上；图片走满宽，链接做成两行书签
 *  - 元信息（时间 / 分组 / 来源 / 补充 / 标签）竖排在正文之下
 *  - 底部只有两个按钮：编辑（描边）+ 收藏（唯一主色）
 *
 * 只读地「看一张记忆」为主；收藏、生成连线、删除也可在 ⋯ 里完成。
 * 入口：记忆来信通知、随机页 / 搜索页的卡片右箭头。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getDatabase } from '@/services/database';
import { readThumbAsSrc, deleteAttachmentFiles } from '@/services/attachmentService';
import { useEntryStore } from '@/stores/entryStore';
import { ImageViewer } from '@/components/ImageViewer';
import type { Entry, Tag, Attachment } from '@/types';
import './EntryViewPage.css';

/** 标签颜色（UI 侧局部存储，数据库没有 color 字段） */
const TAG_COLORS_KEY = 'yiyan_tag_colors_v1';

function readTagColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TAG_COLORS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

const IconArrowLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
  </svg>
);

const IconDots = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="3" cy="8" r="1.35" /><circle cx="8" cy="8" r="1.35" /><circle cx="13" cy="8" r="1.35" />
  </svg>
);

const IconStarFilled = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const isUrl = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

/** 时间格式化：2026年11月27日 · 23:12 */
function formatCnTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 独立成行的链接：域名小字 + 标题正文，两行，不露裸 URL */
function LinkBlock({ url }: { url: string }) {
  let domain = url;
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch { /* 保持原样 */ }
  const title = url.replace(/^https?:\/\//i, '');
  return (
    <a className="entry-view-link" href={url} target="_blank" rel="noreferrer">
      <span className="entry-view-link-domain">{domain}</span>
      <span className="entry-view-link-title">{title}</span>
    </a>
  );
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
  /** 顶部 ⋯ 菜单 */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 返回条是否已经「浮」起来 */
  const [scrolled, setScrolled] = useState(false);

  const updateEntry = useEntryStore(state => state.updateEntry);
  const deleteEntry = useEntryStore(state => state.deleteEntry);
  const tagColors = useMemo(() => readTagColors(), []);

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

  // 收藏 / 取消收藏
  const handleToggleStar = useCallback(async () => {
    if (!id || !entry) return;
    setMenuOpen(false);
    const next = !entry.isStarred;
    setEntry(prev => prev ? { ...prev, isStarred: next } : prev);
    try {
      await updateEntry(id, { isStarred: next });
    } catch (err) {
      console.error('收藏失败:', err);
      setEntry(prev => prev ? { ...prev, isStarred: !next } : prev);
    }
  }, [id, entry, updateEntry]);

  // 生成连线（跳到连线页建立关系）
  const handleCreateLink = useCallback(() => {
    if (!id) return;
    setMenuOpen(false);
    navigate(`/links/${id}`);
  }, [id, navigate]);

  // 删除整条记忆（附件文件一并清理）
  const handleDelete = useCallback(async () => {
    if (!id || !entry) return;
    setMenuOpen(false);
    if (!confirm('删除这条记忆？删除后不可恢复。')) return;
    try {
      for (const att of entry.attachments || []) {
        try { await deleteAttachmentFiles(att); } catch { /* 文件清理失败不阻断记录删除 */ }
      }
      await deleteEntry(id);
      handleBack();
    } catch (err) {
      console.error('删除失败:', err);
      alert('删除失败：' + (err instanceof Error ? err.message : '未知错误'));
    }
  }, [id, entry, deleteEntry, handleBack]);

  // 可查看的附件（有缩略图的），索引与查看器列表一致
  const viewableAtts: Attachment[] = useMemo(() => {
    if (!entry?.attachments) return [];
    return entry.attachments.filter(att => !!thumbSrcs[att.id]);
  }, [entry, thumbSrcs]);
  const viewerImages = useMemo(
    () => viewableAtts.map(att => thumbSrcs[att.id]),
    [viewableAtts, thumbSrcs],
  );

  // 正文排版：第一段若是短句，就当成标题；其余按段落铺开
  const blocks = useMemo(() => {
    if (!entry?.content) return [] as string[];
    return entry.content
      .split(/\n{2,}/)
      .map(b => b.replace(/\s+$/, ''))
      .filter(b => b.trim().length > 0);
  }, [entry?.content]);
  const lead = useMemo(() => {
    if (blocks.length < 2) return '';
    const first = blocks[0];
    if (first.length > 90 || first.includes('\n') || isUrl(first)) return '';
    return first.trim();
  }, [blocks]);
  const bodyBlocks = useMemo(
    () => (lead ? blocks.slice(1) : blocks),
    [blocks, lead],
  );

  if (loading) {
    return (
      <div className="entry-view-page">
        <header className="entry-view-bar">
          <button className="entry-view-back" onClick={handleBack} aria-label="返回"><IconArrowLeft /></button>
          <span className="entry-view-bar-center" />
          <span className="entry-view-bar-spacer" />
        </header>
        <div className="entry-view-loading">正在翻开这一页…</div>
      </div>
    );
  }

  // 卡片不存在（被删除 / 通知过期）——优雅兜底
  if (!entry) {
    return (
      <div className="entry-view-page">
        <header className="entry-view-bar">
          <button className="entry-view-back" onClick={handleBack} aria-label="返回"><IconArrowLeft /></button>
          <span className="entry-view-bar-center" />
          <span className="entry-view-bar-spacer" />
        </header>
        <div className="entry-view-empty">
          <b>这张卡已经不在抽屉里了</b>
          <span>也许它已被删除，或者是从旧消息点进来的</span>
          <button className="entry-view-empty-btn" onClick={() => navigate('/random', { replace: true })}>
            去随机页逛逛
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="entry-view-page">
      {/* 顶部：一条 44px 的返回条，动作全在右边 */}
      <header className={`entry-view-bar${scrolled ? ' is-scrolled' : ''}`}>
        <button className="entry-view-back" onClick={handleBack} aria-label="返回"><IconArrowLeft /></button>
        <span className="entry-view-bar-center" />
        <button
          className={`entry-view-more${menuOpen ? ' on' : ''}`}
          onClick={() => setMenuOpen(v => !v)}
          aria-label="更多操作"
          aria-expanded={menuOpen}
        >
          <IconDots />
        </button>

        {menuOpen && (
          <>
            <div className="entry-view-scrim" onClick={() => setMenuOpen(false)} />
            <div className="entry-view-menu" role="menu" onClick={e => e.stopPropagation()}>
              <button role="menuitem" onClick={handleToggleStar}>
                {entry.isStarred ? '取消收藏' : '收藏'}
              </button>
              <button role="menuitem" onClick={() => { setMenuOpen(false); handleEdit(); }}>编辑</button>
              <button role="menuitem" onClick={handleCreateLink}>生成链接</button>
              <button role="menuitem" className="is-danger" onClick={handleDelete}>删除</button>
            </div>
          </>
        )}
      </header>

      {/* 一张纸：没有卡片容器，没有边框 */}
      <div className="entry-view-body" onScroll={e => setScrolled(e.currentTarget.scrollTop > 40)}>
        <article className="entry-view-paper">
          {lead && <h1 className="entry-view-lead">{lead}</h1>}

          {bodyBlocks.map((block, idx) => (
            isUrl(block)
              ? <LinkBlock key={idx} url={block.trim()} />
              : <p className="entry-view-p" key={idx}>{block}</p>
          ))}

          {viewableAtts.length > 0 && (
            <div className="entry-view-images">
              {viewableAtts.map((att, idx) => (
                <button
                  key={att.id}
                  className="entry-view-img-btn"
                  onClick={() => setViewerStart(idx)}
                  aria-label={`查看附件 ${idx + 1}`}
                >
                  <img src={thumbSrcs[att.id]} alt={`附件 ${idx + 1}`} className="entry-view-img" />
                </button>
              ))}
            </div>
          )}

          {/* 元信息：竖排在正文之下 */}
          <div className="entry-view-meta">
            <div className="entry-view-time">
              {entry.isStarred && <span className="entry-view-star-dot"><IconStarFilled /></span>}
              {formatCnTime(entry.createdAt)}
            </div>
            {entry.updatedAt !== entry.createdAt && (
              <div className="entry-view-time entry-view-time-muted">改于 {formatCnTime(entry.updatedAt)}</div>
            )}
            {groupName && <div className="entry-view-fact">分组 · {groupName}</div>}
            {entry.source && <div className="entry-view-fact">来源 · {entry.source}</div>}
            {entry.supplement && <p className="entry-view-supplement">{entry.supplement}</p>}
            {tags.length > 0 && (
              <div className="entry-view-tags">
                {tags.map(t => {
                  const color = t.color || tagColors[t.id];
                  return (
                    <span
                      key={t.id}
                      className={`entry-view-tag${color ? ' has-color' : ''}`}
                      style={color ? ({ '--tag-color': color } as CSSProperties) : undefined}
                    >
                      #{t.name}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </article>
      </div>

      {/* 底部：左描边编辑，右唯一主色收藏 */}
      <div className="entry-view-dock">
        <button className="entry-view-edit-btn" onClick={handleEdit}>编辑</button>
        <button
          className={`entry-view-fav-btn${entry.isStarred ? ' is-on' : ''}`}
          onClick={handleToggleStar}
          aria-pressed={entry.isStarred}
        >
          <IconStarFilled />
          {entry.isStarred ? '已收藏' : '收藏'}
        </button>
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
