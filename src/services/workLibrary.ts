/**
 * 作品库（v3.8.0）：一个作品 = 一个文件夹
 *
 * 目录模型（私有目录 Data/works/ 下）：
 *   works/<作品名>/            作品文件夹，名字沿用原文件名（如 记账本.html / note.md）
 *   works/<作品名>/index.<ext> 入口固定 index.<ext>（html → index.html，md → index.md…）
 *   works/<作品名>/**          其余任意文件（css/js/图片…），支持一层子目录
 *
 * 设计边界：
 * - 作品名 / 相对路径都不接受 `..` 与路径越界（防跳出 works/）。
 * - 文本走 UTF-8 编解码；图片走 base64 原样（Filesystem 本身就是 base64 管道）。
 * - 覆盖写前自动留版本快照（fileAssets，键 `<作品名>/<相对路径>`）。
 * - 平铺 files/ 时代的旧文件启动时一键迁移（migrateLegacyFlatFiles）。
 */
import { Filesystem, Directory } from './filesystemAdapter';
import { migrateVersionKeys, purgeFileAssets, migrateFileAssets, snapshotVersion } from './fileAssets';
import { forgetWorkIdByWork } from './workIds';
import { forgetWorkRecent } from './workRecent';

const WORKS_DIR = 'works';
const LEGACY_DIR = 'files';
const MIGRATED_FLAG = 'yiyan_works_migrated_v1';

/** 单文件读取上限（超出截断，防止把整本小说灌进上下文） */
export const FILE_READ_MAX_CHARS = 200_000;

export interface WorkFile {
  /** 相对作品文件夹的路径（`index.html`、`assets/a.png`） */
  path: string;
  size: number;
  mtime: number;
}

export interface WorkInfo {
  /** 作品名 = 文件夹名 */
  name: string;
  /** 入口相对路径（index.*；找不到时回落第一个文件） */
  entry: string | null;
  isHtml: boolean;
  /** 全部文件总字节 */
  size: number;
  mtime: number;
  fileCount: number;
  /**
   * 封面图相对路径（v4.2.1）：`mod.json.cover` 或约定的 `cover.jpg/png`。
   * 只覆盖「文件能直接看出来」的两种来源；html `<meta name="cover">` 要另外解析，
   * 这里不做（list 每次进页面都跑，不能为封面把每个作品 html 都读一遍）。
   */
  cover: string | null;
  /** 封面来源：manifest=mod.json 声明，file=约定文件名，null=没声明 */
  coverSource: 'manifest' | 'file' | null;
}

/** 约定封面文件名（根目录或 assets/ 下） */
const CONVENTIONAL_COVER_RE = /^(?:assets\/)?cover\.(?:jpe?g|png|webp)$/i;

/** 从文件清单里挑约定封面（v4.2.1：给 listWorks / extractWorkCover 共用） */
export function findConventionalCover(paths: string[]): string | null {
  return paths.find(path => CONVENTIONAL_COVER_RE.test(path)) ?? null;
}

export interface WorkTextContent {
  path: string;
  text: string;
  truncated: boolean;
  size: number;
}

// ===== 名称 / 路径清洗 =====

export function sanitizeWorkName(raw: string): string {
  const base = (raw || '').replace(/[\\/]/g, '-').replace(/[\u0000-\u001f]/g, '').trim();
  return base.length > 0 ? base.slice(0, 120) : 'untitled';
}

/** 相对路径清洗：`\`→`/`、去首尾`/`、丢 `.`/`..` 段（越界直接折断） */
export function sanitizeRelPath(raw: string): string {
  const parts = (raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(seg => seg.trim())
    .filter(seg => seg.length > 0 && seg !== '.' && seg !== '..');
  return parts.join('/').slice(0, 240);
}

export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path);
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path);
}

/**
 * 入口挑选：清单声明的优先 → index.html → 任意 index.* → 按名排序第一个。
 * `declared` 来自作品内的 mod.json（作品包导入时写进去的），指向生成的目录页。
 */
export function pickEntry(files: string[], declared?: string | null): string | null {
  if (files.length === 0) return null;
  if (declared) {
    const hit = files.find(f => f === declared);
    if (hit) return hit;
  }
  const sorted = [...files].sort((a, b) => a.localeCompare(b));
  const indexHtml = sorted.find(f => /^index\.html?$/i.test(f));
  if (indexHtml) return indexHtml;
  const anyIndex = sorted.find(f => /^index\.[a-z0-9]+$/i.test(f));
  if (anyIndex) return anyIndex;
  return sorted[0];
}

