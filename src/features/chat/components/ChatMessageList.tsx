/**
 * Chat 页消息列表 —— 一条「对话流」，不是气泡墙
 *
 * 结构决策：
 * - AI 消息不套气泡，100% 宽直接排在纸面上（20px 内边距，16px/1.78 正文）；
 * - 用户消息右对齐，78% 最大宽，珊瑚色薄底，右下角收紧；
 * - 日期分隔是居中的 11px 小字，不是横线；
 * - 复制 / 删除这一轮收在每条消息右下角，hover 或长按时才浮出来。
 *
 * 状态与业务逻辑由父组件 ChatPage 持有，本组件只负责展示。
 *
 * 性能说明：单条消息由 React.memo 隔离、Markdown 渲染结果按 content 缓存。
 * 流式期间父组件高频更新 messages 时，只有「正在写入的最后一条」消息重渲染，
 * 历史消息（引用未变）全部跳过 —— 修复长对话下流式卡顿的主因之一。
 */
import { memo, useMemo, useState, useEffect, useRef, Fragment } from 'react';
import type { RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { renderMarkdown } from '@/utils/markdown';
import { readImageAsSrc } from '@/services/attachmentService';
import { ImageViewer } from '@/components/ImageViewer';
import { IconMessage, IconCheck, IconBrain, IconFile, IconChevronRight } from '@/components/icons';
import { formatTime, splitChatFileBlocks, formatCharCount } from '../chatUtils';
import { installChatSelectionGuard } from '../chatSelectionGuard';
import type { ChatMessage, ChatImage } from '../chatTypes';

interface ChatMessageListProps {
  messages: ChatMessage[];
  /** 当前会话 id（点文件卡片跳独立页时拼路由） */
  sessionId: string | null;
  selectMode: boolean;
  selectedMsgIds: Set<string>;
  isLoading: boolean;
  hasApiKey: boolean;
  containerRef: RefObject<HTMLDivElement>;
  endRef: RefObject<HTMLDivElement>;
  onToggleSelect: (msgId: string) => void;
  /** 危险操作确认：confirmId + 是否批准 */
  onConfirmAction?: (confirmId: string, approved: boolean) => void;
  /** v3.8.1：删除本轮对话（该 AI 消息 + 它对应的用户消息） */
  onDeleteTurn?: (msgId: string) => void;
}

/** v4.3.0：长按 600ms 删除这一轮；松手即取消，删后由输入区给 5 秒撤销 */
const HOLD_DELETE_MS = 600;

/** 日期分组键（本地时区） */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 日期分隔文案：今天 / 昨天 / 11月27日 */
function dayLabel(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  if (dayKey(ts) === dayKey(now.getTime())) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(ts) === dayKey(yesterday.getTime())) return '昨天';
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

function TurnDeleteButton({ onDelete }: { onDelete: () => void }) {
  const [holding, setHolding] = useState(false);
  const activeRef = useRef(false);
  const rafRef = useRef(0);
  const timerRef = useRef(0);
  const startRef = useRef(0);

  const stop = () => {
    activeRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    rafRef.current = 0;
    timerRef.current = 0;
    setHolding(false);
  };

  const begin = (el: HTMLButtonElement) => {
    if (activeRef.current) return;
    activeRef.current = true;
    setHolding(true);
    startRef.current = performance.now();
    el.style.setProperty('--p', '0');
    const tick = () => {
      const p = Math.min(100, ((performance.now() - startRef.current) / HOLD_DELETE_MS) * 100);
      el.style.setProperty('--p', String(p));
      if (p < 100) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    timerRef.current = window.setTimeout(() => {
      stop();
      onDelete();
    }, HOLD_DELETE_MS);
  };

  return (
    <button
      type="button"
      className={`turn-delete-btn ${holding ? 'holding' : ''}`}
      title="按住 0.6 秒删除这一轮"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // 键盘 / 读屏激活的 click detail 为 0：直接删，靠 5 秒撤销兜底
        if (e.detail === 0) onDelete();
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        begin(e.currentTarget);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          begin(e.currentTarget);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') stop();
      }}
    >
      {holding ? '松手取消' : '长按删除'}
    </button>
  );
}

