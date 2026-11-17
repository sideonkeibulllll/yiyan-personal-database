/**
 * Chat 消息里的「文件块」全文页（v3.6.4）
 *
 * 为什么单开一页：选中的 txt/html 可能有几万字，塞在气泡里会把聊天撑成一片，
 * 往上翻往下翻都难受。这里给一个干净的全屏阅读页（带复制）。
 *
 * 数据来源：路由参数 → chatSessionService.loadChatSessions() → 消息 → 按序号取文件块。
 * 不额外存副本，删会话/删消息后这里自然失效（提示返回）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { loadChatSessions } from '@/services/chatSessionService';
import { splitChatFileBlocks, formatCharCount } from './chatUtils';
import type { ChatMessage } from './chatTypes';
import { IconBack, IconCopy, IconCheck } from '@/components/icons';
import './ChatFilePage.css';

export function ChatFilePage() {
  const { sessionId, msgId, index } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sessions = await loadChatSessions();
        const session = sessions.find(item => item.id === sessionId);
        const message = (session?.messages as ChatMessage[] | undefined)?.find(item => item.id === msgId);
        const blocks = message
          ? splitChatFileBlocks(message.content).filter(seg => seg.type === 'file')
          : [];
        const target = blocks[Number(index) || 0];
        if (!alive) return;
        if (target && target.type === 'file') {
          setName(target.block.name);
          setBody(target.block.body);
          setState('ok');
        } else {
          setState('missing');
        }
      } catch {
        if (alive) setState('missing');
      }
    })();
    return () => { alive = false; };
  }, [sessionId, msgId, index]);

  const meta = useMemo(() => (state === 'ok' ? `${formatCharCount(body.length)} · ${body.split('\n').length} 行` : ''), [state, body]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用就算了 */
    }
  };

  return (
    <div className="chat-file-page">
      <header className="chat-file-page-head">
        <button type="button" className="chat-file-back" onClick={() => navigate('/chat')} title="返回对话">
          <IconBack />
        </button>
        <div className="chat-file-title">
          <span className="chat-file-name">{name || '文件内容'}</span>
          {meta && <span className="chat-file-meta">{meta}</span>}
        </div>
        {state === 'ok' && (
          <button type="button" className="chat-file-copy" onClick={copyAll} title="复制全文">
            {copied ? <IconCheck /> : <IconCopy />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
        )}
      </header>

      {state === 'loading' && <div className="chat-file-hint">加载中…</div>}
      {state === 'missing' && (
        <div className="chat-file-hint">
          这段文件内容已经不在了（消息被删除或会话被清理）。
          <button type="button" className="chat-file-link" onClick={() => navigate('/chat')}>返回对话</button>
        </div>
      )}
      {state === 'ok' && (
        <div className="chat-file-body">
          <pre>{body}</pre>
        </div>
      )}
    </div>
  );
}