export interface WorkManifest {
  id?: string;
  name?: string;
  version?: string;
  /** 清单声明的入口（作品包导入的目录页） */
  entry?: string;
  cover?: string;
  description?: string;
  /** 入口是打包器生成的目录页 */
  generatedEntry?: boolean;
}

/** 读作品内的 mod.json（没有或不合法就返回 null，不影响老作品） */
export async function readWorkManifest(rawName: string): Promise<WorkManifest | null> {
  const raw = await readRaw(sanitizeWorkName(rawName), 'mod.json');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(base64ToText(raw)) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const entry = typeof parsed.entry === 'string' ? sanitizeRelPath(parsed.entry) : '';
    return {
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
      entry: entry || undefined,
      cover: typeof parsed.cover === 'string' ? sanitizeRelPath(parsed.cover) : undefined,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      generatedEntry: parsed.generated_entry === true,
    };
  } catch {
    return null;
  }
}

/**
 * 设置（或取消）作品封面 —— **写 mod.json，不动任何 html**（v4.2.0）
 *
 * 为什么要有这条路：v3.8.0 只认入口 html 的 `<meta name="cover">`，
 * 于是「给作品加个封面」= 整份 html 重写。封面本来就是作品的元信息，
 * 不该绑在内容文件里；mod.json 的 cover 字段才是它的家。
 *
 * @param coverPath 作品内图片相对路径；传 null 表示取消封面
 */
export async function setWorkCover(rawName: string, coverPath: string | null): Promise<void> {
  const name = sanitizeWorkName(rawName);
  const raw = await readRaw(name, 'mod.json');
  let manifest: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(base64ToText(raw)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        manifest = parsed as Record<string, unknown>;
      }
    } catch {
      // mod.json 坏了就当空的，下面重建一份最小清单
    }
  }
  if (coverPath) {
    manifest.cover = sanitizeRelPath(coverPath);
  } else {
    delete manifest.cover;
  }
  if (typeof manifest.spec !== 'number') manifest.spec = 1;
  if (typeof manifest.name !== 'string' || !manifest.name) manifest.name = name;
  await writeWorkText(name, 'mod.json', `${JSON.stringify(manifest, null, 2)}\n`, { reason: 'system' });
}

/** 由原文件名推入口名：demo.html → index.html */
export function entryNameFor(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : 'txt';
  return `index.${ext || 'txt'}`;
}

// ===== base64 管道 =====

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToText(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

// ===== 底层路径 =====

function workPath(name: string, rel?: string): string {
  const w = sanitizeWorkName(name);
  const r = rel ? sanitizeRelPath(rel) : '';
  return r ? `${WORKS_DIR}/${w}/${r}` : `${WORKS_DIR}/${w}`;
}

async function ensureWorkDir(name: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path: workPath(name), directory: Directory.Data, recursive: true });
  } catch {
    // 已存在会抛错，忽略
  }
}

