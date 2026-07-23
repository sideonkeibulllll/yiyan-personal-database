/**
 * 备份/恢复/数据互通类型定义
 */

/** 备份类型 */
export type BackupType = 'auto' | 'manual';

/** 备份元数据（manifest.json） */
export interface BackupManifest {
  /** 备份格式版本 */
  version: string;
  /** 备份时间戳（ms） */
  timestamp: number;
  /** 备份类型 */
  type: BackupType;
  /** 设备 ID 哈希（短） */
  deviceId: string;
  /** 设备名称 */
  deviceName: string;
  /** 条目数量 */
  entryCount: number;
  /** 待办数量 */
  todoCount: number;
  /** 标签数量 */
  tagCount: number;
  /** 组数量 */
  groupCount: number;
  /** 应用版本号 */
  appVersion: string;
}

/** 备份条目（用于列表显示） */
export interface BackupItem {
  /** 文件名 */
  filename: string;
  /** 完整路径 */
  path: string;
  /** manifest */
  manifest: BackupManifest;
  /** 文件大小（字节） */
  size: number;
}

/** 恢复结果 */
export interface RestoreResult {
  /** 条目：新增/跳过 */
  entriesImported: number;
  entriesSkipped: number;
  /** 待办：新增/跳过 */
  todosImported: number;
  todosSkipped: number;
  /** 标签：新增/跳过 */
  tagsImported: number;
  tagsSkipped: number;
  /** 组：新增/跳过 */
  groupsImported: number;
  groupsSkipped: number;
  /** 错误信息 */
  errors: string[];
}

/** ============ 数据互通 ============ */

/** 设备类型 */
export type DeviceType = 'phone' | 'desktop';

/** 已发现的设备 */
export interface DiscoveredDevice {
  /** 设备 ID 哈希 */
  id: string;
  /** 设备名称 */
  name: string;
  /** 设备类型 */
  type: DeviceType;
  /** IP 地址 */
  ip: string;
  /** 端口 */
  port: number;
  /** 发现时间 */
  discoveredAt: number;
}

/** 已信任的设备（持久化到 localStorage） */
export interface TrustedDevice extends DiscoveredDevice {
  /** 添加信任的时间 */
  trustedAt: number;
}

/** 传输方向 */
export type TransferDirection = 'send' | 'receive';

/** 传输状态 */
export type TransferStatus = 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';

/** 传输进度 */
export interface TransferProgress {
  /** 已传输字节数 */
  transferred: number;
  /** 总字节数 */
  total: number;
  /** 百分比 0-100 */
  percent: number;
  /** 当前状态 */
  status: TransferStatus;
  /** 错误信息 */
  error?: string;
}

/** 接收数据时的弹窗选择 */
export type ReceiveAction = 'import' | 'save_only' | 'reject';

/** 发送数据时的选项 */
export interface SendOptions {
  /** 接收方是否导入到数据库（false=仅保存到副本目录） */
  requestImport: boolean;
}

/** HTTP 通信消息类型 */
export interface DeviceHandshake {
  id: string;
  name: string;
  type: DeviceType;
  appVersion: string;
}

export interface SendRequest {
  /** 发送方设备 */
  from: DeviceHandshake;
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  size: number;
  /** 请求导入 */
  requestImport: boolean;
  /** 校验和 */
  checksum: string;
}

export interface ReceiveResponse {
  /** 接收方选择 */
  action: ReceiveAction;
  /** 接收方设备 */
  by: DeviceHandshake;
}
