/**
 * 图片附件服务
 *
 * 负责：
 * - 跨平台选图（Android 相册/拍照；Win/Electron/Web 文件选择器）
 * - 图片压缩（Canvas API，原图长边≤1920 质量90%，缩略图长边400 质量75%）
 * - 文件系统存储与读取（通过 filesystemAdapter，Electron/Android 自动适配）
 * - 删除附件文件
 *
 * 存储路径约定：
 *   attachments/<entryId>/<fileName>_orig.jpg
 *   attachments/<entryId>/<fileName>_thumb.jpg
 *
 * 文件名与 attachment.id 解耦（用时间戳+随机数生成），便于先存文件再写 DB。
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from './filesystemAdapter';
import { isElectron } from './electronAdapter';
import type { Attachment } from '@/types';

/** 选中的图片（未压缩的原始 base64，不含 data: 前缀） */
export interface SelectedImage {
  base64: string;
  mimeType: string;
}

/** 压缩参数 */
interface CompressOptions {
  maxSize: number;   // 长边最大像素
  quality: number;   // 0-1
}

const ORIG_COMPRESS: CompressOptions = { maxSize: 1920, quality: 0.9 };
const THUMB_COMPRESS: CompressOptions = { maxSize: 400, quality: 0.75 };

const ATTACHMENT_DIR = 'attachments';

// ==================== 选图 ====================

/**
 * 从相册选图（多选）
 * - Android：优先用 @capacitor/camera（动态 import，未装则回退到 input）
 * - Win/Electron/Web：用 <input type="file" multiple accept="image/*">
 *
 * 注意：Android 上 Camera.pickImages 与 input 回退只能二选一，
 * 不能先试 Camera 再“回退”到 input——因为 Camera 的取消会触发 resolve([])，
 * 之后又弹 input 会造成“跳出 2 次”。
 *
 * @param limit 最多选几张（仅 Android Camera 有效）
 */
export async function pickImages(limit = 9): Promise<SelectedImage[]> {
  // Android：用原生 Camera 插件，不再回退到 input
  if (!isElectron() && Capacitor.getPlatform() === 'android') {
    try {
      const { Camera } = await import('@capacitor/camera');
      const photo = await Camera.pickImages({
        quality: 90,
        limit,
      });
      const result: SelectedImage[] = [];
      for (const p of photo.photos ?? []) {
        const base64 = await readUriAsBase64(p.webPath || p.path || '');
        if (base64) {
          result.push(base64);
        }
      }
      return result;
    } catch (err) {
      // Camera 插件取消或失败，直接返回空，不再回退到 input（避免双重弹出）
      console.warn('[attachment] Camera.pickImages 失败或取消:', err);
      return [];
    }
  }
  // 其他平台：用 input
  return pickImagesViaInput(true);
}

/**
 * 拍照（仅 Android）
 * - Win/Electron 不支持拍照，返回 null
 */
export async function takePhoto(): Promise<SelectedImage | null> {
  if (isElectron() || Capacitor.getPlatform() !== 'android') {
    return null;
  }
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      saveToGallery: false,
    });
    if (!photo.base64String) return null;
    return {
      base64: photo.base64String,
      mimeType: photo.format ? `image/${photo.format}` : 'image/jpeg',
    };
  } catch (err) {
    console.warn('[attachment] takePhoto 失败:', err);
    return null;
  }
}

/** 用 <input type="file"> 选图 */
function pickImagesViaInput(multiple: boolean): Promise<SelectedImage[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (multiple) input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      try { document.body.removeChild(input); } catch {}
    };

    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : [];
      const result: SelectedImage[] = [];
      for (const file of files) {
        const base64 = await fileToBase64(file);
        result.push(base64);
      }
      cleanup();
      resolve(result);
    };

    // 用户取消：window focus 后检查，如果没选文件则清理
    // 加超时保底，避免永远不 resolve
    const cancelTimeout = setTimeout(() => {
      if (!resolved && (!input.files || input.files.length === 0)) {
        cleanup();
        resolve([]);
      }
    }, 10000);

    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!resolved && (!input.files || input.files.length === 0)) {
          clearTimeout(cancelTimeout);
          cleanup();
          resolve([]);
        }
      }, 300);
    }, { once: true });

    input.click();
  });
}

