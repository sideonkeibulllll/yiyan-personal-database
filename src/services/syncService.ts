/**
 * 数据互通服务
 *
 * 功能：
 * 1. mDNS 自动发现附近设备
 * 2. HTTPS 自签证书加密传输
 * 3. 发送/接收数据 zip
 *
 * 架构：
 * - 发现层：mDNS 广播 + 监听
 * - 通信层：HTTPS 服务端 + 客户端
 * - 应用层：发送方 → 接收方弹窗选择 → 导入或仅保存
 *
 * 注：在 Capacitor 环境中需要相应原生插件支持 mDNS 和本地 HTTP 服务。
 * 在 Web/Electron 环境中使用浏览器 API 或 Node.js API。
 */
import { Capacitor } from '@capacitor/core';
import { isElectron } from './electronAdapter';
import type {
  DiscoveredDevice,
  TrustedDevice,
  DeviceType,
  DeviceHandshake,
  SendRequest,
  ReceiveResponse,
  ReceiveAction,
  TransferProgress,
} from './backupTypes';

const TRUSTED_KEY = 'yiyan_trusted_devices';
const PENDING_CONNECTION_KEY = 'yiyan_pending_connection';

/** 设备 ID 和名称（复用 backupService 的逻辑） */
function getDeviceId(): string {
  const KEY = 'yiyan_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    const random = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    let h = 0;
    for (let i = 0; i < random.length; i++) {
      h = ((h << 5) - h) + random.charCodeAt(i);
      h = h & h;
    }
    id = Math.abs(h).toString(36).slice(0, 8);
    localStorage.setItem(KEY, id);
  }
  return id;
}

function getDeviceName(): string {
  const KEY = 'yiyan_device_name';
  let name = localStorage.getItem(KEY);
  if (!name) {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) name = 'Android 设备';
    else if (/iphone|ipad|ipod/i.test(ua)) name = 'iOS 设备';
    else if (/electron/i.test(ua)) name = '桌面端';
    else name = 'Web 设备';
    localStorage.setItem(KEY, name);
  }
  return name;
}

function getDeviceType(): DeviceType {
  const ua = navigator.userAgent;
  if (/android|iphone|ipad|ipod/i.test(ua)) return 'phone';
  return 'desktop';
}

function getHandshake(): DeviceHandshake {
  return {
    id: getDeviceId(),
    name: getDeviceName(),
    type: getDeviceType(),
    appVersion: '1.6.0',
  };
}

/** ============================================================
 *  信任设备管理
 *  ============================================================ */

export function getTrustedDevices(): TrustedDevice[] {
  try {
    const stored = localStorage.getItem(TRUSTED_KEY);
    if (stored) return JSON.parse(stored) as TrustedDevice[];
  } catch {
    // ignore
  }
  return [];
}

export function addTrustedDevice(device: DiscoveredDevice): void {
  const list = getTrustedDevices();
  // 去重
  const filtered = list.filter(d => d.id !== device.id);
  filtered.push({ ...device, trustedAt: Date.now() });
  localStorage.setItem(TRUSTED_KEY, JSON.stringify(filtered));
}

export function removeTrustedDevice(deviceId: string): void {
  const list = getTrustedDevices().filter(d => d.id !== deviceId);
  localStorage.setItem(TRUSTED_KEY, JSON.stringify(list));
}

export function isTrustedDevice(deviceId: string): boolean {
  return getTrustedDevices().some(d => d.id === deviceId);
}

/** ============================================================
 *  本机 IP 获取
 *  ============================================================ */

/**
 * 获取本机局域网 IP 地址
 * - Electron: 通过 IPC 直接读取网络接口（更快更准）
 * - Web/移动端: 使用 WebRTC RTCPeerConnection API（STUN）
 * 失败时返回空字符串
 */
export async function getLocalIp(): Promise<string> {
  // Electron 环境优先使用 IPC
  if (isElectron()) {
    try {
      const ip = await (window as any).electronAPI.sync.getLocalIp();
      if (ip) return ip;
    } catch {
      // fallthrough to WebRTC
    }
  }

  return new Promise((resolve) => {
    const ips = new Set<string>();
    let resolved = false;
    let rtc: RTCPeerConnection | null = null;

    const finish = (value: string) => {
      if (resolved) return;
      resolved = true;
      try { rtc?.close(); } catch { /* ignore */ }
      resolve(value);
    };

    try {
      rtc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      rtc.createDataChannel('');
      rtc.onicecandidate = (e) => {
        if (!e.candidate) {
          // 收集完毕，挑出局域网 IP
          const localIp = Array.from(ips).find(ip =>
            /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip)
          );
          finish(localIp || Array.from(ips)[0] || '');
          return;
        }
        const ipMatch = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
        if (ipMatch) ips.add(ipMatch[1]);
      };
      rtc.createOffer()
        .then(offer => rtc!.setLocalDescription(offer))
        .catch(() => finish(''));
    } catch {
      finish('');
    }

    // 超时 3 秒兜底
    setTimeout(() => finish(Array.from(ips)[0] || ''), 3000);
  });
}

