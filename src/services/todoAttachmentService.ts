/**
 * 待办图片附件服务
 * c: 待办编辑页支持图片附件
 * 
 * 存储路径约定：
 *   todo_attachments/<todoId>/<fileName>_orig.jpg
 *   todo_attachments/<todoId>/<fileName>_thumb.jpg
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from './filesystemAdapter';
import { isElectron } from './electronAdapter';
import type { TodoAttachment, Attachment } from '@/types';

/** 选中的图片（未压缩的原始 base64，不含 data: 前缀） */
export interface SelectedImage {
  base64: string;
  mimeType: string;
}

/** 压缩参数 */
interface CompressOptions {
  maxSize: number;
  quality: number;
}

const ORIG_COMPRESS: CompressOptions = { maxSize: 1920, quality: 0.9 };
const THUMB_COMPRESS: CompressOptions = { maxSize: 400, quality: 0.75 };

const ATTACHMENT_DIR = 'todo_attachments';

// ==================== 选图 ====================

export async function pickImages(limit = 9): Promise<SelectedImage[]> {
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
      console.warn('[todoAttachment] Camera.pickImages 失败或取消:', err);
      return [];
    }
  }
  return pickImagesViaInput(true);
}

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
  if (!ctx) return image;
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

function genFileName(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * 保存图片为待办附件
 */
export async function saveImageForTodo(
  todoId: string,
  image: SelectedImage
): Promise<Omit<TodoAttachment, 'id'>> {
  const fileName = genFileName();
  const dir = `${ATTACHMENT_DIR}/${todoId}`;
  const origPath = `${dir}/${fileName}_orig.jpg`;
  const thumbPath = `${dir}/${fileName}_thumb.jpg`;

  const [orig, thumb] = await Promise.all([
    compressImage(image, ORIG_COMPRESS),
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

  return {
    todoId,
    filePath: origPath,
    thumbPath,
    mimeType: orig.mimeType,
    sortOrder: 0,
    createdAt: Date.now(),
  };
}

/**
 * 读取缩略图
 */
export async function readTodoThumbAsSrc(path: string): Promise<string> {
  try {
    const { data } = await Filesystem.readFile({
      path,
      directory: Directory.Data,
    });
    return `data:image/jpeg;base64,${data}`;
  } catch (err) {
    console.warn('[todoAttachment] readThumbAsSrc failed:', path, err);
    return '';
  }
}

// ==================== 删除 ====================

/**
 * 删除单个待办附件文件
 */
export async function deleteTodoAttachmentFiles(att: TodoAttachment): Promise<void> {
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
 * 删除待办所有附件文件
 * c: 待办删除时图片附件不保留
 */
export async function deleteAllTodoAttachments(attachments: TodoAttachment[]): Promise<void> {
  if (attachments.length === 0) return;
  await Promise.all(attachments.map(a => deleteTodoAttachmentFiles(a)));
}
