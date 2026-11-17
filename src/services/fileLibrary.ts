/**
 * 文件库（v3.6.4）
 *
 * 一个务实的本地文件柜：AI 可以通过 MCP 工具读写，用户可以在「文件」页浏览、
 * 全屏查看 html、手动编辑。存 Capacitor Filesystem 的 Data 目录（`files/`），
 * 不落数据库 —— 文件本身就是文件，别把 html 塞进 SQLite。
 *
 * 设计边界：
 * - 只允许平铺在 `files/` 下，文件名不接受路径分隔符（防越界写）。
 * - 文件名就是身份：写入同名文件 = 覆盖（AI 迭代 html 的常态）。
 * - 删除走危险确认；写入不需要确认（主人明确要求）。
 */
import { Filesystem, Directory } from './filesystemAdapter';

const FILES_DIR = 'files';

/** 单文件读取上限（超出截断，防止把整本小说灌进上下文） */
export const FILE_READ_MAX_CHARS = 200_000;

export interface LibraryFile {
  name: string;
  /** 字节数 */
  size: number;
  /** 修改时间（毫秒；有的平台不返回，缺省 0） */
  mtime: number;
}

export interface LibraryFileContent {
  name: string;
  text: string;
  /** 是否因超长被截断 */
  truncated: boolean;
  size: number;
}

/** 文件名清洗：去掉路径分隔符与首尾空白；空白名回落 untitled */
export function sanitizeFileName(raw: string): string {
  const base = (raw || '').replace(/[\\/]/g, '-').replace(/[\u0000-\u001f]/g, '').trim();
  return base.length > 0 ? base.slice(0, 120) : 'untitled.txt';
}

/** 按扩展名判断是不是 html（决定查看器用 iframe 还是纯文本） */
export function isHtmlFile(name: string): boolean {
  return /\.html?$/i.test(name);
}

export function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

/**
 * Capacitor Filesystem 的 writeFile/readFile 一律走 base64（原生与 Electron 适配器都如此），
 * 文本要在这里自己编解码 —— 直接把 UTF-8 文本丢进去会报「not valid base64」。
 */
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

function fileNameOnly(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

async function ensureDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: FILES_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // 已存在会抛错，忽略
  }
}

/** 列出全部文件（按修改时间倒序，新改的排前面） */
export async function listLibraryFiles(): Promise<LibraryFile[]> {
  try {
    await ensureDir();
    const result = await Filesystem.readdir({ path: FILES_DIR, directory: Directory.Data });
    return (result.files ?? [])
      .filter(entry => entry.type !== 'directory')
      .map(entry => ({
        name: fileNameOnly(entry.name),
        size: typeof entry.size === 'number' ? entry.size : 0,
        mtime: typeof (entry as { mtime?: number }).mtime === 'number' ? (entry as { mtime?: number }).mtime! : 0,
      }))
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** 读取一个文件（UTF-8；超长截断） */
export async function readLibraryFile(rawName: string): Promise<LibraryFileContent | null> {
  const name = sanitizeFileName(rawName);
  try {
    const { data } = await Filesystem.readFile({ path: `${FILES_DIR}/${name}`, directory: Directory.Data });
    const text = typeof data === 'string' ? base64ToText(data) : '';
    const truncated = text.length > FILE_READ_MAX_CHARS;
    return {
      name,
      text: truncated ? text.slice(0, FILE_READ_MAX_CHARS) : text,
      truncated,
      size: text.length, // readdir 的 size 是字节，这里给字符数（UI 用字数更有意义）
    };
  } catch {
    return null;
  }
}

/** 写入（新建或覆盖）一个文件 */
export async function writeLibraryFile(rawName: string, content: string): Promise<string> {
  const name = sanitizeFileName(rawName);
  await ensureDir();
  await Filesystem.writeFile({
    path: `${FILES_DIR}/${name}`,
    data: textToBase64(content),
    directory: Directory.Data,
    recursive: true,
  });
  return name;
}

/** 删除一个文件 */
export async function deleteLibraryFile(rawName: string): Promise<void> {
  const name = sanitizeFileName(rawName);
  await Filesystem.deleteFile({ path: `${FILES_DIR}/${name}`, directory: Directory.Data });
}

/** 文件是否存在（AI 写之前判断「新建还是覆盖」时用） */
export async function libraryFileExists(rawName: string): Promise<boolean> {
  const list = await listLibraryFiles();
  const name = sanitizeFileName(rawName);
  return list.some(item => item.name === name);
}

/** 字节数 → 展示文案 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 重命名（Filesystem 没有 rename：读→写新名→删旧） */
export async function renameLibraryFile(rawOld: string, rawNew: string): Promise<string> {
  const from = sanitizeFileName(rawOld);
  const to = sanitizeFileName(rawNew);
  if (from === to) return to;
  const file = await readLibraryFile(from);
  if (!file) throw new Error('文件不存在');
  await writeLibraryFile(to, file.text);
  await deleteLibraryFile(from);
  return to;
}

/** 复制一份：`demo.html` → `demo-副本.html`（重名自动加序号） */
export async function duplicateLibraryFile(rawName: string): Promise<string> {
  const name = sanitizeFileName(rawName);
  const file = await readLibraryFile(name);
  if (!file) throw new Error('文件不存在');
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const existing = new Set((await listLibraryFiles()).map(item => item.name));
  let candidate = `${base}-副本${ext}`;
  let i = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-副本${i}${ext}`;
    i += 1;
  }
  await writeLibraryFile(candidate, file.text);
  return candidate;
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