/** ============================================================
 *  mDNS 发现
 *  ============================================================ */

/**
 * 开始广播本设备
 * 在 Capacitor 原生环境中调用原生插件
 * 在 Web/Electron 中使用 WebSocket 广播或手动 IP 输入
 */
export async function startBroadcast(port: number): Promise<void> {
  const platform = Capacitor.getPlatform();
  if (platform === 'web') {
    // Web 平台：通过 WebSocket 信令服务器（简化版，局域网内广播）
    // 实际实现使用 BroadcastChannel 或手动 IP 输入
    return;
  }
  // 原生平台：调用 Capacitor mDNS 插件
  // TODO: 接入原生插件
}

/**
 * 搜索附近设备
 * 返回发现的设备列表
 */
export async function discoverDevices(timeoutMs: number = 5000): Promise<DiscoveredDevice[]> {
  const platform = Capacitor.getPlatform();
  if (platform === 'web') {
    // Web 平台：无法 mDNS，返回空列表，需要手动输入 IP
    return [];
  }
  // 原生平台：调用 Capacitor mDNS 插件
  // TODO: 接入原生插件
  return [];
}

/**
 * 手动添加设备（通过 IP 地址）
 *
 * @deprecated 请使用 `handshakeAndCreateDevice` 进行握手验证后添加。
 * 此函数现在内部也会先握手验证，握手失败返回 null。
 *
 * 设备类型默认为 'phone'，实际类型应由握手返回的真实信息确定。
 */
export async function createDeviceByIp(ip: string, port: number, name?: string): Promise<DiscoveredDevice | null> {
  const hs = await handshake(ip, port);
  if (!hs) return null;
  return {
    id: hashStr(ip + port).slice(0, 8),
    name: name || hs.name || `设备 ${ip}`,
    type: hs.type,
    ip,
    port,
    discoveredAt: Date.now(),
  };
}

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(36);
}

/** ============================================================
 *  HTTPS 通信
 *  ============================================================ */

/**
 * 发送握手请求，验证目标设备
 *
 * 协议选择：
 * - 目标是 Electron（自签 HTTPS）：Electron 走 fetch（主进程已忽略证书）；原生走 CapacitorHttp（绕过证书）
 * - 目标是手机（插件纯 HTTP）：所有平台走 fetch/CapacitorHttp 请求 http://
 *
 * 探测策略：先尝试 HTTPS（兼容旧电脑端），失败再尝试 HTTP（新手机端）
 *
 * @param ip 目标 IP
 * @param port 目标端口
 * @param timeoutMs 超时毫秒，默认 5000
 */
export async function handshake(
  ip: string,
  port: number,
  timeoutMs: number = 5000,
): Promise<DeviceHandshake | null> {
  // 原生平台用 CapacitorHttp（已 patch fetch），Web/Electron 用原生 fetch
  // 二者接口一致，可直接用 fetch
  const tryProtocol = async (protocol: 'https' | 'http'): Promise<DeviceHandshake | null> => {
    try {
      const url = `${protocol}://${ip}:${port}/handshake`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });
        if (!resp.ok) return null;
        return (await resp.json()) as DeviceHandshake;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return null;
    }
  };

  // 原生平台（Android）：先试 HTTP（手机端接收方用插件起的是 HTTP）
  // 避免每次都先试 HTTPS 拖慢握手速度
  if (!isElectron() && Capacitor.getPlatform() === 'android') {
    const httpResult = await tryProtocol('http');
    if (httpResult) return httpResult;
    // HTTP 失败可能是电脑端 HTTPS 接收方，再试 HTTPS
    return await tryProtocol('https');
  }

  // Electron/Web：先试 HTTPS（电脑端默认 HTTPS）
  const httpsResult = await tryProtocol('https');
  if (httpsResult) return httpsResult;
  // HTTPS 失败可能是手机端 HTTP 接收方，再试 HTTP
  return await tryProtocol('http');
}

