/**
 * 作品预览构造（v3.9.0：多页面作品包能真点开）
 *
 * 为什么需要它：作品在沙箱 iframe 里用 `srcDoc` 渲染，文档 base 是宿主 App 的地址，
 * 包内的相对链接（`01_研究报告/00_研究总纲.html`）和相对资源（`assets/a.png`）
 * 全部会解析到 App 自己的 URL 上，点不开、图裂。
 *
 * 这里做两件事：
 * 1. **资源内联**：把当前页面引用到的 css / js / 图片 / 字体按相对路径读出来，
 *    转成 data URL 或内联文本塞回 html，不依赖网络、不依赖文件系统协议；
 * 2. **链接拦截**：注入一段脚本，`<a href>` 指向包内路径时不发请求，
 *    改成 postMessage 给宿主，由宿主切页重渲染。
 *
 * 只处理「当前这一页」引用的资源（懒内联），所以 244 个文件的作品也不会一次性爆内存。
 * 已知限制：JS 运行时拼接出来的路径（`fetch('data.json')`）管不了——
 * 那是虚拟文件系统才能解决的事，不在当前范围内。
 */
import { readWorkBinary, readWorkText } from '@/services/workLibrary';
import type { RecentPage } from '@/services/workRecent';
import { buildStorageShimScript, injectScripts } from '@/utils/htmlStorageShim';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  json: 'application/json',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  txt: 'text/plain',
  xml: 'application/xml',
};

export interface PreviewReport {
  html: string;
  /** 成功内联的资源数 */
  inlined: number;
  /** 引用了但包里找不到的路径（截图/排查用） */
  missing: string[];
  /** 超过体积没内联的资源 */
  skipped: string[];
}

/** CSS / 字体这类单个资源超过这个大小就不内联了，避免一页几十 MB */
const MAX_INLINE_BYTES = 6 * 1024 * 1024;

function extOf(path: string): string {
  const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/**
 * 包内相对引用 → 作品内路径。
 * 外部链接 / data: / #锚点 一律返回 null，交给浏览器原样处理。
 */
export function resolveAssetPath(baseDir: string, ref: string): string | null {
  let clean = (ref || '').trim().split('#')[0].split('?')[0];
  if (!clean) return null;
  if (clean.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* 编码不合法就按原样解析 */
  }
  const segs = clean.startsWith('/') ? [] : (baseDir ? baseDir.split('/') : []);
  for (const part of clean.replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  return segs.length > 0 ? segs.join('/') : null;
}

/** 正则异步替换：先收集所有匹配，再统一并发处理，最后按原位拼回 */
async function replaceAsync(
  input: string,
  regex: RegExp,
  fn: (...args: string[]) => Promise<string>,
): Promise<string> {
  const matches = [...input.matchAll(regex)];
  if (matches.length === 0) return input;
  const results = await Promise.all(matches.map(match => fn(...(match as unknown as string[]))));
  let out = '';
  let last = 0;
  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    out += input.slice(last, start) + results[index];
    last = start + match[0].length;
  });
  return out + input.slice(last);
}

async function dataUrlOf(work: string, path: string): Promise<string | null> {
  const base64 = await readWorkBinary(work, path);
  if (!base64) return null;
  // base64 长度 ≈ 字节数 * 4/3，粗略挡一下超大资源
  if (base64.length * 0.75 > MAX_INLINE_BYTES) return null;
  const mime = MIME[extOf(path)] ?? 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}

async function inlineCssUrls(
  css: string,
  baseDir: string,
  work: string,
  report: PreviewReport,
): Promise<string> {
  return replaceAsync(
    css,
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    async (full, _quote, ref) => {
      const refText = (ref ?? '').trim();
      if (!refText || refText.startsWith('#')) return full;
      const path = resolveAssetPath(baseDir, refText);
      if (!path) return full;
      const dataUrl = await dataUrlOf(work, path);
      if (!dataUrl) {
        report.missing.push(path);
        return full;
      }
      report.inlined += 1;
      return `url(${dataUrl})`;
    },
  );
}