/** v4.2.6：复制本条正文（剪贴板不可用时退化成临时 textarea） */
async function copyPlainText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** v4.2.6：思考行里的「复制」—— 点一下变「确认复制？」，再点才复制这条回复的正文 */
function TurnCopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'armed' | 'done'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), state === 'done' ? 1500 : 3000);
    return () => window.clearTimeout(t);
  }, [state]);

  return (
    <button
      type="button"
      className={`turn-copy-btn ${state}`}
      title="复制这条回复的正文"
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (state === 'armed') {
          const ok = await copyPlainText(text);
          setState(ok ? 'done' : 'idle');
        } else if (state === 'idle') {
          setState('armed');
        }
      }}
    >
      {state === 'armed' ? '确认复制？' : state === 'done' ? '已复制' : '复制'}
    </button>
  );
}

/* === 消息内的图片网格（v3.5.3）=== */
/**
 * 读缩略图先顶上；打开大图后再补读原图并替换（点开不等待）。
 * 文件缺失（换设备恢复、手动清理）时显示「图片已丢失」占位，不渲染破图。
 */
function ChatImageGrid({ images }: { images: ChatImage[] }) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [fulls, setFulls] = useState<Record<number, string>>({});
  const [viewerStart, setViewerStart] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => {
      const list = await Promise.all(images.map(img => readImageAsSrc(img.thumbPath)));
      if (cancelled) return;
      setThumbs(list);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [images]);

  // 观看期间后台补读原图（缩略图仅 400px，放大后糊）
  useEffect(() => {
    if (viewerStart === null) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < images.length; i++) {
        const src = await readImageAsSrc(images[i].path);
        if (cancelled) return;
        if (src) setFulls(prev => ({ ...prev, [i]: src }));
      }
    })();
    return () => { cancelled = true; };
  }, [viewerStart, images]);

  const viewerImages = images.map((_, i) => fulls[i] || thumbs[i] || '');

  return (
    <>
      <div className={`chat-msg-images count-${Math.min(images.length, 3)}`}>
        {!loaded
          ? images.map((img, i) => <div key={img.path} className="chat-msg-image skeleton" />)
          : images.map((img, i) => (
            thumbs[i] ? (
              <img
                key={img.path}
                src={thumbs[i]}
                alt={`图片 ${i + 1}`}
                className="chat-msg-image"
                onClick={() => setViewerStart(i)}
                title="点击查看大图"
              />
            ) : (
              <div key={img.path} className="chat-msg-image missing" title="图片文件已不在本机">
                图片已丢失
              </div>
            )
          ))}
      </div>

      {viewerStart !== null && (
        <ImageViewer
          images={viewerImages}
          startIndex={viewerStart}
          onClose={() => setViewerStart(null)}
        />
      )}
    </>
  );
}

/* === 单条消息（React.memo 隔离：props 全稳定时跳过重渲染）=== */
interface ChatMessageItemProps {
  msg: ChatMessage;
  sessionId: string | null;
  selectMode: boolean;
  isSelected: boolean;
  /** 是否为「正在流式的最后一条消息」（控制思维链默认展开） */
  streamingActive: boolean;
  onToggleSelect: (msgId: string) => void;
  onConfirmAction?: (confirmId: string, approved: boolean) => void;
  onDeleteTurn?: (msgId: string) => void;
}