async function readRaw(name: string, rel: string): Promise<string | null> {
  try {
    const { data } = await Filesystem.readFile({ path: workPath(name, rel), directory: Directory.Data });
    return typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}

async function writeRaw(name: string, rel: string, base64: string): Promise<void> {
  await ensureWorkDir(name);
  const relPath = sanitizeRelPath(rel);
  await Filesystem.writeFile({
    path: workPath(name, relPath),
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });
}

// ===== 列表 =====

/** 递归列出一个作品内的全部文件 */
export async function listWorkFiles(rawName: string): Promise<WorkFile[]> {
  const name = sanitizeWorkName(rawName);
  const out: WorkFile[] = [];

  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries: Array<{ name: string; type?: string; size?: number; mtime?: number }> = [];
    try {
      const result = await Filesystem.readdir({ path: dir, directory: Directory.Data });
      entries = (result.files ?? []) as Array<{ name: string; type?: string; size?: number; mtime?: number }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      const base = entry.name.includes('/') ? entry.name.split('/').pop()! : entry.name;
      const rel = prefix ? `${prefix}/${base}` : base;
      if (entry.type === 'directory') {
        await walk(`${dir}/${base}`, rel);
      } else {
        out.push({
          path: rel,
          size: typeof entry.size === 'number' ? entry.size : 0,
          mtime: typeof (entry as { mtime?: number }).mtime === 'number' ? (entry as { mtime?: number }).mtime! : 0,
        });
      }
    }
  };

  await walk(workPath(name), '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 列出全部作品（按修改时间倒序，新改的排前面） */
export async function listWorks(): Promise<WorkInfo[]> {
  let entries: Array<{ name: string; type?: string }> = [];
  // mkdir 必须单独吞错：web 端对已存在目录会抛，混进同一个 try 会让 readdir 永远走不到
  try {
    await Filesystem.mkdir({ path: WORKS_DIR, directory: Directory.Data, recursive: true });
  } catch {
    /* 已存在 */
  }
  try {
    const result = await Filesystem.readdir({ path: WORKS_DIR, directory: Directory.Data });
    entries = (result.files ?? []) as Array<{ name: string; type?: string }>;
  } catch {
    return [];
  }

  const out: WorkInfo[] = [];
  for (const entry of entries) {
    const base = entry.name.includes('/') ? entry.name.split('/').pop()! : entry.name;
    if (entry.type === 'directory') {
      const files = await listWorkFiles(base);
      // 空目录不算作品：删除时目录可能没删干净（Android 上 deleteFile 删不掉目录），
      // 残留的空壳会显示成 0 B 卡片，还会占住名字把同名作品挤成 -2。
      if (files.length === 0) continue;
      const paths = files.map(f => f.path);
      const manifest = await readWorkManifest(base);
      // v4.2.1：清单声明的封面色必须真的在文件里（用户可能删了图），否则退到约定名
      const declared = manifest?.cover && paths.includes(manifest.cover) ? manifest.cover : null;
      const conventional = declared ? null : findConventionalCover(paths);
      out.push({
        name: base,
        entry: pickEntry(paths, manifest?.entry),
        isHtml: isHtmlPath(base) || paths.some(p => isHtmlPath(p)),
        size: files.reduce((sum, f) => sum + f.size, 0),
        mtime: files.reduce((max, f) => Math.max(max, f.mtime), 0),
        fileCount: files.length,
        cover: declared ?? conventional,
        coverSource: declared ? 'manifest' : (conventional ? 'file' : null),
      });
    } else {
      // 容错：works/ 下散落的旧式单文件，也包装成单文件作品展示
      out.push({
        name: base,
        entry: base,
        isHtml: isHtmlPath(base),
        size: typeof (entry as { size?: number }).size === 'number' ? (entry as { size?: number }).size! : 0,
        mtime: typeof (entry as { mtime?: number }).mtime === 'number' ? (entry as { mtime?: number }).mtime! : 0,
        fileCount: 1,
        cover: null,
        coverSource: null,
      });
    }
  }
  return out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name));
}

export async function workExists(rawName: string): Promise<boolean> {
  const list = await listWorks();
  const name = sanitizeWorkName(rawName);
  return list.some(item => item.name === name);
}

// ===== 读写 =====

/** 读文本（UTF-8；超长截断） */
export async function readWorkText(rawName: string, rel: string): Promise<WorkTextContent | null> {
  const name = sanitizeWorkName(rawName);
  const relPath = sanitizeRelPath(rel);
  const base64 = await readRaw(name, relPath);
  if (base64 === null) return null;
  const text = base64ToText(base64);
  const truncated = text.length > FILE_READ_MAX_CHARS;
  return {
    path: relPath,
    text: truncated ? text.slice(0, FILE_READ_MAX_CHARS) : text,
    truncated,
    size: text.length,
  };
}

/** 写文本（新建或覆盖）。覆盖前自动存版本快照 */
export async function writeWorkText(
  rawName: string,
  rel: string,
  content: string,
  opts: { reason?: 'save' | 'ai' | 'system' } = {},
): Promise<string> {
  const name = sanitizeWorkName(rawName);
  const relPath = sanitizeRelPath(rel);
  if (!relPath) throw new Error('路径不能为空');
  const existing = await readRaw(name, relPath);
  const nextB64 = textToBase64(content);
  if (existing !== null && existing !== nextB64) {
    try {
      await snapshotVersion(`${name}/${relPath}`, base64ToText(existing), opts.reason ?? 'save');
    } catch {
      // 快照失败不拦写入
    }
  }
  await writeRaw(name, relPath, nextB64);
  return `${name}/${relPath}`;
}

