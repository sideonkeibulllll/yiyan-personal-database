/**
 * Preload 脚本
 *
 * 通过 contextBridge 安全地暴露 IPC API 给渲染进程
 * 渲染进程通过 window.electronAPI 访问这些方法
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const electronAPI = {
  // ====== 数据库 ======
  db: {
    open: (name: string) => ipcRenderer.invoke('db:open', name),
    run: (name: string, sql: string, params?: unknown[]) => ipcRenderer.invoke('db:run', name, sql, params),
    query: (name: string, sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', name, sql, params),
    flush: () => ipcRenderer.invoke('db:flush'),
  },

  // ====== 文件系统 ======
  fs: {
    mkdir: (relativePath: string, directory: string, recursive?: boolean) =>
      ipcRenderer.invoke('fs:mkdir', relativePath, directory, recursive),
    readdir: (relativePath: string, directory: string) =>
      ipcRenderer.invoke('fs:readdir', relativePath, directory),
    deleteFile: (relativePath: string, directory: string) =>
      ipcRenderer.invoke('fs:deleteFile', relativePath, directory),
    writeFile: (relativePath: string, data: string, directory: string, recursive?: boolean) =>
      ipcRenderer.invoke('fs:writeFile', relativePath, data, directory, recursive),
    readFile: (relativePath: string, directory: string) =>
      ipcRenderer.invoke('fs:readFile', relativePath, directory),
    fileExists: (relativePath: string, directory: string) =>
      ipcRenderer.invoke('fs:fileExists', relativePath, directory),
    getFullPath: (relativePath: string, directory: string) =>
      ipcRenderer.invoke('fs:getFullPath', relativePath, directory),
  },

  // ====== 数据互通 ======
  sync: {
    startServer: (preferPort: number) => ipcRenderer.invoke('sync:startServer', preferPort),
    stopServer: () => ipcRenderer.invoke('sync:stopServer'),
    getPort: () => ipcRenderer.invoke('sync:getPort'),
    getLocalIp: () => ipcRenderer.invoke('sync:getLocalIp'),
    resolveReceive: (action: 'import' | 'save_only' | 'reject') =>
      ipcRenderer.invoke('sync:resolveReceive', action),
    onReceiveRequest: (callback: (request: any) => void) => {
      const handler = (_event: IpcRendererEvent, request: any) => callback(request);
      ipcRenderer.on('sync:receiveRequest', handler);
      return () => ipcRenderer.removeListener('sync:receiveRequest', handler);
    },
  },

  // ====== 应用信息 ======
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
