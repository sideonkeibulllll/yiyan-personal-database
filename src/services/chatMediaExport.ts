/**
 * 聊天图片「对外可见」副本（v4.2.6）
 *
 * 问题：聊天图片一直躺在 `chat-images/`（Directory.Data = Android 私有目录
 * `/data/user/0/<包名>/files/`）。没有 root 的文件管理器（包括给了 Shizuku 的 MT）
 * 都看不到——用户想「把那张图拿出来」只能一张张点开保存。
 *
 * 解法：落盘时**镜像一份**到 `Documents/yiyan-chat-images/<日期>/`，
 * 与备份 zip 同一个公共根。文件管理器里按日期目录翻，按时间排序就是聊天顺序。
 *
 * 三条约束：
 * - **镜像失败绝不阻塞聊天**：私有目录那份才是功能依赖，公共目录只是出口；
 * - 文件名带时分秒（私有目录那套是时间戳36进制+随机串，人眼没法看）；
 * - 缩略图 `_thumb.jpg` 不镜像，只镜像原图。
 */
import { Filesystem, Directory } from './filesystemAdapter';

/** 公共目录下的根文件夹 */
export const CHAT_IMAGE_EXPORT_DIR = 'yiyan-chat-images';
/** 私有目录（attachmentService 里的聊天图片根） */
const PRIVATE_DIR = 'chat-images';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function timeKey(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/** 从私有文件名里抠出 4 位随机尾巴，防止同一秒内多张图重名 */
function tailOf(fileName: string): string {
  const clean = (fileName || '').replace(/[^a-zA-Z0-9]/g, '');
  return clean.slice(-4) || 'img';
}

/**
 * 把一张聊天原图镜像到公共 Documents。
 * @param fileName 私有目录里的文件名（`xxx_orig.jpg`）
 * @param base64   图片字节
 * @returns 公共目录里的相对路径；失败返回 null（调用方忽略即可）
 */
export async function mirrorChatImageToDocuments(fileName: string, base64: string): Promise<string | null> {
  if (!base64) return null;
  const now = new Date();
  const path = `${CHAT_IMAGE_EXPORT_DIR}/${dayKey(now)}/${timeKey(now)}_${tailOf(fileName)}.jpg`;
  try {
    await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });
    return path;
  } catch {
    return null;
  }
}

export interface ChatImageExportResult {
  ok: boolean;
  exported: number;
  skipped: number;
  failed: number;
  /** 展示给用户的落点 */
  where: string;
  error?: string;
}

/**
 * 把**历史**聊天图片一次性导出到公共目录。
 *
 * 按文件 mtime 归到日期目录（拿不到 mtime 就用当天），
 * 这样主人按日期翻就能对上「哪天聊的」。
 */
export async function exportAllChatImages(
  onProgress?: (done: number, total: number) => void,
): Promise<ChatImageExportResult> {
  const where = `Documents/${CHAT_IMAGE_EXPORT_DIR}`;
  let sessions: Array<{ name: string; type?: string }> = [];
  try {
    const result = await Filesystem.readdir({ path: PRIVATE_DIR, directory: Directory.Data });
    sessions = (result.files ?? []) as Array<{ name: string; type?: string }>;
  } catch {
    return { ok: true, exported: 0, skipped: 0, failed: 0, where, error: '还没有聊天图片' };
  }

  // 先扫一遍总数，进度才有意义
  const jobs: Array<{ dir: string; file: string; mtime: number }> = [];
  for (const session of sessions) {
    if (session.type && session.type !== 'directory') continue;
    const dir = `${PRIVATE_DIR}/${session.name}`;
    try {
      const list = await Filesystem.readdir({ path: dir, directory: Directory.Data });
      for (const item of (list.files ?? []) as Array<{ name: string; mtime?: number }>) {
        if (!item?.name) continue;
        if (item.name.includes('_thumb')) continue;
        jobs.push({ dir, file: item.name, mtime: typeof item.mtime === 'number' ? item.mtime : 0 });
      }
    } catch {
      /* 单个会话读不到就跳过 */
    }
  }

  if (jobs.length === 0) {
    return { ok: true, exported: 0, skipped: 0, failed: 0, where, error: '还没有聊天图片' };
  }

  let exported = 0;
  let failed = 0;
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    try {
      const { data } = await Filesystem.readFile({ path: `${job.dir}/${job.file}`, directory: Directory.Data });
      const base64 = typeof data === 'string' ? data : '';
      if (!base64) {
        failed += 1;
        continue;
      }
      const when = job.mtime > 0 ? new Date(job.mtime) : new Date();
      const path = `${CHAT_IMAGE_EXPORT_DIR}/${dayKey(when)}/${timeKey(when)}_${tailOf(job.file)}.jpg`;
      await Filesystem.writeFile({
        path,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      });
      exported += 1;
    } catch {
      failed += 1;
    }
    onProgress?.(i + 1, jobs.length);
  }

  return { ok: true, exported, skipped: 0, failed, where };
}