const ChatMessageItem = memo(function ChatMessageItem({
  msg,
  sessionId,
  selectMode,
  isSelected,
  streamingActive,
  onToggleSelect,
  onConfirmAction,
  onDeleteTurn,
}: ChatMessageItemProps) {
  const confirm = msg.confirmRequest;
  const isSelectable = selectMode && msg.role !== 'tool' && !confirm;
  const navigate = useNavigate();

  // v3.6.4：用户消息里的「文件块」单独抽出来做卡片，点开跳独立页看全文
  const segments = useMemo(
    () => (msg.role === 'user' && !confirm ? splitChatFileBlocks(msg.content) : []),
    [msg.role, msg.content, confirm],
  );
  const hasFileBlocks = segments.some(seg => seg.type === 'file');

  // v3.6.5：文件类工具结果 → 可点卡片，点一下直接全屏打开（不用绕文件管理器）
  // v4.1.0：带上「写的是哪一页」，点开直接落在那一页，而不是永远回到目录页
  const toolFiles = useMemo<Array<{ work: string; page?: string; hint?: string }>>(() => {
    if (msg.role !== 'tool') return [];
    const name = msg.toolName ?? '';
    if (!['write_file', 'write_files', 'read_file', 'list_files', 'edit_file', 'copy_file', 'search_in_work', 'set_cover'].includes(name)) return [];
    try {
      const parsed = JSON.parse(msg.content) as { success?: boolean; data?: Record<string, unknown> };
      if (parsed?.success !== true) return [];
      const data = parsed.data ?? {};
      const out: Array<{ work: string; page?: string; hint?: string }> = [];

      const work = typeof data.name === 'string' ? data.name.trim() : '';
      const page = typeof data.path === 'string' ? data.path.trim() : '';
      if (work) {
        out.push({
          work,
          page: page || undefined,
          hint: name === 'write_file' ? '已写入 · 点击打开' : '点击打开',
        });
      }

      // edit_file：局部修改，卡片指向改的第一个文件
      if (name === 'edit_file' && work && Array.isArray(data.files)) {
        const first = (data.files as Array<{ path?: unknown; edits?: unknown }>)
          .map((item) => (typeof item?.path === 'string' ? item.path.trim() : ''))
          .find(Boolean);
        const edits = (data.files as Array<{ edits?: unknown }>)
          .reduce((sum, item) => sum + (typeof item?.edits === 'number' ? item.edits : 0), 0);
        if (first) out[0] = { work, page: first, hint: `已改 ${edits} 处 · 点击打开` };
      }

      // copy_file：复制进来的第一个文件
      if (name === 'copy_file' && work && Array.isArray(data.copied)) {
        const first = (data.copied as Array<{ path?: unknown }>)
          .map((item) => (typeof item?.path === 'string' ? item.path.trim() : ''))
          .find(Boolean);
        if (first) out[0] = { work, page: first, hint: `已复制 ${data.copied.length} 个 · 点击打开` };
      }

      // write_files：一次写一批，卡片指向其中第一个页面（没有页面就指第一个文件）
      if (name === 'write_files' && work && Array.isArray(data.files)) {
        const paths = (data.files as Array<{ path?: unknown }>)
          .map((item) => (typeof item?.path === 'string' ? item.path.trim() : ''))
          .filter(Boolean);
        if (paths.length > 0) {
          const firstPage = paths.find((item) => /\.html?$/i.test(item)) ?? paths[0];
          out[0] = { work, page: firstPage, hint: `已写入 ${paths.length} 个文件 · 点击打开` };
        }
      }

      // list_files：只有作品名，打开入口页
      if (name === 'list_files' && typeof data.work === 'string' && data.work.trim()) {
        out.push({ work: data.work.trim(), hint: '点击打开' });
      }

      const seen = new Set<string>();
      return out.filter((item) => {
        const key = `${item.work}|${item.page ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 12);
    } catch {
      return [];
    }
  }, [msg.role, msg.toolName, msg.content]);

  // Markdown 渲染结果按 content 缓存：非流式消息的 content 不变 → 不重复解析
  const html = useMemo(
    () => (confirm ? '' : renderMarkdown(msg.role === 'assistant' ? (msg.content || '…') : msg.content)),
    [confirm, msg.role, msg.content],
  );

  const canAct = msg.role === 'assistant' && !confirm && !streamingActive && !selectMode;

  return (
    <div
      className={`chat-message chat5-msg ${msg.role} ${selectMode ? 'select-mode' : ''} ${isSelected ? 'selected' : ''} ${confirm ? 'confirm-msg' : ''}`}
      data-msg-id={msg.id}
      onClick={isSelectable ? () => onToggleSelect(msg.id) : undefined}
    >
      {/* 选中模式下显示圆圈 checkbox */}
      {isSelectable && (
        <div className={`msg-select-checkbox ${isSelected ? 'checked' : ''}`}>
          {isSelected && <IconCheck />}
        </div>
      )}

      <div className="message-body">
        {/* v4.3.0：assistant 的时间提到正文上方，默认可见；用户/工具消息仍留在底部 */}
        {msg.role === 'assistant' && !confirm && (
          <span className="message-time message-time-top">{formatTime(msg.timestamp)}</span>
        )}

        {/* 思维链内容（可折叠） */}
        {msg.reasoningContent && (
          <details className="reasoning-block" open={streamingActive}>
            <summary className="reasoning-summary">
              <IconBrain />
              <span>思考过程</span>
              {msg.thinkingEffort && <span className="reasoning-effort">{msg.thinkingEffort}</span>}
            </summary>
            <div className="reasoning-content">{msg.reasoningContent}</div>
          </details>
        )}

        {/* 危险操作确认卡片（删除类工具） */}
        {confirm ? (
          <div className={`confirm-card ${confirm.status}`}>
            <div className="confirm-card-head">⚠️ 需要你确认</div>
            <div className="confirm-card-summary">{confirm.summary}</div>
            {confirm.preview && (
              <details className="confirm-card-preview">
                <summary className="confirm-card-preview-summary">查看更新预览</summary>
                <pre className="confirm-card-preview-text">{confirm.preview}</pre>
              </details>
            )}
            <div className="confirm-card-tool">工具：{confirm.toolName}</div>
            {confirm.status === 'pending' ? (
              <div className="confirm-card-actions">
                <button
                  className="confirm-btn cancel"
                  onClick={(e) => { e.stopPropagation(); onConfirmAction?.(confirm.id, false); }}
                >
                  取消
                </button>
                <button
                  className="confirm-btn approve"
                  onClick={(e) => { e.stopPropagation(); onConfirmAction?.(confirm.id, true); }}
                >
                  确认执行
                </button>
              </div>
            ) : (
              <div className="confirm-card-status">
                {confirm.status === 'approved' ? '✅ 已确认执行' : '🚫 已取消'}
              </div>
            )}
          </div>
        ) : msg.role === 'tool' ? (
          /* tool 消息：文件类结果给可点卡片；原始 JSON 仍折叠在下面 */
          <>
            {toolFiles.length > 0 && (
              <div className="tool-file-list">
                {toolFiles.map(target => (
                  <button
                    key={`${target.work}|${target.page ?? ''}`}
                    type="button"
                    className="chat-file-card"
                    onClick={() => {
                      const query = target.page ? `?page=${encodeURIComponent(target.page)}` : '';
                      navigate(`/files/${encodeURIComponent(target.work)}${query}`);
                    }}
                  >
                    <span className="chat-file-card-icon"><IconFile size={16} /></span>
                    <span className="chat-file-card-main">
                      <span className="chat-file-card-name">{target.work}</span>
                      <span className="chat-file-card-meta">{target.page ?? target.hint ?? '点击打开'}</span>
                    </span>
                    <IconChevronRight size={14} />
                  </button>
                ))}
              </div>
            )}
            <details className="tool-json-fold">
              <summary className="tool-json-fold-summary">查看工具返回详情</summary>
              <div className="message-content markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
            </details>
          </>
        ) : hasFileBlocks ? (
          /* 文件卡片：气泡里只显示文件名与字数，点开跳独立页（避免长文把聊天撑爆） */
          <div className="message-content chat-file-segments">
            {segments.map((seg, i) => seg.type === 'file' ? (
              <button
                key={`f${i}`}
                type="button"
                className="chat-file-card"
                onClick={() => navigate(`/chat-file/${sessionId ?? ''}/${msg.id}/${seg.index}`)}
              >
                <span className="chat-file-card-icon"><IconFile size={16} /></span>
                <span className="chat-file-card-main">
                  <span className="chat-file-card-name">{seg.block.name}</span>
                  <span className="chat-file-card-meta">{formatCharCount(seg.block.body.length)} · 点击查看全文</span>
                </span>
                <IconChevronRight size={14} />
              </button>
            ) : (
              <div key={`t${i}`} className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.text) }} />
            ))}
          </div>
        ) : (msg.content || !msg.images || msg.images.length === 0) ? (
          <div className="message-content markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        ) : null}

        {/* 用户消息随附的图片（v3.5.3） */}
        {msg.role === 'user' && msg.images && msg.images.length > 0 && (
          <ChatImageGrid images={msg.images} />
        )}

        {msg.isThinking && !msg.reasoningContent && (
          <span className="message-tag">
            深度思考 · {msg.thinkingEffort}
          </span>
        )}

        {msg.toolCallResults && msg.toolCallResults.length > 0 && (
          <div className="tool-calls">
            {msg.toolCallResults.map((tc, i) => (
              <div key={i} className={`tool-call-badge ${tc.success ? 'success' : 'error'}`}>
                🔧 {tc.name} {tc.success ? '✅' : '❌'}
              </div>
            ))}
          </div>
        )}

        {msg.model && msg.role === 'assistant' && !confirm && (
          <span className="message-model-tag">{msg.model}</span>
        )}
        {(msg.role !== 'assistant' || confirm) && (
          <span className="message-time">{formatTime(msg.timestamp)}</span>
        )}
      </div>

      {/* 每条消息右下角的一行小动作：平时透明，hover / 长按才浮出来 */}
      {canAct && (msg.content || msg.reasoningContent) && (
        <div className="chat5-actions">
          {msg.content && <TurnCopyButton text={msg.content} />}
          {onDeleteTurn && <TurnDeleteButton onDelete={() => onDeleteTurn(msg.id)} />}
        </div>
      )}
    </div>
  );
});

export function ChatMessageList({
  messages,
  sessionId,
  selectMode,
  selectedMsgIds,
  isLoading,
  hasApiKey,
  containerRef,
  endRef,
  onToggleSelect,
  onConfirmAction,
  onDeleteTurn,
}: ChatMessageListProps) {
  // v4.2.6：选区守卫 —— 安卓拖手柄时锚点会被吸到容器边界，导致「复制整轮」。
  // 根因修复在 CSS（容器不再是可选根），这里兜底回滚异常选区。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return installChatSelectionGuard(el);
  }, [containerRef]);

  return (
    <div className={`chat-messages ${selectMode ? 'selecting' : ''}`} ref={containerRef}>
      {messages.length === 0 ? (
        <div className="chat-welcome">
          <span className="welcome-icon"><IconMessage /></span>
          <h2 className="welcome-title">从一句话开始</h2>
          <p className="welcome-hint">
            {hasApiKey ? '想到什么就打什么，AI 会接着往下聊' : '先去设置里填上 AI API Key，这里才有人接话'}
          </p>
        </div>
      ) : (
        messages.map((msg, idx) => {
          const prev = messages[idx - 1];
          const showDay = !prev || dayKey(prev.timestamp) !== dayKey(msg.timestamp);
          return (
            <Fragment key={msg.id}>
              {showDay && (
                <div className="chat5-day">
                  <span>{dayLabel(msg.timestamp)}</span>
                </div>
              )}
              <ChatMessageItem
                msg={msg}
                sessionId={sessionId}
                selectMode={selectMode}
                isSelected={selectedMsgIds.has(msg.id)}
                streamingActive={isLoading && idx === messages.length - 1}
                onToggleSelect={onToggleSelect}
                onConfirmAction={onConfirmAction}
                onDeleteTurn={onDeleteTurn}
              />
            </Fragment>
          );
        })
      )}

      {isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'user' && (
        <div className="chat-message chat5-msg assistant">
          <div className="message-body">
            <div className="message-content loading-dots">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
