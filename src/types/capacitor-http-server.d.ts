/**
 * 本地类型声明：@cantoo/capacitor-http-server
 *
 * 此插件需通过 `npm i @cantoo/capacitor-http-server` 安装到 node_modules 后才能在原生平台生效。
 * 这里提供类型声明，让 TS 编译时不报错；运行时若未安装，syncService 中的动态 import 会捕获异常降级。
 */
declare module '@cantoo/capacitor-http-server' {
  import type { PluginListenerHandle } from '@capacitor/core';

  export type HttpMethod =
    | 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

  export interface StartOptionsAndroid {
    notificationTitle: string;
    notificationText: string;
    smallIconResourceName?: string;
    channelId?: string;
    channelName?: string;
  }

  export interface StartOptions {
    port?: number;
    maxBodyBytes?: number;
    fileBodyThresholdBytes?: number;
    android?: StartOptionsAndroid;
  }

  export interface StartResult {
    port: number;
    url: string;
    localIp: string;
  }

  export interface HttpRequestEvent {
    requestId: string;
    method: HttpMethod;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    clientIp?: string;
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

  export interface HttpServerPlugin {
    start(options?: StartOptions): Promise<StartResult>;
    stop(): Promise<void>;
    respond(response: HttpResponse): Promise<void>;
    addListener(
      eventName: 'request',
      listener: (event: HttpRequestEvent) => void,
    ): Promise<PluginListenerHandle> & PluginListenerHandle;
    addListener(
      eventName: 'server-error',
      listener: (event: ServerErrorEvent) => void,
    ): Promise<PluginListenerHandle> & PluginListenerHandle;
    removeAllListeners(): Promise<void>;
  }

  export const HttpServer: HttpServerPlugin;
}