/** 注入沙箱内的链接拦截：包内跳转交回宿主，外链不动 */
function buildNavGuardScript(): string {
  return `<script>
(function () {
  if (window.__yiyanNavGuard) return;
  window.__yiyanNavGuard = true;
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && el.nodeName !== 'A') el = el.parentNode;
    if (!el || el.nodeName !== 'A') return;
    var raw = el.getAttribute('href');
    if (!raw) return;
    if (/^\\s*(#|javascript:|mailto:|tel:|data:|blob:)/i.test(raw)) return;
    if (raw.slice(0, 2) === '//') return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return;
    e.preventDefault();
    parent.postMessage({ __yiyanNav: raw }, '*');
  }, true);
})();
</script>`;
}

/** 宿主侧解析子页面发来的跳转请求 → 作品内相对路径（带 hash 时一并返回） */
export function parseNavTarget(baseDir: string, raw: string): { path: string; hash: string } | null {
  const text = (raw || '').trim();
  if (!text) return null;
  const hashIndex = text.indexOf('#');
  const hash = hashIndex >= 0 ? text.slice(hashIndex + 1) : '';
  const path = resolveAssetPath(baseDir, text);
  if (!path) return null;
  return { path, hash };
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 包内路径 → href（逐段编码，保留 `/`） */
function encodePathForHref(path: string): string {
  return path.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

/**
 * 往生成的目录页里插一条「继续上次」。
 *
 * 目录页自己不知道用户看过什么，所以由宿主传进来最近访问的页面，
 * 这里读出目标页的 <title> 当按钮文字，插在搜索框那行**上面**——一进来就看得见。
 */
async function injectResumeBlock(
  html: string,
  work: string,
  pagePath: string,
  recent: RecentPage[],
): Promise<string> {
  const picked: Array<{ path: string; title: string }> = [];
  for (const item of recent) {
    if (picked.length >= 2) break;
    if (item.path === pagePath) continue;
    if (!/\.html?$/i.test(item.path)) continue;
    const file = await readWorkText(work, item.path);
    if (!file) continue;
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(file.text);
    const rawTitle = match ? match[1].replace(/\s+/g, ' ').trim() : '';
    const base = item.path.split('/').pop() ?? item.path;
    picked.push({ path: item.path, title: rawTitle || base.replace(/\.html?$/i, '') });
  }
  if (picked.length === 0) return html;

  const links = picked
    .map(item => `<a class="yiyan-resume-a" href="${encodePathForHref(item.path)}">${escapeHtmlText(item.title)}</a>`)
    .join('');

  const block = [
    '<style>',
    '.yiyan-resume{display:flex;align-items:center;gap:8px;margin:0 0 14px}',
    '.yiyan-resume-t{flex:none;font-size:12px;color:var(--dim,#9494a4);letter-spacing:.02em}',
    '.yiyan-resume-a{flex:1 1 0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:6px 11px;border-radius:999px;font-size:12.5px;text-decoration:none;color:var(--fg,#f1f1f6);background:var(--card,#23242d);border:1px solid var(--line,#33343f);transition:border-color .15s,color .15s}',
    '.yiyan-resume-a:hover,.yiyan-resume-a:active{border-color:var(--accent,#7d9bff);color:var(--accent,#7d9bff)}',
    '</style>',
    `<div class="yiyan-resume"><span class="yiyan-resume-t">继续上次</span>${links}</div>`,
  ].join('');

  // 目录页声明的插槽优先（v4.0.0 起的包都有）；老包退化成插在搜索框那行前面
  const slotPattern = /<div\s+id=["']yiyan-slot-resume["'][^>]*>\s*<\/div>/i;
  if (slotPattern.test(html)) {
    return html.replace(slotPattern, () => block);
  }
  if (/<div\s+class=["']bar["']/i.test(html)) {
    return html.replace(/<div\s+class=["']bar["'][^>]*>/i, m => `${block}\n${m}`);
  }
  if (/<main\b[^>]*>/i.test(html)) {
    return html.replace(/<main\b[^>]*>/i, m => `${m}\n${block}`);
  }
  return html;
}

/**
 * 构造一页可预览的 html。
 * 失败（文件不存在）返回 null，交给调用方提示。
 */
export async function buildWorkPreview(
  work: string,
  pagePath: string,
  appData: Record<string, string>,
  options: { recent?: RecentPage[] } = {},
): Promise<PreviewReport | null> {
  const file = await readWorkText(work, pagePath);
  if (!file) return null;

  const report: PreviewReport = { html: '', inlined: 0, missing: [], skipped: [] };
  const baseDir = dirOf(pagePath);
  let html = file.text;

  // 1. 原始的内联 <style> 块：先把里面的 url() 换掉
  html = await replaceAsync(
    html,
    /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
    async (full, _attrs, body) => {
      if (!/url\(/i.test(body ?? '')) return full;
      const inlined = await inlineCssUrls(body ?? '', baseDir, work, report);
      const open = full.slice(0, full.indexOf('>') + 1);
      return `${open}${inlined}</style>`;
    },
  );

  // 2. style="..." 属性里的 url()
  html = await replaceAsync(
    html,
    /(\bstyle\s*=\s*["'])([^"']*)(["'])/gi,
    async (full, pre, value, post) => {
      if (!/url\(/i.test(value ?? '')) return full;
      const inlined = await inlineCssUrls(value ?? '', baseDir, work, report);
      return `${pre}${inlined}${post}`;
    },
  );

  // 3. <link>：样式表内联成 <style>，图标类换成 data URL
  html = await replaceAsync(html, /<link\b[^>]*>/gi, async tag => {
    const relMatch = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag);
    const hrefMatch = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!hrefMatch) return tag;
    const rel = relMatch ? relMatch[1] : '';
    const path = resolveAssetPath(baseDir, hrefMatch[1]);
    if (!path) return tag;

    if (/stylesheet/i.test(rel)) {
      const css = await readWorkText(work, path);
      if (!css) {
        report.missing.push(path);
        return tag;
      }
      const body = await inlineCssUrls(css.text, dirOf(path), work, report);
      report.inlined += 1;
      return `<style data-yiyan-src="${path.replace(/"/g, '&quot;')}">\n${body}\n</style>`;
    }

    const dataUrl = await dataUrlOf(work, path);
    if (!dataUrl) {
      report.missing.push(path);
      return tag;
    }
    report.inlined += 1;
    return tag.replace(/(\bhref\s*=\s*["'])[^"']*(["'])/i, `$1${dataUrl}$2`);
  });

  // 4. <script src>：内联成行内脚本（转义 </script 防提前闭合）
  html = await replaceAsync(
    html,
    /<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script\s*>/gi,
    async (full, pre, src, post) => {
      const path = resolveAssetPath(baseDir, src);
      if (!path) return full;
      const js = await readWorkText(work, path);
      if (!js) {
        report.missing.push(path);
        return full;
      }
      const attrs = `${pre ?? ''} ${post ?? ''}`
        .replace(/\bsrc\s*=\s*["'][^"']*["']/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      report.inlined += 1;
      const body = js.text.replace(/<\/script/gi, '<\\/script');
      return `<script${attrs ? ` ${attrs}` : ''}>\n${body}\n</script>`;
    },
  );

  // 5. src / poster：图片、媒体、iframe 之外的一切相对资源
  html = await replaceAsync(
    html,
    /(\b(?:src|poster)\s*=\s*["'])([^"']+)(["'])/gi,
    async (full, pre, value, post) => {
      const path = resolveAssetPath(baseDir, value);
      if (!path) return full;
      // 包内的 html 不内联（多半是 iframe），保留原样避免嵌套文档踩坑
      if (/\.html?$/i.test(path)) return full;
      const dataUrl = await dataUrlOf(work, path);
      if (!dataUrl) {
        report.missing.push(path);
        return full;
      }
      report.inlined += 1;
      return `${pre}${dataUrl}${post}`;
    },
  );

  // 6. srcset：逗号分隔的候选图，逐个换
  html = await replaceAsync(
    html,
    /(\bsrcset\s*=\s*["'])([^"']*)(["'])/gi,
    async (full, pre, value, post) => {
      const items = (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
      if (items.length === 0) return full;
      const out: string[] = [];
      for (const item of items) {
        const [url, ...descriptor] = item.split(/\s+/);
        const path = resolveAssetPath(baseDir, url);
        if (!path) {
          out.push(item);
          continue;
        }
        const dataUrl = await dataUrlOf(work, path);
        if (!dataUrl) {
          report.missing.push(path);
          out.push(item);
          continue;
        }
        report.inlined += 1;
        out.push([dataUrl, ...descriptor].join(' '));
      }
      return `${pre}${out.join(', ')}${post}`;
    },
  );

  if (options.recent && options.recent.length > 0) {
    html = await injectResumeBlock(html, work, pagePath, options.recent);
  }

  report.html = injectScripts(html, [buildStorageShimScript(appData), buildNavGuardScript()]);
  return report;
}
