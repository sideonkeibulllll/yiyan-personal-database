/**
 * 作品封面提取（v3.8.0）
 *
 * 约定（只认 meta 标注，最简单可预测）：
 *   在入口 index.html 的 <head> 里写
 *   `<meta name="cover" content="cover.jpg">`
 *   就用 cover.jpg（作品内相对路径）当封面；没写就没有封面（类型徽标兜底）。
 *
 * 不自动截图、不自动生成 —— 封面图由 AI 用 draw_image 画好放进作品，
 * 文件 MCP 的工具描述里会告诉 AI 这个约定。
 */
import { isImagePath, readWorkBinary, readWorkText, sanitizeRelPath } from '@/services/workLibrary';

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

/**
 * 提取作品封面 → dataURL（无封面/不是 html/图缺失都返回 null）。
 * 读入口 html → 找 meta → 读作品内图片二进制。
 */
export async function extractWorkCover(workName: string, entryPath: string | null): Promise<string | null> {
  if (!entryPath || !/\.html?$/i.test(entryPath)) return null;
  const entry = await readWorkText(workName, entryPath);
  if (!entry) return null;
  const rel = parseCoverMeta(entry.text);
  if (!rel || !isImagePath(rel)) return null;
  const path = sanitizeRelPath(rel);
  const base64 = await readWorkBinary(workName, path);
  if (!base64) return null;
  const ext = (path.split('.').pop() || '').toLowerCase();
  const mime = EXT_MIME[ext] ?? 'image/png';
  return `data:${mime};base64,${base64}`;
}