/** 读二进制（返回 base64 原样，图片用） */
export function readWorkBinary(rawName: string, rel: string): Promise<string | null> {
  return readRaw(sanitizeWorkName(rawName), sanitizeRelPath(rel));
}

/**
 * 按行读文本（v4.2.0）——大文件读全文会直接把上下文撑爆，
 * AI 又有 search_in_work 指到行号，按段读才是正常姿势。
 *
 * @param offset 起始行号（1-based）
 * @param limit  最多返回多少行（1~2000，默认 400）
 */
export async function readWorkTextRange(
  rawName: string,
  rel: string,
  offset = 1,
  limit = 400,
): Promise<{ path: string; text: string; offset: number; lines: number; totalLines: number; chars: number } | null> {
  const name = sanitizeWorkName(rawName);
  const relPath = sanitizeRelPath(rel);
  const base64 = await readRaw(name, relPath);
  if (base64 === null) return null;
  const all = base64ToText(base64);
  const rows = all.split('\n');
  const start = Math.max(1, Math.floor(offset));
  const count = Math.max(1, Math.min(2000, Math.floor(limit)));
  const sliced = rows.slice(start - 1, start - 1 + count);
  return {
    path: relPath,
    text: sliced.join('\n'),
    offset: start,
    lines: sliced.length,
    totalLines: rows.length,
    chars: all.length,
  };
}

/** 把一个作品里的文件原样复制到另一个作品（v4.2.0，copy_file 用，不经模型） */
export async function copyWorkFile(
  fromWork: string,
  fromPath: string,
  toWork: string,
  toPath: string,
): Promise<{ from: string; to: string; bytes: number } | null> {
  const src = await readRaw(sanitizeWorkName(fromWork), sanitizeRelPath(fromPath));
  if (src === null) return null;
  const saved = await writeWorkBinary(toWork, toPath, src);
  return { from: `${sanitizeWorkName(fromWork)}/${sanitizeRelPath(fromPath)}`, to: saved, bytes: Math.floor((src.length * 3) / 4) };
}

/** 写二进制（入参就是 base64，如图片字节） */
export function writeWorkBinary(rawName: string, rel: string, base64: string): Promise<string> {
  const name = sanitizeWorkName(rawName);
  const relPath = sanitizeRelPath(rel);
  if (!relPath) throw new Error('路径不能为空');
  return writeRaw(name, relPath, base64).then(() => `${name}/${relPath}`);
}

/** 删除作品内一个文件 */
export async function deleteWorkFile(rawName: string, rel: string): Promise<void> {
  const name = sanitizeWorkName(rawName);
  const relPath = sanitizeRelPath(rel);
  try {
    await Filesystem.deleteFile({ path: workPath(name, relPath), directory: Directory.Data });
  } catch {
    /* 已不存在就算了 */
  }
}

// ===== 作品生命周期 =====

/** 新建作品（默认建入口文件） */
export async function createWork(rawName: string, entryFile?: string, content = ''): Promise<string> {
  const name = sanitizeWorkName(rawName);
  await ensureWorkDir(name);
  const entry = sanitizeRelPath(entryFile || 'index.html');
  await writeWorkText(name, entry, content, { reason: 'system' });
  return name;
}

/** 重命名作品（逐文件搬，资产随名迁移） */
export async function renameWork(rawOld: string, rawNew: string): Promise<string> {
  const from = sanitizeWorkName(rawOld);
  const to = sanitizeWorkName(rawNew);
  if (from === to) return to;
  const files = await listWorkFiles(from);
  if (files.length === 0) throw new Error('作品不存在');
  for (const file of files) {
    const raw = await readRaw(from, file.path);
    if (raw !== null) await writeRaw(to, file.path, raw);
    await deleteWorkFile(from, file.path);
  }
  try {
    await migrateFileAssets(from, to);
  } catch {
    /* 资产迁移失败不拦改名 */
  }
  return to;
}

