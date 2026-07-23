/**
 * Filesystem 适配器
 *
 * 在 Electron 环境下，将 @capacitor/filesystem 的调用转发到 IPC
 * 在非 Electron 环境下，直接使用 @capacitor/filesystem
 *
 * 提供与 @capacitor/filesystem 兼容的 Filesystem 和 Directory 接口
 */
import { isElectron } from './electronAdapter';

// 复用 Capacitor 的 Directory 枚举值和类型
import { Filesystem as CapFilesystem, Directory as CapDirectory } from '@capacitor/filesystem';

/** Directory 枚举（兼容 Capacitor） */
export const Directory = CapDirectory;
/** Directory 类型别名（兼容 Capacitor） */
export type Directory = CapDirectory;

/**
 * Electron 环境下的 Filesystem 适配器
 * 将 Capacitor Filesystem API 转发到 IPC
 */
const electronFilesystem = {
  async mkdir(options: { path: string; directory: any; recursive?: boolean }): Promise<void> {
    const dirStr = options.directory === CapDirectory.Documents ? 'DOCUMENTS'
      : options.directory === CapDirectory.External ? 'EXTERNAL'
      : 'DATA';
    await (window as any).electronAPI.fs.mkdir(options.path, dirStr, options.recursive ?? false);
  },

  async readdir(options: { path: string; directory: any }): Promise<{ files: { name: string; type: string; size: number; uri?: string }[] }> {
    const dirStr = options.directory === CapDirectory.Documents ? 'DOCUMENTS'
      : options.directory === CapDirectory.External ? 'EXTERNAL'
      : 'DATA';
    const result = await (window as any).electronAPI.fs.readdir(options.path, dirStr);
    return {
      files: result.files.map((f: any) => ({
        name: f.name,
        type: f.type,
        size: f.size,
        uri: '',
      })),
    };
  },

  async deleteFile(options: { path: string; directory: any }): Promise<void> {
    const dirStr = options.directory === CapDirectory.Documents ? 'DOCUMENTS'
      : options.directory === CapDirectory.External ? 'EXTERNAL'
      : 'DATA';
    await (window as any).electronAPI.fs.deleteFile(options.path, dirStr);
  },

  async writeFile(options: { path: string; data: string; directory: any; recursive?: boolean }): Promise<void> {
    const dirStr = options.directory === CapDirectory.Documents ? 'DOCUMENTS'
      : options.directory === CapDirectory.External ? 'EXTERNAL'
      : 'DATA';
    await (window as any).electronAPI.fs.writeFile(options.path, options.data, dirStr, options.recursive ?? false);
  },

  async readFile(options: { path: string; directory: any }): Promise<{ data: string }> {
    const dirStr = options.directory === CapDirectory.Documents ? 'DOCUMENTS'
      : options.directory === CapDirectory.External ? 'EXTERNAL'
      : 'DATA';
    return await (window as any).electronAPI.fs.readFile(options.path, dirStr);
  },
};

/** 根据 environment 返回合适的 Filesystem 实现 */
export const Filesystem = isElectron() ? electronFilesystem : CapFilesystem;
