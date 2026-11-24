/**
 * 作品封面提取（v4.2.0 起三级优先）
 *
 * 优先级（越靠前越「显式」）：
 *   1. `mod.json` 的 `cover` 字段 —— 平台/UI/AI 都能写，**完全不用动 html**
 *   2. 入口 html `<head>` 里的 `<meta name="cover" content="cover.jpg">`（v3.8.0 老约定）
 *   3. 约定文件名 `cover.jpg / cover.png / cover.webp`（根目录或 assets/ 下）
 *
 * 为什么加第 1 条：v3.8.0 只有第 2 条，导致「加个封面」= 重写整份 html；
 * 而且 build_catalog 生成的目录页作品会把 cover 写进 mod.json，列表页却读不到。
 * 现在 mod.json 是主通道，meta 是兼容通道。
 */
import { findConventionalCover, isImagePath, listWorkFiles, readWorkBinary, readWorkManifest, readWorkText, sanitizeRelPath } from '@/services/workLibrary';

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

/** 从 html 文本里抠 meta name="cover" 的 content（兼容属性顺序颠倒） */
export function parseCoverMeta(html: string): string | null {
  const re = /<meta\b[^>]*?(?:name=["']cover["'][^>]*?content=["']([^"']+)["']|content=["']([^"']+)["'][^>]*?name=["']cover["'])[^>]*?>/i;
  const m = html.match(re);
  const value = m?.[1] ?? m?.[2] ?? null;
  return value ? value.trim() : null;
}

/** 约定文件名交给 workLibrary 的 findConventionalCover 判定（与列表页同一套规则，v4.2.1） */

async function toDataUrl(workName: string, rel: string): Promise<string | null> {
  if (!isImagePath(rel)) return null;
  const path = sanitizeRelPath(rel);
  const base64 = await readWorkBinary(workName, path);
  if (!base64) return null;
  const ext = (path.split('.').pop() || '').toLowerCase();
  const mime = EXT_MIME[ext] ?? 'image/png';
  return `data:${mime};base64,${base64}`;
}

/**
 * 提取作品封面 → dataURL（无封面 / 不是 html 作品 / 图缺失都返回 null）。
 */
export async function extractWorkCover(workName: string, entryPath: string | null): Promise<string | null> {
  // 1) 清单声明（AI set_cover / UI「设为封面」写的就是它）
  try {
    const manifest = await readWorkManifest(workName);
    if (manifest?.cover) {
      const hit = await toDataUrl(workName, manifest.cover);
      if (hit) return hit;
    }
  } catch {
    /* 清单坏了继续走下一条 */
  }

  // 2) 入口 html 里的 meta（v3.8.0 兼容通道）
  if (entryPath && /\.html?$/i.test(entryPath)) {
    try {
      const entry = await readWorkText(workName, entryPath);
      const rel = entry ? parseCoverMeta(entry.text) : null;
      if (rel) {
        const hit = await toDataUrl(workName, rel);
        if (hit) return hit;
      }
    } catch {
      /* 继续走第 3 条 */
    }
  }

  // 3) 约定文件名兜底（只在这一步才列目录，常见路径省一次 readdir）
  try {
    const paths = (await listWorkFiles(workName)).map(file => file.path);
    const conventional = findConventionalCover(paths);
    if (conventional) {
      const hit = await toDataUrl(workName, conventional);
      if (hit) return hit;
    }
  } catch {
    /* ignore */
  }

  return null;
}