/** 复制一份作品：`demo.html` → `demo.html-副本`（重名自动加序号） */
export async function duplicateWork(rawName: string): Promise<string> {
  const name = sanitizeWorkName(rawName);
  const files = await listWorkFiles(name);
  if (files.length === 0) throw new Error('作品不存在');
  const existing = new Set((await listWorks()).map(item => item.name));
  let candidate = `${name}-副本`;
  let i = 2;
  while (existing.has(candidate)) {
    candidate = `${name}-副本${i}`;
    i += 1;
  }
  for (const file of files) {
    const raw = await readRaw(name, file.path);
    if (raw !== null) await writeRaw(candidate, file.path, raw);
  }
  return candidate;
}

/** 删除整个作品（连带封面/快照/置顶/应用数据） */
export async function deleteWork(rawName: string): Promise<void> {
  const name = sanitizeWorkName(rawName);
  const files = await listWorkFiles(name);
  for (const file of files) {
    await deleteWorkFile(name, file.path);
  }
  // 目录本身也要删：Capacitor 6 有 rmdir（recursive），Electron 适配层没有就退化成 deleteFile。
  // 删不掉时 listWorks 会跳过空目录，不至于再显示成 0 B 卡片。
  try {
    const fsAny = Filesystem as unknown as {
      rmdir?: (opts: { path: string; directory: Directory; recursive?: boolean }) => Promise<void>;
    };
    if (typeof fsAny.rmdir === 'function') {
      await fsAny.rmdir({ path: workPath(name), directory: Directory.Data, recursive: true });
    } else {
      await Filesystem.deleteFile({ path: workPath(name), directory: Directory.Data });
    }
  } catch {
    /* 删不掉就让空目录留着，列表会跳过 */
  }
  try {
    await purgeFileAssets(name);
  } catch {
    /* 资产清理失败不拦删除 */
  }
  // 映射和浏览记录必须一起清，否则重新导入同名包会认错升级目标、被挤成 -2
  try {
    forgetWorkIdByWork(name);
  } catch {
    /* ignore */
  }
  try {
    forgetWorkRecent(name);
  } catch {
    /* ignore */
  }
}

/** 重名自动加序号（导入用）：`demo.html` → `demo.html-2` */
export async function uniqueWorkName(rawName: string): Promise<string> {
  const name = sanitizeWorkName(rawName);
  const existing = new Set((await listWorks()).map(item => item.name));
  if (!existing.has(name)) return name;
  let i = 2;
  let candidate = `${name}-${i}`;
  while (existing.has(candidate)) {
    i += 1;
    candidate = `${name}-${i}`;
  }
  return candidate;
}

// ===== 平铺 files/ → works/ 迁移 =====

/**
 * 把 v3.6 时代的平铺 `files/` 迁进作品文件夹：
 * 每个文件 → `<原名>/index.<ext>`；版本快照键同步改写。只跑一次（localStorage 旗标）。
 */
export async function migrateLegacyFlatFiles(): Promise<number> {
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return 0;
  } catch {
    /* localStorage 不可用就不迁移 */
    return 0;
  }

  let entries: Array<{ name: string; type?: string }> = [];
  try {
    const result = await Filesystem.readdir({ path: LEGACY_DIR, directory: Directory.Data });
    entries = (result.files ?? []) as Array<{ name: string; type?: string }>;
  } catch {
    localStorage.setItem(MIGRATED_FLAG, '1');
    return 0;
  }

  let migrated = 0;
  for (const entry of entries) {
    const base = entry.name.includes('/') ? entry.name.split('/').pop()! : entry.name;
    if (entry.type === 'directory') continue;
    try {
      const { data } = await Filesystem.readFile({ path: `${LEGACY_DIR}/${base}`, directory: Directory.Data });
      const entryFile = entryNameFor(base);
      await writeRaw(base, entryFile, typeof data === 'string' ? data : '');
      await migrateVersionKeys(base, `${base}/${entryFile}`);
      await Filesystem.deleteFile({ path: `${LEGACY_DIR}/${base}`, directory: Directory.Data });
      migrated += 1;
    } catch {
      /* 单个失败不拦整体 */
    }
  }
  localStorage.setItem(MIGRATED_FLAG, '1');
  return migrated;
}

// ===== 展示工具 =====

/** 字节数 → 展示文案 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / 月-日 */
export function formatRelativeTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return '昨天';
  const date = new Date(ms);
  return `${date.getMonth() + 1}-${date.getDate()}`;
}