// ==================== 选择文件（v3.6.3）====================

/**
 * 选中的文本文件（内容只拼进消息正文，不落盘、不进附件表）。
 *
 * 为什么不落盘：Chat 历史本来就是 messages 整段 JSON，文本直接进正文
 * 可以跟着会话一起备份/导出，不需要第二套文件路径映射。
 */
export interface SelectedTextFile {
  /** 原始文件名（拼进消息里给模型看） */
  name: string;
  /** 原始字节数（展示用） */
  size: number;
  /** 文件内容（已按上限截断） */
  text: string;
  /** 是否因为超长被截断 */
  truncated: boolean;
}

/** 单文件读取上限（字符） */
export const CHAT_FILE_MAX_CHARS = 100_000;
/** 一次发送里所有文件合计上限（字符）——防止一口气把上下文撑爆 */
export const CHAT_FILES_TOTAL_MAX_CHARS = 300_000;
/** 超过这个字节数直接不读（绝大多数是二进制/日志，读了也是垃圾） */
const CHAT_FILE_MAX_BYTES = 5 * 1024 * 1024;

/** 允许按文本读取的扩展名（小写，不含点） */
const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'log', 'yaml', 'yml',
  'xml', 'html', 'htm', 'css', 'scss', 'less', 'ini', 'conf', 'toml', 'env',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'py', 'java', 'kt', 'kts', 'c',
  'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'sh', 'bat', 'ps1',
  'sql', 'gradle', 'properties', 'srt', 'vtt',
];

/** 文件名扩展名（小写，不含点；没有扩展名返回空串） */
function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

/** 是否是「按文本读」的文件（MIME 为 text/* 或扩展名白名单） */
export function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (file.type === 'application/json' || file.type === 'application/xml') return true;
  return TEXT_EXTENSIONS.includes(fileExtension(file.name));
}

/**
 * 弹出系统文件选择器（多选，不限类型）。
 *
 * 只负责拿 File 对象 —— 图片/文本分流由调用方做（ChatPage），
 * 这样这里不用关心 UI 语义。
 */
export function pickChatFiles(): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);

    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      try { document.body.removeChild(input); } catch { /* ignore */ }
    };

    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      resolve(files);
    };

    // 取消兜底（同 pickImagesViaInput：桌面端取消不一定触发 change）
    const cancelTimeout = setTimeout(() => {
      if (!resolved && (!input.files || input.files.length === 0)) {
        cleanup();
        resolve([]);
      }
    }, 10000);

    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!resolved && (!input.files || input.files.length === 0)) {
          clearTimeout(cancelTimeout);
          cleanup();
          resolve([]);
        }
      }, 300);
    }, { once: true });

    input.click();
  });
}

/** 解码：先按 UTF-8 严格解，失败退 GBK（国内 txt 很常见），都不行返回 null */
function decodeTextBuffer(buffer: ArrayBuffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch {
      return null;
    }
  }
}

/** 二进制嗅探：前 8KB 里出现 NUL 基本可以判定不是文本 */
function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/**
 * 把 File 读成文本（带上限与编码兜底）。
 *
 * @returns null 表示不是可读文本（二进制/超大/解码失败）
 */
export async function readTextFile(
  file: File,
  maxChars: number = CHAT_FILE_MAX_CHARS,
): Promise<SelectedTextFile | null> {
  if (file.size <= 0 || file.size > CHAT_FILE_MAX_BYTES) return null;
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (looksBinary(bytes)) return null;
    const decoded = decodeTextBuffer(buffer);
    if (decoded === null) return null;
    const text = decoded.trim();
    if (text.length === 0) return null;
    const truncated = text.length > maxChars;
    return {
      name: file.name,
      size: file.size,
      text: truncated ? text.slice(0, maxChars) : text,
      truncated,
    };
  } catch {
    return null;
  }
}

