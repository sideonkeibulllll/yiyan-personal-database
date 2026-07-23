/**
 * Capacitor 本地 HTTP 服务器包装器
 *
 * 对接 @cantoo/capacitor-http-server 插件，提供统一的 TS 接口。
 * - 原生平台（Android）：调用插件启动本地 HTTP 服务，事件驱动接收请求
 * - Web/Electron 平台：空实现（Web 不支持，Electron 走 sync.ts 的 Node.js HTTPS）
 *
 * 架构：
 * - start() 启动 Foreground Service（Android），监听端口
 * - addListener('request') 接收请求 → 调用方处理 → respond() 返回响应
 * - 收到的 body 可能是 bodyText / bodyBase64 / bodyFilePath 三种形式
 */
import { Capacitor } from '@capacitor/core';
import { isElectron } from './electronAdapter';

/** 插件类型定义（与 @cantoo/capacitor-http-server 接口一致） */
export interface StartOptions {
  port?: number;
  maxBodyBytes?: number;
  fileBodyThresholdBytes?: number;
  android?: {
    notificationTitle: string;
    notificationText: string;
    smallIconResourceName?: string;
    channelId?: string;
    channelName?: string;
  };
}

export interface StartResult {
  port: number;
  url: string;
  localIp: string;
}

export interface HttpRequestEvent {
  requestId: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  clientIp?: string;
  /** 三选一：body 文本 / base64 / 文件路径 */
  bodyText?: string;
  bodyBase64?: string;
  bodyFilePath?: string;
}

export interface HttpResponse {
  requestId: string;
  status: number;
  headers?: Record<string, string>;
  bodyText?: string;
  bodyBase64?: string;
  bodyFilePath?: string;
}

export interface ServerErrorEvent {
  message: string;
  fatal: boolean;
}

/** 插件接口（与官方定义一致） */
interface HttpServerPlugin {
  start(options?: StartOptions): Promise<StartResult>;
  stop(): Promise<void>;
  respond(response: HttpResponse): Promise<void>;
  addListener(
    eventName: 'request',
    listener: (event: HttpRequestEvent) => void,
  ): Promise<any>;
  addListener(
    eventName: 'server-error',
    listener: (event: ServerErrorEvent) => void,
  ): Promise<any>;
  removeAllListeners(): Promise<void>;
}

/**
 * 获取插件实例
 * - 原生平台：registerPlugin('HttpServer')
 * - Web/Electron：返回 null
 */
let pluginInstance: HttpServerPlugin | null = null;
let pluginLoaded = false;

async function getPlugin(): Promise<HttpServerPlugin | null> {
  if (pluginLoaded) return pluginInstance;
  pluginLoaded = true;

  // Electron 走 Node.js HTTPS，不需要这个插件
  if (isElectron()) return null;

  const platform = Capacitor.getPlatform();
  if (platform !== 'android' && platform !== 'ios') return null;

  try {
    // 动态导入插件（如果未安装则降级返回 null）
    const mod = await import('@cantoo/capacitor-http-server');
    pluginInstance = (mod as any).HttpServer as HttpServerPlugin;
  } catch {
    // 插件未安装：返回 null，调用方降级到"原生平台不支持"提示
    console.warn('[capacitorHttpServer] 插件未安装，原生接收服务不可用');
    pluginInstance = null;
  }

  return pluginInstance;
}

/** 是否支持本地服务器（原生平台 + 插件已安装） */
export async function isHttpServerSupported(): Promise<boolean> {
  const plugin = await getPlugin();
  return plugin !== null;
}

/**
 * 启动本地 HTTP 服务器
 * @param port 首选端口，0/未传则系统分配
 * @param onRequest 收到请求的回调
 * @param onError 服务器错误回调
 * @returns 启动结果（实际端口、本机 IP）
 */
export async function startHttpServer(
  port?: number,
  onRequest?: (event: HttpRequestEvent) => void,
  onError?: (event: ServerErrorEvent) => void,
): Promise<StartResult> {
  const plugin = await getPlugin();
  if (!plugin) {
    throw new Error('当前平台不支持本地服务器（需安装 @cantoo/capacitor-http-server 插件）');
  }

  // 清理旧监听
  await plugin.removeAllListeners();

  // 注册新监听
  if (onRequest) {
    await plugin.addListener('request', onRequest);
  }
  if (onError) {
    await plugin.addListener('server-error', onError);
  }

  // 启动服务（Android 自动起 Foreground Service）
  const result = await plugin.start({
    port,
    maxBodyBytes: 100 * 1024 * 1024, // 100 MB 上限
    fileBodyThresholdBytes: 2 * 1024 * 1024, // 2 MB 以上走文件
    android: {
      notificationTitle: '记忆库接收服务运行中',
      notificationText: '正在等待其他设备发送数据',
      channelId: 'yiyan-sync-service',
      channelName: '记忆库数据互通',
    },
  });

  return result;
}

/** 停止本地 HTTP 服务器 */
export async function stopHttpServer(): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) return;
  await plugin.stop();
  await plugin.removeAllListeners();
}

/**
 * 回复一个请求
 * @param requestId 请求 ID
 * @param status HTTP 状态码
 * @param bodyText 响应体文本（可选）
 * @param headers 响应头（可选）
 */
export async function respondRequest(
  requestId: string,
  status: number,
  bodyText?: string,
  headers?: Record<string, string>,
): Promise<void> {
  const plugin = await getPlugin();
  if (!plugin) return;
  await plugin.respond({
    requestId,
    status,
    headers: headers || { 'Content-Type': 'application/json' },
    bodyText,
  });
}
