/**
 * 设置面板 - 聊天图片（v4.2.6）
 *
 * 干什么：把 `chat-images/`（Android 私有目录，文件管理器看不见）里的原图
 * 一次性导到 `Documents/yiyan-chat-images/<日期>/`，和备份 zip 同一个公共根。
 *
 * 为什么需要：主人用 Shizuku 版 MT 也只能看到 Documents 里的备份 zip，
 * 聊天里缓存的图一张都翻不到。新图现在会自动镜像，这个面板补的是**历史存量**。
 */
import { useCallback, useEffect, useState } from 'react';
import { Filesystem, Directory } from '@/services/filesystemAdapter';
import { exportAllChatImages, CHAT_IMAGE_EXPORT_DIR } from '@/services/chatMediaExport';

const PRIVATE_DIR = 'chat-images';

export function ChatMediaPanel() {
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState('');

  const countPrivate = useCallback(async () => {
    try {
      const result = await Filesystem.readdir({ path: PRIVATE_DIR, directory: Directory.Data });
      const sessions = (result.files ?? []) as Array<{ name: string; type?: string }>;
      let sum = 0;
      for (const session of sessions) {
        if (session.type && session.type !== 'directory') continue;
        try {
          const list = await Filesystem.readdir({
            path: `${PRIVATE_DIR}/${session.name}`,
            directory: Directory.Data,
          });
          for (const item of (list.files ?? []) as Array<{ name: string }>) {
            if (item?.name && !item.name.includes('_thumb')) sum += 1;
          }
        } catch {
          /* 单个会话跳过 */
        }
      }
      setTotal(sum);
    } catch {
      setTotal(0);
    }
  }, []);

  useEffect(() => {
    void countPrivate();
  }, [countPrivate]);

  const handleExport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setProgress({ done: 0, total: total ?? 0 });
    try {
      const result = await exportAllChatImages((done, all) => setProgress({ done, total: all }));
      if (result.error && result.exported === 0) {
        setMessage(result.error);
      } else {
        setMessage(
          `已导出 ${result.exported} 张到 ${result.where}` +
          (result.failed > 0 ? `（${result.failed} 张失败）` : ''),
        );
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '导出失败');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, total]);

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">聊天图片</h2>

      <div className="form-group">
        <p className="form-hint">
          聊天里的图存在 App 私有目录，普通文件管理器（包括给了 Shizuku 的 MT）看不到。
          这里可以把它们一次性导到公共目录：
          <br />
          <code>Documents/{CHAT_IMAGE_EXPORT_DIR}/&lt;日期&gt;/</code>
        </p>
        <p className="form-hint">
          当前私有目录里有 <strong>{total === null ? '…' : `${total} 张`}</strong>原图（不含缩略图）。
          以后新发的图会<strong>自动</strong>镜像一份过去，这个按钮只补历史存量。
        </p>
      </div>

      <div className="form-group">
        <button className="form-reset-btn" onClick={() => void handleExport()} disabled={busy || total === 0}>
          {busy
            ? progress
              ? `导出中 ${progress.done}/${progress.total}…`
              : '导出中…'
            : '导出全部到 Documents'}
        </button>
        {message && <p className="form-hint">{message}</p>}
      </div>

      <div className="form-group">
        <p className="form-hint">
          想拿单张：在聊天里点开大图，右上角有保存按钮（同样落到这个目录）。
        </p>
      </div>
    </div>
  );
}
