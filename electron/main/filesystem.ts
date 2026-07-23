/**
 * Electron 文件系统桥接
 *
 * 替代 @capacitor/filesystem，提供兼容的 API
 * - Directory.Documents -> app.getPath('documents')
 * - Directory.External  -> app.getPath('downloads')（导出用）
 * - 数据以 base64 字符串传输，与 Capacitor 兼容
 */
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';

/** 兼容 Capacitor 的 Directory 枚举 */
type Directory = 'DOCUMENTS' | 'EXTERNAL' | 'DATA';

/** 将 Capacitor Directory 映射到实际路径 */
function resolveBasePath(directory: Directory): string {
  switch (directory) {
    case 'DOCUMENTS':
      // 私有备份目录：userData/documents（对应移动端的 Documents）
      return path.join(app.getPath('userData'), 'documents');
    case 'EXTERNAL':
      // 公共导出目录：下载文件夹（对应移动端的 Download）
      return app.getPath('downloads');
    case 'DATA':
      return app.getPath('userData');
    default:
      return app.getPath('userData');
  }
}

/** 解析完整路径 */
function resolveFullPath(relativePath: string, directory: Directory): string {
  const base = resolveBasePath(directory);
  // 规范化路径，防止越权访问
  const full = path.resolve(base, relativePath);
  if (!full.startsWith(base)) {
    throw new Error('Path traversal detected');
  }
  return full;
}

/** 创建目录（递归） */
export async function mkdir(relativePath: string, directory: Directory, recursive = false): Promise<void> {
  const fullPath = resolveFullPath(relativePath, directory);
  await fsp.mkdir(fullPath, { recursive });
}

/** 读取目录内容 */
export async function readdir(relativePath: string, directory: Directory): Promise<{ files: { name: string; type: 'file' | 'directory'; size: number }[] }> {
  const fullPath = resolveFullPath(relativePath, directory);
  const entries = await fsp.readdir(fullPath, { withFileTypes: true });
  const files: { name: string; type: 'file' | 'directory'; size: number }[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      const stat = await fsp.stat(path.join(fullPath, entry.name));
      files.push({ name: entry.name, type: 'file', size: stat.size });
    } else if (entry.isDirectory()) {
      files.push({ name: entry.name, type: 'directory', size: 0 });
    }
  }
  return { files };
}

/** 删除文件 */
export async function deleteFile(relativePath: string, directory: Directory): Promise<void> {
  const fullPath = resolveFullPath(relativePath, directory);
  await fsp.unlink(fullPath);
}

/** 写入文件（base64 编码） */
export async function writeFile(relativePath: string, data: string, directory: Directory, recursive = false): Promise<void> {
  const fullPath = resolveFullPath(relativePath, directory);
  if (recursive) {
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  }
  // data 是 base64 编码的字符串
  const buffer = Buffer.from(data, 'base64');
  await fsp.writeFile(fullPath, buffer);
}

/** 读取文件（返回 base64 编码） */
export async function readFile(relativePath: string, directory: Directory): Promise<{ data: string }> {
  const fullPath = resolveFullPath(relativePath, directory);
  const buffer = await fsp.readFile(fullPath);
  return { data: buffer.toString('base64') };
}

/** 检查文件是否存在 */
export async function fileExists(relativePath: string, directory: Directory): Promise<boolean> {
  try {
    const fullPath = resolveFullPath(relativePath, directory);
    await fsp.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

/** 获取文件完整路径（用于调试） */
export function getFullPath(relativePath: string, directory: Directory): string {
  return resolveFullPath(relativePath, directory);
}
