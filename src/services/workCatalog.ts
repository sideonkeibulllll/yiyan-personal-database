/**
 * 给作品生成 / 更新目录页（v4.0.0）
 *
 * 电脑端是 pack.py 打包时顺手生成；手机端 AI 写完一堆页面后，由这个函数补上，
 * 于是「散页面」也能变成结构完整的作品包（带 mod.json、入口指向目录页）。
 *
 * 三个约定：
 * - 旧目录页靠 `<meta name="yiyan-catalog">` 认出来，**原地覆盖**，不会越堆越多；
 * - 已有 index.html 的作品不抢它的名字，目录页退到 `_index.html`；
 * - 页面少于 2 个时不生成 —— 一个页面本来就是它自己的入口。
 */
import {
  formatFileSize,
  isHtmlPath,
  listWorkFiles,
  readWorkManifest,
  readWorkText,
  sanitizeWorkName,
  writeWorkText,
  type WorkFile,
} from '@/services/workLibrary';
import { getBundleIdMap } from '@/services/workBundle';
import {
  looksLikeCatalog,
  renderCatalogHtml,
  type CatalogPageEntry,
} from '@/utils/catalogTemplate';

export interface CatalogBuildResult {
  ok: boolean;
  message: string;
  /** 目录页在作品内的相对路径 */
  entry?: string;
  pages?: number;
  files?: number;
  /** 覆盖了已有目录页（而不是新建） */
  overwritten?: boolean;
}

const ENTRY_HINTS = ['从这里开始', '开始', '首页', '入口', 'index', 'main', 'home'];
const CANDIDATE_ENTRIES = ['index.html', '_index.html', '_catalog.html', '__catalog.html'];

function pickFeatured(pages: CatalogPageEntry[]): string | null {
  if (pages.length === 0) return null;
  const scored = pages
    .map(page => {
      const depth = page.rel.split('/').length - 1;
      const stem = (page.rel.split('/').pop() ?? '').replace(/\.html?$/i, '').toLowerCase();
      let score = Math.max(0, 10 - depth);
      if (depth === 0) score += 20;
      if (stem === 'index') score += 100;
      if (ENTRY_HINTS.some(hint => stem.includes(hint))) score += 40;
      return { rel: page.rel, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 同分按路径码点序，跟电脑端 pack.py 的 (-score, rel) 保持一致
      return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;
    });
  if (scored.length === 1) return scored[0].rel;
  return scored[0].score - scored[1].score >= 15 ? scored[0].rel : null;
}

function chooseCatalogEntry(files: WorkFile[], catalogPaths: string[]): string {
  if (catalogPaths.length > 0) return catalogPaths[0];
  const existing = new Set(files.map(file => file.path));
  for (const candidate of CANDIDATE_ENTRIES) {
    if (!existing.has(candidate)) return candidate;
  }
  return `__catalog-${Date.now()}.html`;
}

function slugifyWorkName(name: string): string {
  const base = name
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (/^[a-z0-9][a-z0-9-]{1,63}$/.test(base)) return base;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `work-${hash.toString(36)}`;
}

/**
 * 扫描作品里所有 html 页面，生成目录页 + mod.json。
 * 已有目录页会被原地覆盖；页面少于 2 个直接返回失败（没必要）。
 */
export async function buildWorkCatalog(
  rawName: string,
  opts: { featured?: string; description?: string } = {},
): Promise<CatalogBuildResult> {
  const work = sanitizeWorkName(rawName);
  const files = await listWorkFiles(work);
  if (files.length === 0) return { ok: false, message: '作品不存在或里面没有文件' };

  const catalogPaths: string[] = [];
  const pages: CatalogPageEntry[] = [];
  const htmlFiles = files.filter(file => isHtmlPath(file.path));

  for (const file of htmlFiles) {
    const content = await readWorkText(work, file.path);
    if (!content) continue;
    if (looksLikeCatalog(content.text)) {
      catalogPaths.push(file.path);
      continue;
    }
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(content.text);
    const title = match ? match[1].replace(/\s+/g, ' ').trim() : '';
    pages.push({ rel: file.path, title: title.slice(0, 120), size: file.size });
  }

  if (pages.length === 0) {
    return { ok: false, message: '这个作品里没有 html 页面，没什么可编目录的' };
  }
  if (pages.length === 1) {
    return { ok: false, message: '只有一个页面，它自己就是入口，不需要目录页' };
  }

  const manifest = await readWorkManifest(work);
  const entry = chooseCatalogEntry(files, catalogPaths);
  const featured = opts.featured && pages.some(page => page.rel === opts.featured)
    ? opts.featured
    : pickFeatured(pages);

  const idMap = getBundleIdMap();
  const mappedId = Object.entries(idMap).find(([, value]) => value?.work === work)?.[0];
  const manifestId = manifest?.id && /^[a-z0-9][a-z0-9-]{1,63}$/.test(manifest.id) ? manifest.id : '';
  const id = manifestId || mappedId || slugifyWorkName(work);

  const cover = manifest?.cover
    || files.find(file => /^(?:assets\/)?(?:cover|icon)\.(?:png|jpe?g|webp)$/i.test(file.path))?.path
    || null;

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0) + (catalogPaths.length > 0 ? 0 : 16000);
  const html = renderCatalogHtml({
    name: manifest?.name || work,
    description: opts.description ?? manifest?.description ?? '',
    pages,
    cover,
    featured,
    fileCount: files.length + (catalogPaths.length > 0 ? 0 : 1),
    totalBytes,
    formatSize: formatFileSize,
  });

  await writeWorkText(work, entry, html, { reason: 'ai' });

  const description = opts.description ?? manifest?.description;
  const modJson = {
    spec: 1,
    id,
    name: manifest?.name || work,
    version: manifest?.version || '1.0',
    entry,
    generated_entry: true,
    ...(cover ? { cover } : {}),
    ...(description ? { description } : {}),
  };
  await writeWorkText(work, 'mod.json', `${JSON.stringify(modJson, null, 2)}\n`, { reason: 'ai' });

  return {
    ok: true,
    message: `${catalogPaths.length > 0 ? '已更新' : '已生成'}目录页「${entry}」，共 ${pages.length} 个页面`,
    entry,
    pages: pages.length,
    files: files.length + (catalogPaths.length > 0 ? 0 : 1),
    overwritten: catalogPaths.length > 0,
  };
}

/** 快速判断这个作品是否已经带目录页（不需要全文，只看文件列表 + 入口） */
export async function hasCatalog(rawName: string): Promise<boolean> {
  const manifest = await readWorkManifest(sanitizeWorkName(rawName));
  return manifest?.generatedEntry === true;
}