/**
 * 通过 IP 握手并创建设备对象（推荐用法）
 *
 * 流程：
 * 1. 调用 /handshake 验证目标是否为记忆库应用
 * 2. 握手成功：用返回的真实设备信息构造 DiscoveredDevice
 * 3. 握手失败：返回 null（调用方据此提示用户）
 *
 * @returns 成功返回 { device, handshake }，失败返回 null
 */
export async function handshakeAndCreateDevice(
  ip: string,
  port: number,
): Promise<{ device: DiscoveredDevice; handshake: DeviceHandshake } | null> {
  const hs = await handshake(ip, port);
  if (!hs) return null;
  const device: DiscoveredDevice = {
    id: hashStr(ip + port).slice(0, 8),
    name: hs.name || `设备 ${ip}`,
    type: hs.type,
    ip,
    port,
    discoveredAt: Date.now(),
  };
  return { device, handshake: hs };
}

/**
 * 发送数据 zip 到目标设备
 *
 * 协议探测：根据握手时确定的协议发送
 * - 目标是电脑端（Electron HTTPS）：https
 * - 目标是手机端（插件 HTTP）：http
 *
 * 注：原生平台 fetch 已被 CapacitorHttp patch，可直接用 fetch
 *
 * @param device 目标设备
 * @param zipBase64 zip 的 base64 数据
 * @param filename 文件名
 * @param requestImport 是否请求对方导入
 * @param onProgress 进度回调
 */
export async function sendZipToDevice(
  device: DiscoveredDevice,
  zipBase64: string,
  filename: string,
  requestImport: boolean,
  onProgress?: (p: TransferProgress) => void,
): Promise<ReceiveResponse> {
  const totalBytes = zipBase64.length;

  // 根据目标设备类型选协议：手机用 HTTP（插件），电脑用 HTTPS（Electron）
  const protocol = device.type === 'phone' ? 'http' : 'https';
  const url = `${protocol}://${device.ip}:${device.port}/receive`;

  onProgress?.({
    transferred: 0,
    total: totalBytes,
    percent: 0,
    status: 'transferring',
  });

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getHandshake(),
        filename,
        data: zipBase64,
        requestImport,
      } as SendRequest & { data: string }),
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const response = (await resp.json()) as ReceiveResponse;

    onProgress?.({
      transferred: totalBytes,
      total: totalBytes,
      percent: 100,
      status: 'completed',
    });

    return response;
  } catch (err) {
    // 主协议失败时，回退尝试另一协议
    const fallbackProtocol = protocol === 'https' ? 'http' : 'https';
    try {
      const fallbackUrl = `${fallbackProtocol}://${device.ip}:${device.port}/receive`;
      const resp = await fetch(fallbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: getHandshake(),
          filename,
          data: zipBase64,
          requestImport,
        }),
      });
      if (resp.ok) {
        const response = (await resp.json()) as ReceiveResponse;
        onProgress?.({
          transferred: totalBytes, total: totalBytes, percent: 100, status: 'completed',
        });
        return response;
      }
    } catch {
      // 回退也失败，抛出原始错误
    }

    onProgress?.({
      transferred: 0,
      total: totalBytes,
      percent: 0,
      status: 'failed',
      error: err instanceof Error ? err.message : '发送失败',
    });
    throw err;
  }
}

/**
 * 本地 HTTP 服务端（接收方）
 * 在原生环境中使用 Capacitor 本地服务器插件
 * 在 Electron 中使用 Node.js http/https 模块
 */

/** 接收数据时的回调（由 UI 层设置） */
type ReceiveHandler = (request: SendRequest, data: string) => Promise<ReceiveAction>;

let currentReceiveHandler: ReceiveHandler | null = null;

export function setReceiveHandler(handler: ReceiveHandler | null): void {
  currentReceiveHandler = handler;
}

/**
 * 启动本地服务端
 *
 * 三种平台支持：
 * - Electron：Node.js HTTPS 服务（自签证书，主进程已忽略证书错误）
 * - Android：capacitor-http-server 插件（纯 HTTP + Foreground Service）
 * - Web：不支持
 *
 * @param preferPort 首选端口
 * @returns 实际端口（Electron 走 sync.getPort 查询；Android 由插件返回）
 */
