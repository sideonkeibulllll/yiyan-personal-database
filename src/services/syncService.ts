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
    appVersion: '1.5.0',
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
 * 使用 WebRTC RTCPeerConnection API（STUN），无需外部 HTTP 服务
 * 失败时返回空字符串
 */
export async function getLocalIp(): Promise<string> {
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
 */
export function createDeviceByIp(ip: string, port: number, name?: string): DiscoveredDevice {
  return {
    id: hashStr(ip + port).slice(0, 8),
    name: name || `设备 ${ip}`,
    type: ip.match(/^192\.168\.|^10\.|^172\./) ? 'desktop' : 'phone',
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
 */
export async function handshake(ip: string, port: number): Promise<DeviceHandshake | null> {
  try {
    const url = `https://${ip}:${port}/handshake`;
    const resp = await fetch(url, {
      method: 'GET',
      // 自签证书需要忽略证书错误，浏览器中无法直接做到
      // 实际实现需要 Capacitor 原生 HTTP 插件
    });
    if (!resp.ok) return null;
    return (await resp.json()) as DeviceHandshake;
  } catch {
    return null;
  }
}

/**
 * 发送数据 zip 到目标设备
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
  const url = `https://${device.ip}:${device.port}/receive`;

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
 * 启动本地 HTTPS 服务端
 * 监听发送方请求，弹出接收选择
 */
export async function startLocalServer(port: number): Promise<void> {
  const platform = Capacitor.getPlatform();
  if (platform === 'web') {
    // Web 平台：无法启动本地服务器
    return;
  }
  // 原生平台：启动 Capacitor 本地 HTTP 服务
  // TODO: 接入原生插件
}

/**
 * 停止本地服务
 */
export async function stopLocalServer(): Promise<void> {
  // TODO: 停止原生服务
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

  // 读取最新的备份文件
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
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
