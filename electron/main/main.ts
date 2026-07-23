/**
 * Electron 主进程入口
 *
 * 职责：
 * - 创建应用窗口（加载 vite dev server 或构建后的 dist）
 * - 注册 IPC 处理器
 * - 管理应用生命周期（启动/退出）
 * - 初始化数据库
 */
import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { registerIpcHandlers, registerReceiveResolver, setReceiveNotifyCallback } from './ipc';
import { closeAll } from './database';
import { stopServer } from './sync';

let mainWindow: BrowserWindow | null = null;

/** 判断是否开发环境 */
const isDev = !app.isPackaged;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '记忆库',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 开发环境加载 dev server，生产环境加载构建后的文件
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 设置接收通知回调（转发到渲染进程）
  setReceiveNotifyCallback((request) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:receiveRequest', request);
    }
  });
}

/** 应用就绪 */
app.whenReady().then(async () => {
  // 注册 IPC 处理器
  registerIpcHandlers();
  registerReceiveResolver();

  // 创建窗口
  createWindow();

  // macOS 激活时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/** 所有窗口关闭时退出（除 macOS） */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/** 应用退出前清理资源 */
app.on('before-quit', async (event) => {
  event.preventDefault();
  try {
    await closeAll();
    await stopServer();
  } catch {
    // ignore
  }
  app.exit(0);
});