export async function startLocalServer(preferPort: number): Promise<number> {
  if (isElectron()) {
    // Electron 环境：通过 IPC 启动主进程的 HTTPS 服务
    const actualPort = await (window as any).electronAPI.sync.startServer(preferPort);
    // 注册接收回调
    (window as any).electronAPI.sync.onReceiveRequest((request: any) => {
      if (currentReceiveHandler) {
        currentReceiveHandler(request, request.data).then((action) => {
          (window as any).electronAPI.sync.resolveReceive(action);
        });
      } else {
        (window as any).electronAPI.sync.resolveReceive('reject');
      }
    });
    return actualPort;
  }

  const platform = Capacitor.getPlatform();
  if (platform === 'web') {
    throw new Error('Web 平台不支持启动本地服务器');
  }

  // 原生平台：启动 capacitor-http-server 插件
  const { startHttpServer, isHttpServerSupported } = await import('./capacitorHttpServer');
  if (!(await isHttpServerSupported())) {
    throw new Error('插件未安装：@cantoo/capacitor-http-server');
  }

  const result = await startHttpServer(
    preferPort || 0, // 0 = 系统自动分配端口
    (event) => handleNativeRequest(event),
    (err) => {
      console.error('[syncService] 服务器错误:', err);
    },
  );

  return result.port;
}

/**
 * 处理原生插件收到的 HTTP 请求
 * 路由：/handshake 握手 / /receive 接收数据
 */
async function handleNativeRequest(event: any): Promise<void> {
  const { respondRequest } = await import('./capacitorHttpServer');

  // CORS 预检
  if (event.method === 'OPTIONS') {
    await respondRequest(event.requestId, 204, '', {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return;
  }

  // 握手
  if (event.path === '/handshake' && event.method === 'GET') {
    const handshake = {
      id: getDeviceId(),
      name: getDeviceName(),
      type: getDeviceType(),
      appVersion: '1.6.0',
    };
    await respondRequest(event.requestId, 200, JSON.stringify(handshake), {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    return;
  }

  // 接收数据
  if (event.path === '/receive' && event.method === 'POST') {
    // body 可能是 bodyText / bodyBase64 / bodyFilePath 三种之一
    let bodyText = event.bodyText;
    if (!bodyText && event.bodyBase64) {
      bodyText = atob(event.bodyBase64);
    }
    if (!bodyText && event.bodyFilePath) {
      // 文件型 body：插件把大 body 写到临时文件
      // 直接用 fetch(uri) 读取（bodyFilePath 可能是 file:// uri 或绝对路径）
      try {
        const resp = await fetch(`file://${event.bodyFilePath}`);
        const blob = await resp.blob();
        bodyText = await blob.text();
      } catch (err) {
        await respondRequest(event.requestId, 400, JSON.stringify({ action: 'reject' }), {
          'Content-Type': 'application/json',
        });
        return;
      }
    }

    if (!bodyText) {
      await respondRequest(event.requestId, 400, JSON.stringify({ action: 'reject' }), {
        'Content-Type': 'application/json',
      });
      return;
    }

    try {
      const payload = JSON.parse(bodyText);
      if (!currentReceiveHandler) {
        await respondRequest(event.requestId, 500, JSON.stringify({ action: 'reject' }), {
          'Content-Type': 'application/json',
        });
        return;
      }
      const action = await currentReceiveHandler(payload, payload.data);
      await respondRequest(event.requestId, 200, JSON.stringify({ action }), {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
    } catch (err) {
      await respondRequest(event.requestId, 500, JSON.stringify({ action: 'reject', error: String(err) }), {
        'Content-Type': 'application/json',
      });
    }
    return;
  }

  // 未知路由
  await respondRequest(event.requestId, 404, 'Not Found');
}

/**
 * 停止本地服务
 */
export async function stopLocalServer(): Promise<void> {
  if (isElectron()) {
    await (window as any).electronAPI.sync.stopServer();
    return;
  }

  const platform = Capacitor.getPlatform();
  if (platform === 'web') return;

  // 原生平台：停止插件服务
  const { stopHttpServer, isHttpServerSupported } = await import('./capacitorHttpServer');
  if (!(await isHttpServerSupported())) return;
  await stopHttpServer();
}

/** ============================================================
 *  导出备份为 base64（用于发送）
 *  ============================================================ */

/**
 * 生成发送用 zip 的 base64 数据
 */
export async function prepareZipForSend(): Promise<{ base64: string; filename: string; size: number }> {
  // 复用 backupService 创建备份
  const { createBackup } = await import('./backupService');
  await createBackup('manual');

  // 读取最新创建的备份
  const { listBackups } = await import('./backupService');
  const backups = await listBackups();
  if (backups.length === 0) throw new Error('创建备份失败');

  // 读取最新的备份文件（使用适配器，兼容 Electron 环境）
  const { Filesystem, Directory } = await import('./filesystemAdapter');
  const latest = backups[0];
  const result = await Filesystem.readFile({
    path: latest.path,
    directory: Directory.Documents,
  });

  const base64 = result.data as string;
  return {
    base64,
    filename: latest.filename,
    size: latest.size,
  };
}
