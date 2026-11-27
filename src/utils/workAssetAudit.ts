/**
 * 作品资源自检（v4.2.5）
 *
 * 干一件事：把 html 里「引用了什么」和作品文件夹里「真有什么」对一遍，
 * 把对不上的路径明明白白列出来。
 *
 * 为什么值得单独做：
 * 预览是沙箱 + srcDoc，一切相对路径都靠宿主内联/垫片喂过去。
 * 以前对不上就只是「裂图」——用户看到破损角标，AI 什么也看不到，
 * 只能猜。现在两边共享同一份清单：UI 弹角标，AI 调 check_work_assets。
 *
 * 覆盖：src / href / poster / data / srcset / style 里的 url()。
 * 不覆盖（也如实告诉 AI）：JS 运行时拼出来的路径，只能靠「目录 + 扩展名」核对。
 */
import { listWorkFiles, readWorkText, sanitizeRelPath, isHtmlPath } from '@/services/workLibrary';

export interface AssetIssue {
  /** 出问题的页面 */
  page: string;
  /** html 里的原始写法 */
  ref: string;
  /** 解析到作品内的路径 */
  path: string;
  /** missing=文件不存在；case=只有大小写对不上（Android 会当两个文件） */
  reason: 'missing' | 'case';
}

export interface AssetAuditResult {
  pages: number;
  refs: number;
  issues: AssetIssue[];
  /** 作品里的图片数量（给 AI 一个「该有几张」的锚） */
  images: number;
  /** 看起来像「动态拼路径」的代码片段（无法静态校验，提示人工核对） */
  dynamicHints: string[];
  /** 页面太多只查了前 N 个 */
  truncated?: boolean;
}

/** 单次审计最多读这么多页，244 页的作品全读一遍太慢 */
const MAX_AUDIT_PAGES = 80;

/** 与 workPreview.resolveAssetPath 同规则；外链返回 null */
export function resolveAssetRef(baseDir: string, ref: string): string | null {
  let clean = (ref || '').trim().split('#')[0].split('?')[0];
  if (!clean) return null;
  if (clean.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* 按原样 */
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

/** 从一份 HTML 里抽出所有可能指向包内文件的引用 */
export function extractAssetRefs(html: string): string[] {
  const out: string[] = [];
  const push = (value: string | undefined) => {
    const text = (value ?? '').trim();
    if (text) out.push(text);
  };

  // src / href / poster / data
  const attrRe = /\b(?:src|href|poster|data)\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(html))) push(m[1]);

  // srcset：逗号分隔，每项「路径 描述符」
  const srcsetRe = /\bsrcset\s*=\s*["']([^"']*)["']/gi;
  while ((m = srcsetRe.exec(html))) {
    for (const item of m[1].split(',')) {
      const url = item.trim().split(/\s+/)[0];
      push(url);
    }
  }

  // style 属性 / <style> 块里的 url()
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  while ((m = urlRe.exec(html))) push(m[2]);

  return out;
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/** 找「看起来像动态拼路径」的片段（`${}` 模板、字符串 + 变量 + 扩展名） */
function findDynamicHints(html: string): string[] {
  const hints: string[] = [];
  const patterns = [
    /[`'"][^`'"\n]{0,60}\$\{[^}]{1,40}\}[^`'"\n]{0,40}\.(?:jpg|jpeg|png|webp|gif|svg|mp4|css|js|json)[`'"]/gi,
    /['"][^'"\n]{0,40}['"]\s*\+\s*[A-Za-z_$][\w$]*\s*\+\s*['"][^'"\n]{0,20}\.(?:jpg|jpeg|png|webp|gif|svg|mp4)[`'"]/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const text = m[0].replace(/\s+/g, ' ').trim();
      if (text.length > 4 && !hints.includes(text)) hints.push(text);
      if (hints.length >= 8) return hints;
    }
  }
  return hints;
}

/**
 * 审计一个作品（可只查一个页面）。
 * 读不到的文件不算「缺失」——那是页面本身的问题，交给调用方。
 */
export async function auditWorkAssets(rawWork: string, onlyPath?: string): Promise<AssetAuditResult> {
  const files = await listWorkFiles(rawWork);
  const all = files.map(file => file.path);
  const lowerMap = new Map<string, string>();
  for (const path of all) lowerMap.set(path.toLowerCase(), path);

  const images = all.filter(path => /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path)).length;
  const allTargets = onlyPath
    ? all.filter(path => path === sanitizeRelPath(onlyPath))
    : all.filter(path => isHtmlPath(path));
  const truncated = allTargets.length > MAX_AUDIT_PAGES;
  const targets = allTargets.slice(0, MAX_AUDIT_PAGES);

  const issues: AssetIssue[] = [];
  const dynamicHints: string[] = [];
  let refs = 0;
  let pages = 0;

  for (const page of targets) {
    const content = await readWorkText(rawWork, page);
    if (!content) continue;
    pages += 1;

    for (const hint of findDynamicHints(content.text)) {
      if (!dynamicHints.includes(hint)) dynamicHints.push(hint);
    }

    const baseDir = dirOf(page);
    for (const raw of extractAssetRefs(content.text)) {
      const path = resolveAssetRef(baseDir, raw);
      if (!path) continue;
      // `href="./"` 这种指回当前目录的，解析出来就是 baseDir，不是资源
      if (path === baseDir) continue;
      refs += 1;
      if (all.includes(path)) continue;
      const caseHit = lowerMap.get(path.toLowerCase());
      if (caseHit) {
        issues.push({ page, ref: raw, path: caseHit, reason: 'case' });
      } else if (!issues.some(item => item.page === page && item.path === path)) {
        issues.push({ page, ref: raw, path, reason: 'missing' });
      }
    }
  }

  return { pages, refs, issues, images, dynamicHints: dynamicHints.slice(0, 8), truncated };
}

/** 给 AI 看的自然语言摘要 */
export function describeAssetAudit(result: AssetAuditResult): string {
  const lines: string[] = [];
  lines.push(`扫描 ${result.pages} 个页面、${result.refs} 处引用，作品内图片 ${result.images} 张${result.truncated ? '（页面太多，只查了前 80 个）' : ''}。`);
  if (result.issues.length === 0) {
    lines.push('没有发现断掉的引用。');
  } else {
    const missing = result.issues.filter(item => item.reason === 'missing');
    const caseMiss = result.issues.filter(item => item.reason === 'case');
    if (missing.length > 0) {
      lines.push(`有 ${missing.length} 处引用的文件不存在：`);
      for (const item of missing.slice(0, 25)) {
        lines.push(`- ${item.page} → ${item.ref}（解析为 ${item.path}）`);
      }
    }
    if (caseMiss.length > 0) {
      lines.push(`有 ${caseMiss.length} 处只有大小写对不上（Android 区分大小写，会裂）：`);
      for (const item of caseMiss.slice(0, 12)) {
        lines.push(`- ${item.page} → ${item.ref}（实际文件名 ${item.path}）`);
      }
    }
  }
  if (result.dynamicHints.length > 0) {
    lines.push('检测到这些动态拼出来的路径，静态校验管不到，请核对「目录名 + 文件名 + 扩展名」是否与真实文件一致：');
    for (const hint of result.dynamicHints) lines.push(`- ${hint}`);
  }
  return lines.join('\n');
}