/** File 转 base64 */
function fileToBase64(file: File): Promise<SelectedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(',');
      const base64 = dataUrl.substring(comma + 1);
      const mimeType = file.type || 'image/jpeg';
      resolve({ base64, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 把 URI（webPath/path）读取为 base64 */
async function readUriAsBase64(uri: string): Promise<SelectedImage | null> {
  if (!uri) return null;
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    const base64 = await blobToBase64(blob);
    return { base64, mimeType: blob.type || 'image/jpeg' };
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.substring(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ==================== 压缩 ====================

/**
 * 用 Canvas 压缩图片
 * - 输出统一为 image/jpeg（减小体积，PNG 透明会丢失但附件场景可接受）
 */
async function compressImage(
  image: SelectedImage,
  options: CompressOptions
): Promise<SelectedImage> {
  const dataUrl = `data:${image.mimeType};base64,${image.base64}`;
  const img = await loadImage(dataUrl);

  const ratio = Math.min(1, options.maxSize / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Canvas 不可用，返回原图
    return image;
  }
  ctx.drawImage(img, 0, 0, w, h);
  const outMime = 'image/jpeg';
  const outDataUrl = canvas.toDataURL(outMime, options.quality);
  return {
    base64: outDataUrl.substring(outDataUrl.indexOf(',') + 1),
    mimeType: outMime,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ==================== 存储 ====================

/** 生成文件名（不含扩展名，与 attachment.id 解耦） */
function genFileName(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 保存图片为某条目的附件（压缩+存盘）
 * @returns 附件记录（不含 id，由 DB 层生成）
 */
export async function saveImageForEntry(
  entryId: string,
  image: SelectedImage
): Promise<Omit<Attachment, 'id'>> {
  const fileName = genFileName();
  const dir = `${ATTACHMENT_DIR}/${entryId}`;
  const origPath = `${dir}/${fileName}_orig.jpg`;
  const thumbPath = `${dir}/${fileName}_thumb.jpg`;

  // 并行压缩
  const [orig, thumb] = await Promise.all([
    compressImage(image, ORIG_COMPRESS),
    compressImage(image, THUMB_COMPRESS),
  ]);

  // 写文件（recursive 自动建目录）
  await Filesystem.writeFile({
    path: origPath,
    data: orig.base64,
    directory: Directory.Data,
    recursive: true,
  });
  await Filesystem.writeFile({
    path: thumbPath,
    data: thumb.base64,
    directory: Directory.Data,
    recursive: true,
  });

  return {
    entryId,
    filePath: origPath,
    thumbPath,
    mimeType: orig.mimeType,
    sortOrder: 0,
    createdAt: Date.now(),
  };
}

/**
 * 读取图片为 data URL（可直接放 <img src=...>）
 */
export async function readImageAsSrc(path: string): Promise<string> {
  try {
    const { data } = await Filesystem.readFile({
      path,
      directory: Directory.Data,
    });
    return `data:image/jpeg;base64,${data}`;
  } catch (err) {
    console.warn('[attachment] readImageAsSrc failed:', path, err);
    return '';
  }
}

/**
 * 读取缩略图为 data URL
 */
export async function readThumbAsSrc(path: string): Promise<string> {
  return readImageAsSrc(path);
}

// ==================== 删除 ====================

/**
 * 删除单张附件文件（原图+缩略图）
 */
export async function deleteAttachmentFiles(att: Attachment): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (att.filePath) {
    tasks.push(
      Filesystem.deleteFile({ path: att.filePath, directory: Directory.Data })
        .catch(() => {})
    );
  }
  if (att.thumbPath) {
    tasks.push(
      Filesystem.deleteFile({ path: att.thumbPath, directory: Directory.Data })
        .catch(() => {})
    );
  }
  await Promise.all(tasks);
}

/* ============================================================
 *  聊天图片（v3.5.3）
 *
 *  与条目附件完全独立的一套存储：
 *    chat-images/<sessionId>/<fileName>_orig.jpg   （长边≤1600，给「看大图」用）
 *    chat-images/<sessionId>/<fileName>_thumb.jpg  （长边≤400，消息里显示）
 *
 *  为什么不复用条目附件表：聊天图片属于「对话」而非「记忆库卡片」，
 *  没有 entryId 可言，且删会话时要整目录清理。消息 JSON 里只存两个路径，
 *  不存 base64 —— 否则 chat_sessions.messages 会随图片爆炸。
 * ============================================================ */

const CHAT_IMAGE_DIR = 'chat-images';
/** 聊天原图压缩：比条目附件略小（1600 足够看细节，省磁盘） */
const CHAT_ORIG_COMPRESS: CompressOptions = { maxSize: 1600, quality: 0.85 };
/** 发给模型的中图：长边 1024（DeepSeek 单图折算 ≤384 tokens，尺寸再大也无收益） */
const MODEL_IMAGE_COMPRESS: CompressOptions = { maxSize: 1024, quality: 0.82 };
/** base64 字符数上限（≈ 480KB 二进制）；未超限的原图直接发，省一次重编码 */
const MODEL_BASE64_LIMIT = 650_000;

/** 已落盘的聊天图片引用（写进 ChatMessage.images） */
export interface ChatImageRef {
  path: string;
  thumbPath: string;
  mimeType: string;
}

/**
 * 保存一张聊天图片（原图 + 缩略图，双份落盘）
 */
export async function saveChatImage(
  sessionId: string,
  image: SelectedImage
): Promise<ChatImageRef> {
  const fileName = genFileName();
  const dir = `${CHAT_IMAGE_DIR}/${sessionId}`;
  const origPath = `${dir}/${fileName}_orig.jpg`;
  const thumbPath = `${dir}/${fileName}_thumb.jpg`;

  const [orig, thumb] = await Promise.all([
    compressImage(image, CHAT_ORIG_COMPRESS),
    compressImage(image, THUMB_COMPRESS),
  ]);

  await Filesystem.writeFile({
    path: origPath,
    data: orig.base64,
    directory: Directory.Data,
    recursive: true,
  });
  await Filesystem.writeFile({
    path: thumbPath,
    data: thumb.base64,
    directory: Directory.Data,
    recursive: true,
  });

  return { path: origPath, thumbPath, mimeType: orig.mimeType };
}

/**
 * 读取聊天原图并转成「可直接喂给模型」的 base64。
 * 原图已足够小（≤约 480KB）时原样返回，否则压到长边 1024 再返回。
 * @returns null 表示文件缺失/读取失败（调用方降级为纯文本）
 */
export async function readChatImageForModel(path: string): Promise<SelectedImage | null> {
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
    const base64 = typeof data === 'string' ? data : '';
    if (!base64) return null;
    if (base64.length <= MODEL_BASE64_LIMIT) {
      return { base64, mimeType: 'image/jpeg' };
    }
    return await compressImage(
      { base64, mimeType: 'image/jpeg' },
      MODEL_IMAGE_COMPRESS
    );
  } catch (err) {
    console.warn('[attachment] readChatImageForModel failed:', path, err);
    return null;
  }
}

/**
 * 删除某会话的全部聊天图片（删除会话时级联清理）。
 * Filesystem 没有 rmdir，只能 readdir + 逐个删；空目录留着不影响功能。
 */
export async function deleteChatImageDir(sessionId: string): Promise<void> {
  const dir = `${CHAT_IMAGE_DIR}/${sessionId}`;
  try {
    const result = await Filesystem.readdir({ path: dir, directory: Directory.Data });
    const files = Array.isArray(result?.files) ? result.files : [];
    await Promise.all(
      files.map(async f => {
        const name = f?.name;
        if (!name) return;
        try {
          await Filesystem.deleteFile({ path: `${dir}/${name}`, directory: Directory.Data });
        } catch {
          /* 单文件删除失败不阻塞其余 */
        }
      })
    );
  } catch {
    /* 目录不存在（从未发过图）或读取失败，忽略 */
  }
}

/**
 * 删除某条目所有附件文件（级联删除，删完整条 entry 时调用）
 */
export async function deleteEntryAttachmentFiles(attachments: Attachment[]): Promise<void> {
  if (attachments.length === 0) return;
  await Promise.all(attachments.map(a => deleteAttachmentFiles(a)));

  // 尝试删除空目录（entryId 目录）
  const entryId = attachments[0].entryId;
  const dir = `${ATTACHMENT_DIR}/${entryId}`;
  try {
    const result = await Filesystem.readdir({ path: dir, directory: Directory.Data });
    if (!result.files || result.files.length === 0) {
      // Filesystem 没有 rmdir API，空目录留着不影响功能
      // Android/Electron 都会忽略空目录
    }
  } catch {
    // 目录不存在或读取失败，忽略
  }
}
