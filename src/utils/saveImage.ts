/**
 * 把一张 dataURL 图片存到「用户找得到的地方」（v4.2.5）
 *
 * 起因：聊天里缓存的图、作品里的图、条目附件，全都躺在 App 私有目录
 * （Android 上是 /data/user/0/<包名>/files），MT 管理器没 root 看不见。
 * 用户想「把那张图拿出来」时，唯一的正路就是 App 自己导出。
 *
 * 落点：
 * - Android / iOS：`Documents/yiyan-images/`（与备份 zip 同一个公共目录，
 *   文件管理器里能直接看到）
 * - Web / Electron：走浏览器下载
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@/services/filesystemAdapter';

export interface SaveImageResult {
  ok: boolean;
  /** 成功时告诉用户去哪里找 */
  where?: string;
  error?: string;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

function splitDataUrl(dataUrl: string): { base64: string; mime: string; ext: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!match) return null;
  const mime = match[1].toLowerCase();
  return {
    mime,
    base64: match[2],
    ext: EXT_BY_MIME[mime] ?? 'jpg',
  };
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeName(raw?: string): string {
  const text = (raw || '').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return text.slice(0, 40) || 'yiyan-image';
}

/**
 * 保存一张图。
 * @param dataUrl data:image/...;base64,... 形式
 * @param baseName 文件名主干（会给个时间戳后缀）；不给就叫 yiyan-image
 */
export async function saveImageToDevice(dataUrl: string, baseName?: string): Promise<SaveImageResult> {
  const parsed = splitDataUrl(dataUrl);
  if (!parsed) {
    return { ok: false, error: '这张图不是 dataURL 形式，没法直接存（外链图片请用浏览器另存）' };
  }
  const fileName = `${safeName(baseName)}-${stamp()}.${parsed.ext}`;

  if (!Capacitor.isNativePlatform()) {
    try {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return { ok: true, where: `浏览器下载目录（${fileName}）` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '下载失败' };
    }
  }

  const dir = 'yiyan-images';
  try {
    await Filesystem.writeFile({
      path: `${dir}/${fileName}`,
      data: parsed.base64,
      directory: Directory.Documents,
      recursive: true,
    });
    return { ok: true, where: `Documents/${dir}/${fileName}` };
  } catch (err) {
    // Documents 写不了（个别系统禁了公共目录）→ 退到 App 外部目录，至少能被 MT 看到
    try {
      await Filesystem.writeFile({
        path: `${dir}/${fileName}`,
        data: parsed.base64,
        directory: Directory.External,
        recursive: true,
      });
      return { ok: true, where: `Android/data/<包名>/files/${dir}/${fileName}` };
    } catch {
      return { ok: false, error: err instanceof Error ? err.message : '保存失败' };
    }
  }
}
