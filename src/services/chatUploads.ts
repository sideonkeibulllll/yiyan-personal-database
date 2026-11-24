/**
 * 聊天上传文件的本地缓存（v4.2.0）
 *
 * 背景：v3.6.x 上传的文件只被抽成文本拼进消息（`【文件：…】`），原始字节读完即弃。
 * 于是「把刚上传的这个 html 放进作品」对 AI 来说只剩一条路——把内容重新输出一遍。
 * 大文件重打必失真，而且纯烧 token。
 *
 * 这里给上传留一份「原样副本」：
 *   Data/chat-files/<sessionId>/<时间戳36>-<安全文件名>
 *
 * 三条规则：
 * - **按会话隔离**：AI 只能看到本次对话的上传（copy_file / read_upload 会校验前缀），
 *   避免把别的会话里的私密文件名泄漏进上下文。
 * - **60 天过期**：只清理上传缓存，不碰作品与聊天记录；按 mtime 判断。
 * - **总量 300MB**：超了从最旧的开始删（LRU by mtime）。
 *
 * 缓存是「临时副本」：一旦 copy_file 进作品，作品里那份就是独立文件，
 * 缓存过期也不影响。
 */
import { Filesystem, Directory } from './filesystemAdapter';

export const UPLOAD_DIR = 'chat-files';
/** 缓存保留天数 */
export const UPLOAD_TTL_DAYS = 60;
/** 缓存总量上限（300MB） */
export const UPLOAD_TOTAL_MAX_BYTES = 300 * 1024 * 1024;
/** 单个上传文件的落盘上限（与聊天文档读取上限一致） */
export const UPLOAD_MAX_FILE_BYTES = 15 * 1024 * 1024;
/** 清理一天只跑一次 */
const CLEANUP_FLAG = 'yiyan_chat_uploads_cleaned_v1';

