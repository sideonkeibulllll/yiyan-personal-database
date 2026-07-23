/**
 * IPC 处理器注册
 *
 * 将数据库、文件系统、互通服务的功能通过 ipcMain 暴露给渲染进程
 * 所有处理器使用 invoke/handle 模式（异步，支持返回值）
 */
import { ipcMain, app } from 'electron';
import { openDatabase, dbRun, dbQuery, flushAll, closeAll } from './database';
import {
  mkdir, readdir, deleteFile, writeFile, readFile, fileExists, getFullPath,
} from './filesystem';
import { startServer, stopServer, getServerPort, getLocalIp } from './sync';

/** 注册所有 IPC 处理器 */
export function registerIpcHandlers(): void {
  // ====== 数据库 ======
  ipcMain.handle('db:open', async (_event, name: string) => {
    await openDatabase(name);
    return { success: true };
  });

  ipcMain.handle('db:run', async (_event, name: string, sql: string, params: unknown[] = []) => {
    dbRun(name, sql, params);
    return { success: true };
  });

  ipcMain.handle('db:query', async (_event, name: string, sql: string, params: unknown[] = []) => {
    return dbQuery(name, sql, params);
  });

  ipcMain.handle('db:flush', async () => {
    await flushAll();
    return { success: true };
  });

  // ====== 文件系统 ======
  ipcMain.handle('fs:mkdir', async (_event, relativePath: string, directory: string, recursive?: boolean) => {
    await mkdir(relativePath, directory as any, recursive);
    return { success: true };
  });

  ipcMain.handle('fs:readdir', async (_event, relativePath: string, directory: string) => {
    return await readdir(relativePath, directory as any);
  });

  ipcMain.handle('fs:deleteFile', async (_event, relativePath: string, directory: string) => {
    await deleteFile(relativePath, directory as any);
    return { success: true };
  });

  ipcMain.handle('fs:writeFile', async (_event, relativePath: string, data: string, directory: string, recursive?: boolean) => {
    await writeFile(relativePath, data, directory as any, recursive);
    return { success: true };
  });

  ipcMain.handle('fs:readFile', async (_event, relativePath: string, directory: string) => {
    return await readFile(relativePath, directory as any);
  });

  ipcMain.handle('fs:fileExists', async (_event, relativePath: string, directory: string) => {
    return await fileExists(relativePath, directory as any);
  });

  ipcMain.handle('fs:getFullPath', (_event, relativePath: string, directory: string) => {
    return getFullPath(relativePath, directory as any);
  });

  // ====== 数据互通 ======
  ipcMain.handle('sync:startServer', async (_event, preferPort: number) => {
    // 接收处理器的实际逻辑由渲染进程通过 sync:setReceiveHandler 注册
    // 这里返回端口，渲染进程通过 sync:onReceive 接收数据
    return await startServer(preferPort, async (request) => {
      // 通过事件通知渲染进程，并等待渲染进程的响应
      return await notifyReceive(request);
    });
  });

  ipcMain.handle('sync:stopServer', async () => {
    await stopServer();
    return { success: true };
  });

  ipcMain.handle('sync:getPort', () => {
    return getServerPort();
  });

  ipcMain.handle('sync:getLocalIp', () => {
    return getLocalIp();
  });

  // ====== 应用信息 ======
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:getPlatform', () => {
    return 'electron';
  });
}

// ====== 接收数据的事件转发机制 ======
// 主进程收到移动端数据后，通过 webContents.send 通知渲染进程
// 渲染进程处理后通过 ipcMain.handle('sync:resolveReceive') 返回结果

let pendingResolve: ((action: 'import' | 'save_only' | 'reject') => void) | null = null;

/** 通知渲染进程处理接收到的数据 */
function notifyReceive(request: any): Promise<{ action: 'import' | 'save_only' | 'reject' }> {
  // 这个函数会被主进程调用，但实际的通知需要 BrowserWindow 实例
  // 在 main.ts 中会重写此函数
  if (pendingResolve) {
    pendingResolve('reject');
  }
  return new Promise<{ action: 'import' | 'save_only' | 'reject' }>((resolve) => {
    pendingResolve = ((action: 'import' | 'save_only' | 'reject') => resolve({ action })) as (action: 'import' | 'save_only' | 'reject') => void;
    // 通知渲染进程（由 main.ts 设置 mainWindow.webContents.send）
    if (notifyReceiveCallback) {
      notifyReceiveCallback(request);
    } else {
      resolve({ action: 'reject' });
    }
  });
}

let notifyReceiveCallback: ((request: any) => void) | null = null;

/** 设置接收通知回调（由 main.ts 调用） */
export function setReceiveNotifyCallback(cb: (request: any) => void): void {
  notifyReceiveCallback = cb;
}

/** 渲染进程处理完成后调用此方法返回结果 */
export function resolveReceive(action: 'import' | 'save_only' | 'reject'): void {
  if (pendingResolve) {
    pendingResolve(action);
    pendingResolve = null;
  }
}

/** 注册接收结果处理器 */
export function registerReceiveResolver(): void {
  ipcMain.handle('sync:resolveReceive', (_event, action: 'import' | 'save_only' | 'reject') => {
    resolveReceive(action);
    return { success: true };
  });
}
