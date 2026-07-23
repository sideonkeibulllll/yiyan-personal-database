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
 * @param limit 最多选几张（仅 Android Camera 有效）
 */
export async function pickImages(limit = 9): Promise<SelectedImage[]> {
  // Android 优先用原生 Camera 插件
  if (!isElectron() && Capacitor.getPlatform() === 'android') {
    try {
      const { Camera } = await import('@capacitor/camera');
      const photo = await Camera.pickImages({
        quality: 90,
        limit,
      });
      const result: SelectedImage[] = [];
      for (const p of photo.photos ?? []) {
        // Capacitor 返回的 webPath/dataUrl/路径，需要读取为 base64
        const base64 = await readUriAsBase64(p.webPath || p.path || '');
        if (base64) {
          result.push(base64);
        }
      }
      if (result.length > 0) return result;
      // 没选到图，回退
    } catch (err) {
      console.warn('[attachment] Camera.pickImages 失败，回退到 input:', err);
    }
  }
  // 其他平台或回退：用 input
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

    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : [];
      const result: SelectedImage[] = [];
      for (const file of files) {
        const base64 = await fileToBase64(file);
        result.push(base64);
      }
      document.body.removeChild(input);
      resolve(result);
    };

    // 用户取消：change 不触发，这里靠 focus 回检测
    // 简化处理：直接 click，5 秒内无响应视为取消（避免 input 阻塞）
    input.onclick = () => {
      // 监听窗口重新聚焦，如果没选文件则清理
      window.addEventListener('focus', () => {
        setTimeout(() => {
          if (!input.files || input.files.length === 0) {
            try { document.body.removeChild(input); } catch {}
            resolve([]);
          }
        }, 500);
      }, { once: true });
    };

    input.click();
  });
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