export interface ChatUploadRef {
  /** Data 目录内的相对路径（`chat-files/<sessionId>/xxx`） */
  path: string;
  /** 原始文件名 */
  name: string;
  /** 字节数 */
  size: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 会话 id 只留安全字符（它来自 createId，正常就是字母数字下划线） */
function safeSessionId(raw: string): string {
  const cleaned = (raw || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'unknown';
}

/** 文件名清洗：去路径分隔符与不可见字符，保留原名便于人/AI 识别 */
export function sanitizeUploadName(raw: string): string {
  const base = (raw || '').replace(/[\\/]/g, '-').replace(/[\u0000-\u001f]/g, '').trim();
  return (base.length > 0 ? base : 'file').slice(0, 120);
}

/** 是否是合法的上传缓存路径（copy_file / read_upload 的源必须过这一关） */
export function isUploadPath(path: string): boolean {
  const normalized = (path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith(`${UPLOAD_DIR}/`)) return false;
  const parts = normalized.split('/');
  return parts.length >= 3 && parts.every(p => p.length > 0 && p !== '.' && p !== '..');
}

/** 把字节存成上传缓存，返回可被工具引用的路径 */
export async function saveChatUploadBytes(
  sessionId: string,
  name: string,
  bytes: Uint8Array,
): Promise<ChatUploadRef> {
  const sid = safeSessionId(sessionId);
  const safeName = sanitizeUploadName(name);
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  const path = `${UPLOAD_DIR}/${sid}/${stamp}${rand}-${safeName}`;
  await Filesystem.writeFile({
    path,
    data: bytesToBase64(bytes),
    directory: Directory.Data,
    recursive: true,
  });
  return { path, name: safeName, size: bytes.length };
}

/**
 * 把一个 File 落地成上传缓存。
 * @returns null 表示太大/读失败（调用方退化成「只有文本」的老行为，不阻塞发送）
 */
export async function saveChatUpload(sessionId: string, file: File): Promise<ChatUploadRef | null> {
  if (!file || file.size <= 0 || file.size > UPLOAD_MAX_FILE_BYTES) return null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await saveChatUploadBytes(sessionId, file.name, bytes);
  } catch (err) {
    console.warn('[chatUploads] save failed:', file.name, err);
    return null;
  }
}

/**
 * 从已有文件（Data 目录内的相对路径）复制一份进上传缓存。
 * 聊天图片走这条路：图片原本在 chat-images/<会话>/，会话一删就没了；
 * 复制进 chat-files 后，即使会话删了也能继续 copy_file 进作品。
 */
export async function copyIntoUploads(
  sessionId: string,
  srcPath: string,
  name: string,
): Promise<ChatUploadRef | null> {
  try {
    const { data } = await Filesystem.readFile({ path: srcPath, directory: Directory.Data });
    if (typeof data !== 'string' || !data) return null;
    const bytes = base64ToBytes(data);
    if (bytes.length === 0 || bytes.length > UPLOAD_MAX_FILE_BYTES) return null;
    return await saveChatUploadBytes(sessionId, name, bytes);
  } catch {
    return null;
  }
}

/** 读上传缓存的 base64（copy_file 用，全程不进模型上下文） */
export async function readUploadBase64(path: string): Promise<string | null> {
  if (!isUploadPath(path)) return null;
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
    return typeof data === 'string' && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

export interface UploadTextSlice {
  path: string;
  text: string;
  /** 起始行号（1-based） */
  offset: number;
  /** 本次返回了多少行 */
  lines: number;
  /** 文件总行数 */
  totalLines: number;
  truncated: boolean;
}

/**
 * 按行读上传缓存的文本（read_upload 用）。
 * 超过 20 万字符也会先截断——上传的可能是日志，没必要整本灌进上下文。
 */
export async function readUploadText(
  path: string,
  offset = 1,
  limit = 400,
): Promise<UploadTextSlice | null> {
  const base64 = await readUploadBase64(path);
  if (!base64) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8').decode(base64ToBytes(base64));
  } catch {
    return null;
  }
  const all = text.split('\n');
  const totalChars = text.length;
  const start = Math.max(1, Math.floor(offset));
  const count = Math.max(1, Math.min(2000, Math.floor(limit)));
  const sliced = all.slice(start - 1, start - 1 + count);
  const truncated = totalChars > 200_000;
  return {
    path,
    text: sliced.join('\n'),
    offset: start,
    lines: sliced.length,
    totalLines: all.length,
    truncated,
  };
}

interface UploadEntry {
  path: string;
  mtime: number;
  size: number;
}

/** 列出上传缓存（不传 sessionId 就是全部会话，仅供内部清理统计用） */
async function listEntries(sessionId?: string): Promise<UploadEntry[]> {
  const out: UploadEntry[] = [];
  const root = sessionId ? `${UPLOAD_DIR}/${safeSessionId(sessionId)}` : UPLOAD_DIR;

  const walk = async (dir: string): Promise<void> => {
    let files: Array<{ name: string; type?: string; size?: number; mtime?: number }> = [];
    try {
      const result = await Filesystem.readdir({ path: dir, directory: Directory.Data });
      files = (result.files ?? []) as Array<{ name: string; type?: string; size?: number; mtime?: number }>;
    } catch {
      return;
    }
    for (const item of files) {
      const base = item.name.includes('/') ? item.name.split('/').pop()! : item.name;
      const full = `${dir}/${base}`;
      if (item.type === 'directory') {
        await walk(full);
      } else {
        out.push({
          path: full,
          mtime: typeof item.mtime === 'number' ? item.mtime : 0,
          size: typeof item.size === 'number' ? item.size : 0,
        });
      }
    }
  };

  await walk(root);
  return out;
}

/** 某会话的上传文件清单（最新在前） */
export async function listChatUploads(sessionId: string): Promise<ChatUploadRef[]> {
  const entries = await listEntries(sessionId);
  return entries
    .sort((a, b) => b.mtime - a.mtime)
    .map(entry => {
      const name = entry.path.split('/').pop() || entry.path;
      // 去掉 `<时间戳36><随机4位>-` 前缀，还原成用户看到的文件名
      const cleaned = name.replace(/^[a-z0-9]{6,14}-/, '');
      return { path: entry.path, name: cleaned || name, size: entry.size };
    });
}

/**
 * 清理过期上传缓存：先删 60 天前的，再按总量 300MB 从最旧的删。
 * 一天只跑一次（启动时调用即可）。返回删除的文件数。
 */
export async function cleanupChatUploads(force = false): Promise<number> {
  const today = new Date();
  const dayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  if (!force) {
    try {
      if (localStorage.getItem(CLEANUP_FLAG) === dayKey) return 0;
    } catch {
      /* localStorage 不可用时照常清理 */
    }
  }

  let deleted = 0;
  try {
    const entries = await listEntries();
    const now = Date.now();
    const ttl = UPLOAD_TTL_DAYS * 86_400_000;
    const kept: UploadEntry[] = [];

    for (const entry of entries) {
      if (!entry.mtime || now - entry.mtime > ttl) {
        try {
          await Filesystem.deleteFile({ path: entry.path, directory: Directory.Data });
          deleted += 1;
        } catch {
          /* 单个失败不拦整体 */
        }
      } else {
        kept.push(entry);
      }
    }

    // 总量兜底：最旧的先删
    let total = kept.reduce((sum, entry) => sum + entry.size, 0);
    if (total > UPLOAD_TOTAL_MAX_BYTES) {
      kept.sort((a, b) => a.mtime - b.mtime);
      for (const entry of kept) {
        if (total <= UPLOAD_TOTAL_MAX_BYTES * 0.9) break;
        try {
          await Filesystem.deleteFile({ path: entry.path, directory: Directory.Data });
          total -= entry.size;
          deleted += 1;
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    console.warn('[chatUploads] cleanup failed:', err);
  }

  try {
    localStorage.setItem(CLEANUP_FLAG, dayKey);
  } catch {
    /* ignore */
  }
  return deleted;
}
