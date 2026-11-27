/**
 * 图片工具（v4.2.5）
 *
 * 两个用途：
 * 1. `view_image` 把作品里的图送进模型 —— 大图要先缩，手机原图 4000px
 *    直接进去既贵又慢，而且多数模型会把长边压到 1024~1568。
 * 2. 判断一个路径到底是不是图片、MIME 是什么（read_file 拿到的是 base64 乱码，
 *    别让模型去猜）。
 */

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

/** 路径 → 图片 MIME（不是图片返回 null） */
export function imageMimeOf(path: string): string | null {
  const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return null;
  return MIME_BY_EXT[base.slice(dot + 1).toLowerCase()] ?? null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/**
 * 把 dataURL 缩到长边 ≤ maxEdge 的 JPEG。
 *
 * 返回 null 表示「不需要或者压不了」——调用方应该原样使用原图：
 * - SVG 缩放会失真，不碰；
 * - 本来就不超尺寸、体积也不大，不折腾（重编码反而可能变大）。
 */
export async function compressImageDataUrl(
  dataUrl: string,
  maxEdge = 1024,
  quality = 0.82,
): Promise<string | null> {
  if (!dataUrl.startsWith('data:image/')) return null;
  if (dataUrl.startsWith('data:image/svg')) return null;
  if (dataUrl.startsWith('data:image/gif')) return null; // 动图会被压成静态帧

  let img: HTMLImageElement;
  try {
    img = await loadImage(dataUrl);
  } catch {
    return null;
  }
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return null;

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  if (scale >= 1 && dataUrl.length <= 1_400_000) return null;

  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // PNG 透明区转 JPEG 会变黑，铺一层白底
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const out = canvas.toDataURL('image/jpeg', quality);
    return out.startsWith('data:image/jpeg') ? out : null;
  } catch {
    return null;
  }
}
