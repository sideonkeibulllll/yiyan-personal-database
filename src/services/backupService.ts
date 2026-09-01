/**
 * 备份与恢复服务（v2 索引式架构）
 *
 * 核心思想：备份逻辑与备份文件分离
 * - 数据按内容哈希存入共享块池（backup-store/），相同内容只存一份
 * - 每次备份只生成一个轻量「清单」（backups/<type>_<date>.json），
 *   记录该快照引用了哪些块
 * - 删除某个备份 = 删除清单；没有任何清单引用的块会被垃圾回收
 *
 * 目录约定（Directory.Documents）：
 * - backups/            清单目录（新格式 .json；旧格式 .zip 兼容展示/恢复）
 * - backup-store/data/  数据块（单条 entry/todo/... 的 JSON，按 sha256 命名）
 * - backup-store/att/   附件缩略图块（jpg 二进制，按内容 sha256 命名）
 *
 * 旧版全量 zip 格式仍用于：导出到 Download、局域网同步发送、接收外部 zip 恢复
 */
import JSZip from 'jszip';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from './filesystemAdapter';
import { getDatabase } from './database';
import { getTodoDatabase } from './todoDatabase';
import { loadChatSessions } from './chatSessionService';
import { contentHash } from '@/features/datamanager/types';
import type { Entry, Tag, Group, Link, Settings, Attachment, Todo, TodoTag, TodoTemplate, TodoTemplateItem } from '@/types';
import type {
  BackupManifest,
  BackupItem,
  BackupType,
  RestoreResult,
} from './backupTypes';

const BACKUP_DIR = 'backups';
const STORE_DATA_DIR = 'backup-store/data';
const STORE_ATT_DIR = 'backup-store/att';
const APP_VERSION = '2.1.4';

/** 索引式备份保留策略 */
const PRUNE_LIMIT: Record<BackupType, number> = { auto: 14, manual: 10 };

/** ============================================================
 *  基础工具
 *  ============================================================ */

/** 设备 ID 哈希（从 localStorage 取，没有则生成） */
function getDeviceId(): string {
  const KEY = 'yiyan_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    const random = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    id = hashStr(random).slice(0, 8);
    localStorage.setItem(KEY, id);
  }
  return id;
}

/** 设备名称 */
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

/** 简单字符串哈希 */
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(36);
}

/** 格式化时间戳为文件名：20260723_162200 */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 确保目录存在 */
async function ensureDir(path: string, directory: Directory): Promise<void> {
  try {
    await Filesystem.mkdir({
      path,
      directory,
      recursive: true,
    });
  } catch {
    // 目录已存在或无权限，忽略
  }
}

/** 读取目录下所有文件 */
async function readDir(path: string, directory: Directory): Promise<{ name: string; uri: string; size: number }[]> {
  try {
    const result = await Filesystem.readdir({ path, directory });
    return result.files.map(f => ({
      name: f.name,
      uri: f.uri || '',
      size: f.size || 0,
    }));
  } catch {
    return [];
  }
}

/** 删除文件 */
async function deleteFile(path: string, directory: Directory): Promise<void> {
  try {
    await Filesystem.deleteFile({
      path,
      directory,
    });
  } catch {
    // 文件已不存在或无权限，忽略
  }
}

/** 稳定序列化：对象 key 排序，保证相同内容哈希一致 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(v => stableStringify(v === undefined ? null : v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** SHA-256（纯 JS 同步实现，跨平台结果一致） */
function sha256Ascii(ascii: string): string {
  const rightRotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  const maxWord = Math.pow(2, 32);
  let result = '';
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0
        );
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash.unshift((temp1 + temp2) | 0);
      hash.pop();
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (let i = 0; i < 8; i++) {
    for (let jj = 3; jj + 1; jj--) {
      const b = (hash[i] >> (jj * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

/** 对 UTF-8 字符串计算 SHA-256（hex） */
function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let latin1 = '';
  for (let i = 0; i < bytes.length; i++) latin1 += String.fromCharCode(bytes[i]);
  return sha256Ascii(latin1);
}

/** UTF-8 文本 → base64 */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** base64 → UTF-8 文本 */
function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 并发批处理执行（限制并发数，避免一次性发起过多 I/O） */
async function runBatch<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** ============================================================
 *  索引式备份：清单与块
 *  ============================================================ */

/** 索引式清单（v2 备份格式） */
interface IndexedManifest {
  format: 'indexed';
  version: '2.0';
  timestamp: number;
  type: BackupType;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  counts: {
    entries: number; tags: number; groups: number; links: number;
    todos: number; todoTags: number; templates: number;
    attachments: number; chatSessions: number;
  };
  refs: {
    entries: string[];
    tags: string[];
    groups: string[];
    links: string[];
    settings: string | null;
    todos: string[];
    todoTags: string[];
    templates: string[];
    chatSessions: string[];
    attachments: string[];
    thumbs: string[];
  };
}

/** 清单文件名：auto_20260901_120000.json */
function indexedFilename(type: BackupType, ts: number): string {
  return `${type}_${formatTimestamp(ts)}.json`;
}

/** 解析清单文件名：{ type, yyyymmdd }，非清单返回 null */
function parseIndexedFilename(name: string): { type: BackupType; yyyymmdd: string; ts: number } | null {
  const m = /^(auto|manual)_(\d{8})_(\d{6})\.json$/.exec(name);
  if (!m) return null;
  const [, type, ymd, hms] = m;
  const ts = new Date(
    Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)),
    Number(hms.slice(0, 2)), Number(hms.slice(2, 4)), Number(hms.slice(4, 6)),
  ).getTime();
  return { type: type as BackupType, yyyymmdd: ymd, ts };
}

/** 读取索引式清单 */
async function readIndexedManifest(filename: string): Promise<IndexedManifest> {
  const result = await Filesystem.readFile({
    path: `${BACKUP_DIR}/${filename}`,
    directory: Directory.Documents,
  });
  return JSON.parse(base64ToUtf8(result.data as string)) as IndexedManifest;
}

/** 索引式清单 → 兼容 UI 的 BackupManifest */
function indexedToCompatManifest(m: IndexedManifest): BackupManifest {
  return {
    version: m.version,
    timestamp: m.timestamp,
    type: m.type,
    deviceId: m.deviceId,
    deviceName: m.deviceName,
    entryCount: m.counts.entries,
    todoCount: m.counts.todos,
    tagCount: m.counts.tags,
    groupCount: m.counts.groups,
    appVersion: m.appVersion,
    chatSessionCount: m.counts.chatSessions,
  };
}

/** 读取块池现有块名集合（不含扩展名） */
async function listStoredChunks(): Promise<{ data: Set<string>; att: Set<string> }> {
  const [dataFiles, attFiles] = await Promise.all([
    readDir(STORE_DATA_DIR, Directory.Documents),
    readDir(STORE_ATT_DIR, Directory.Documents),
  ]);
  return {
    data: new Set(dataFiles.map(f => f.name.replace(/\.json$/, ''))),
    att: new Set(attFiles.map(f => f.name.replace(/\.jpg$/, ''))),
  };
}

/**
 * 收集全部备份数据（批量查询，无 N+1）
 */
async function collectBackupData(): Promise<{
  entries: Entry[];
  tags: Tag[];
  groups: Group[];
  links: Link[];
  settings: Settings | null;
  allTodos: Todo[];
  allTodoTags: TodoTag[];
  templatesWithItems: { template: TodoTemplate; items: TodoTemplateItem[] }[];
  allAttachments: Attachment[];
  chatSessions: Awaited<ReturnType<typeof loadChatSessions>>;
}> {
  const db = await getDatabase();
  const todoDb = await getTodoDatabase();

  await (db as any).ensureConnection?.();
  await (todoDb as any).ensureConnection?.();

  const [entries, tags, groups, settings, allTodos, allTodoTags, allTemplates, allTemplateItems, allAttachments, chatSessions, links] = await Promise.all([
    db.getAllEntries(),
    db.getAllTags(),
    db.getAllGroups(),
    db.getSettings(),
    todoDb.getAllTodos(),
    todoDb.getAllTodoTags(),
    todoDb.getAllTemplates(),
    todoDb.getAllTemplateItems(),
    db.getAllAttachments(),
    loadChatSessions(),
    db.getAllLinks(),
  ]);

  // 模板与条目内存分组（代替逐模板查询）
  const itemsByTemplate = new Map<string, TodoTemplateItem[]>();
  for (const item of allTemplateItems) {
    const list = itemsByTemplate.get(item.templateId) || [];
    list.push(item);
    itemsByTemplate.set(item.templateId, list);
  }
  const templatesWithItems = allTemplates.map(t => ({ template: t, items: itemsByTemplate.get(t.id) || [] }));

  return { entries, tags, groups, links, settings, allTodos, allTodoTags, templatesWithItems, allAttachments, chatSessions };
}

/**
 * 创建索引式备份（v2 主路径）
 * 数据写入共享块池（去重），再生成轻量清单
 */
export async function createBackup(type: BackupType = 'manual'): Promise<BackupManifest> {
  const ts = Date.now();
  const { entries, tags, groups, links, settings, allTodos, allTodoTags, templatesWithItems, allAttachments, chatSessions } = await collectBackupData();

  // 现有块集合（一次 readdir，避免重复写已有块）
  const stored = await listStoredChunks();
  const newChunks: string[] = [];

  /** 写入一个数据块（已存在则跳过），返回块哈希 */
  const writeDataChunk = async (obj: unknown): Promise<string> => {
    const text = stableStringify(obj);
    const hash = sha256Hex(text);
    if (!stored.data.has(hash)) {
      await Filesystem.writeFile({
        path: `${STORE_DATA_DIR}/${hash}.json`,
        data: utf8ToBase64(text),
        directory: Directory.Documents,
        recursive: true,
      });
      stored.data.add(hash);
      newChunks.push(hash);
    }
    return hash;
  };

  // === 附件元数据块（含缩略图哈希）+ 缩略图内容块 ===
  // 先并发读源缩略图（I/O 大头），再写块
  const thumbContents = await runBatch(allAttachments, 4, async (att) => {
    try {
      const res = await Filesystem.readFile({ path: att.thumbPath, directory: Directory.Data });
      return res.data as string;
    } catch {
      return null; // 缩略图缺失（可能已被删除），跳过
    }
  });

  const attachmentChunks: string[] = [];
  const thumbChunks: string[] = [];
  for (let i = 0; i < allAttachments.length; i++) {
    const att = allAttachments[i];
    const thumbBase64 = thumbContents[i];
    let thumbHash: string | undefined;
    if (thumbBase64) {
      thumbHash = sha256Hex(thumbBase64);
      if (!stored.att.has(thumbHash)) {
        await Filesystem.writeFile({
          path: `${STORE_ATT_DIR}/${thumbHash}.jpg`,
          data: thumbBase64,
          directory: Directory.Documents,
          recursive: true,
        });
        stored.att.add(thumbHash);
        newChunks.push(thumbHash);
      }
      thumbChunks.push(thumbHash);
    }
    // 元数据块（附 thumbHash，恢复时据此找回缩略图）
    const meta: Record<string, unknown> = {
      id: att.id, entryId: att.entryId, filePath: att.filePath, thumbPath: att.thumbPath,
      mimeType: att.mimeType, sortOrder: att.sortOrder, createdAt: att.createdAt,
    };
    if (thumbHash) meta.thumbHash = thumbHash;
    attachmentChunks.push(await writeDataChunk(meta));
  }

  // === 各类数据块 ===
  const entryChunks: string[] = [];
  for (const entry of entries) {
    const { attachments: _drop, ...rest } = entry;
    entryChunks.push(await writeDataChunk(rest));
  }
  const tagChunks: string[] = [];
  for (const tag of tags) tagChunks.push(await writeDataChunk(tag));
  const groupChunks: string[] = [];
  for (const group of groups) groupChunks.push(await writeDataChunk(group));
  const linkChunks: string[] = [];
  for (const link of links) linkChunks.push(await writeDataChunk(link));
  const settingsChunk = settings ? await writeDataChunk(settings) : null;
  const todoChunks: string[] = [];
  for (const todo of allTodos) {
    const { tags: _dropTags, attachments: _dropAtts, ...rest } = todo;
    todoChunks.push(await writeDataChunk(rest));
  }
  const todoTagChunks: string[] = [];
  for (const tt of allTodoTags) todoTagChunks.push(await writeDataChunk(tt));
  const templateChunks: string[] = [];
  for (const twi of templatesWithItems) templateChunks.push(await writeDataChunk(twi));
  const chatChunks: string[] = [];
  for (const cs of chatSessions) chatChunks.push(await writeDataChunk(cs));

  // === 写清单 ===
  const manifest: IndexedManifest = {
    format: 'indexed',
    version: '2.0',
    timestamp: ts,
    type,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    appVersion: APP_VERSION,
    counts: {
      entries: entries.length, tags: tags.length, groups: groups.length, links: links.length,
      todos: allTodos.length, todoTags: allTodoTags.length, templates: templatesWithItems.length,
      attachments: allAttachments.length, chatSessions: chatSessions.length,
    },
    refs: {
      entries: entryChunks, tags: tagChunks, groups: groupChunks, links: linkChunks,
      settings: settingsChunk, todos: todoChunks, todoTags: todoTagChunks,
      templates: templateChunks, chatSessions: chatChunks,
      attachments: attachmentChunks, thumbs: thumbChunks,
    },
  };

  await ensureDir(BACKUP_DIR, Directory.Documents);
  await Filesystem.writeFile({
    path: `${BACKUP_DIR}/${indexedFilename(type, ts)}`,
    data: utf8ToBase64(JSON.stringify(manifest)),
    directory: Directory.Documents,
    recursive: true,
  });

  // 清理超限清单 + 回收孤儿块
  await pruneIndexedBackups(type);

  return indexedToCompatManifest(manifest);
}

/** 清理超限的索引式备份（按文件名时间戳，无需读文件内容） */
async function pruneIndexedBackups(type: BackupType): Promise<void> {
  const files = await readDir(BACKUP_DIR, Directory.Documents);
  const sameType = files
    .map(f => ({ name: f.name, parsed: parseIndexedFilename(f.name) }))
    .filter(x => x.parsed && x.parsed.type === type)
    .sort((a, b) => a.parsed!.ts - b.parsed!.ts);

  const limit = PRUNE_LIMIT[type];
  if (sameType.length > limit) {
    const toDelete = sameType.slice(0, sameType.length - limit);
    for (const item of toDelete) {
      await deleteFile(`${BACKUP_DIR}/${item.name}`, Directory.Documents);
    }
    await gcOrphanChunks();
  }
}

/** 垃圾回收：删除没有任何清单引用的块 */
async function gcOrphanChunks(): Promise<number> {
  // 收集全部清单的引用
  const files = await readDir(BACKUP_DIR, Directory.Documents);
  const referenced = new Set<string>();
  const manifests = files.filter(f => f.name.endsWith('.json'));

  await runBatch(manifests, 4, async (f) => {
    try {
      const m = await readIndexedManifest(f.name);
      for (const list of [
        m.refs.entries, m.refs.tags, m.refs.groups, m.refs.links,
        m.refs.todos, m.refs.todoTags, m.refs.templates,
        m.refs.chatSessions, m.refs.attachments, m.refs.thumbs,
      ]) {
        for (const h of list) referenced.add(h);
      }
      if (m.refs.settings) referenced.add(m.refs.settings);
    } catch {
      // 坏清单跳过（保守起见不清理其块）
    }
  });

  // 删除未引用块
  let removed = 0;
  for (const dir of [STORE_DATA_DIR, STORE_ATT_DIR]) {
    const chunks = await readDir(dir, Directory.Documents);
    for (const c of chunks) {
      const hash = c.name.replace(/\.(json|jpg)$/, '');
      if (!referenced.has(hash)) {
        await deleteFile(`${dir}/${c.name}`, Directory.Documents);
        removed++;
      }
    }
  }
  return removed;
}

/** ============================================================
 *  备份列表 / 删除 / 自动备份判断
 *  ============================================================ */

/**
 * 列出所有备份（索引式 + 旧 zip 合并）
 * 索引式清单是小文件，读取很快；旧 zip 较慢但已不在启动路径
 */
export async function listBackups(): Promise<BackupItem[]> {
  await ensureDir(BACKUP_DIR, Directory.Documents);
  const files = await readDir(BACKUP_DIR, Directory.Documents);
  const items: BackupItem[] = [];

  // 索引式清单（快）
  const jsonFiles = files.filter(f => f.name.endsWith('.json'));
  const indexed = await runBatch(jsonFiles, 6, async (f): Promise<BackupItem | null> => {
    try {
      const m = await readIndexedManifest(f.name);
      return {
        filename: f.name,
        path: `${BACKUP_DIR}/${f.name}`,
        manifest: indexedToCompatManifest(m),
        size: f.size,
        format: 'indexed',
      };
    } catch {
      return null; // 无法解析的文件跳过
    }
  });
  for (const item of indexed) if (item) items.push(item);

  // 旧 zip 备份（兼容展示）
  const zipFiles = files.filter(f => f.name.endsWith('.zip'));
  const legacy = await runBatch(zipFiles, 3, async (f): Promise<BackupItem | null> => {
    try {
      const result = await Filesystem.readFile({
        path: `${BACKUP_DIR}/${f.name}`,
        directory: Directory.Documents,
      });
      const zipData = result.data as string;
      const zip = await JSZip.loadAsync(zipData, { base64: true });
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) return null;
      const manifest = JSON.parse(await manifestFile.async('string')) as BackupManifest;
      return {
        filename: f.name,
        path: `${BACKUP_DIR}/${f.name}`,
        manifest,
        size: f.size,
        format: 'zip',
      };
    } catch {
      return null;
    }
  });
  for (const item of legacy) if (item) items.push(item);

  // 按时间戳降序
  items.sort((a, b) => b.manifest.timestamp - a.manifest.timestamp);
  return items;
}

/**
 * 检查今天是否已自动备份
 * 只看清单文件名（auto_YYYYMMDD_*.json），不读任何文件内容 —— 启动零开销
 */
export async function shouldAutoBackup(): Promise<boolean> {
  const files = await readDir(BACKUP_DIR, Directory.Documents);
  const today = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const ymd = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;

  return !files.some(f => {
    const parsed = parseIndexedFilename(f.name);
    return parsed !== null && parsed.type === 'auto' && parsed.yyyymmdd === ymd;
  });
}

/**
 * 删除指定备份
 * 索引式：删清单 + 垃圾回收（无人引用的块随之消失）
 * 旧 zip：直接删除文件
 */
export async function deleteBackup(filename: string): Promise<void> {
  if (filename.endsWith('.json')) {
    await deleteFile(`${BACKUP_DIR}/${filename}`, Directory.Documents);
    await gcOrphanChunks();
  } else {
    await deleteFile(`${BACKUP_DIR}/${filename}`, Directory.Documents);
  }
}

/** ============================================================
 *  恢复
 *  ============================================================ */

/**
 * 从备份恢复（自动分发索引式 / 旧 zip）
 * 恢复前自动创建当前数据的备份
 */
export async function restoreFromBackup(filename: string): Promise<RestoreResult> {
  // 1. 自动备份当前数据
  await createBackup('manual');

  if (filename.endsWith('.json')) {
    return await restoreFromIndexed(filename);
  }

  // 2. 旧 zip 路径
  const result = await Filesystem.readFile({
    path: `${BACKUP_DIR}/${filename}`,
    directory: Directory.Documents,
  });
  const zipData = result.data as string;
  const zip = await JSZip.loadAsync(zipData, { base64: true });

  // 3. 清空当前数据库并重新导入
  return await restoreFromZip(zip, true);
}

/**
 * 从索引式清单恢复（覆盖式，保留原始 id 保证块哈希稳定）
 */
async function restoreFromIndexed(filename: string): Promise<RestoreResult> {
  const result: RestoreResult = {
    entriesImported: 0, entriesSkipped: 0,
    todosImported: 0, todosSkipped: 0,
    tagsImported: 0, tagsSkipped: 0,
    groupsImported: 0, groupsSkipped: 0,
    errors: [],
  };

  const manifest = await readIndexedManifest(filename);
  const db = await getDatabase();
  const todoDb = await getTodoDatabase();

  // 并发读块
  const readChunk = async (hash: string): Promise<any | null> => {
    try {
      const res = await Filesystem.readFile({
        path: `${STORE_DATA_DIR}/${hash}.json`,
        directory: Directory.Documents,
      });
      return JSON.parse(base64ToUtf8(res.data as string));
    } catch {
      result.errors.push(`数据块缺失: ${hash.slice(0, 12)}...`);
      return null;
    }
  };

  const [entries, tags, groups, links, settings, todos, todoTags, templates, chatSessions, attachments] = await Promise.all([
    runBatch(manifest.refs.entries, 8, readChunk),
    runBatch(manifest.refs.tags, 8, readChunk),
    runBatch(manifest.refs.groups, 8, readChunk),
    runBatch(manifest.refs.links, 8, readChunk),
    manifest.refs.settings ? readChunk(manifest.refs.settings) : Promise.resolve(null),
    runBatch(manifest.refs.todos, 8, readChunk),
    runBatch(manifest.refs.todoTags, 8, readChunk),
    runBatch(manifest.refs.templates, 8, readChunk),
    runBatch(manifest.refs.chatSessions, 8, readChunk),
    runBatch(manifest.refs.attachments, 8, readChunk),
  ]);

  // === 清空现有数据（覆盖式） ===
  const existingEntries = await db.getAllEntries();
  for (const e of existingEntries) await db.deleteEntry(e.id);
  const existingTags = await db.getAllTags();
  for (const t of existingTags) await db.deleteTag(t.id);
  const existingGroups = await db.getAllGroups();
  for (const g of existingGroups) await db.deleteGroup(g.id);
  const existingLinks = await db.getAllLinks();
  for (const l of existingLinks) await db.deleteLink(l.id);
  const existingAttachments = await db.getAllAttachments();
  for (const a of existingAttachments) await db.deleteAttachment(a.id);
  await db.deleteAllChatSessions();

  const existingTodos = await todoDb.getAllTodos({ includeDeleted: true });
  for (const t of existingTodos) await todoDb.permanentDeleteTodo(t.id);
  const existingTodoTags = await todoDb.getAllTodoTags();
  for (const t of existingTodoTags) await todoDb.deleteTodoTag(t.id);
  const existingTemplates = await todoDb.getAllTemplates();
  for (const t of existingTemplates) await todoDb.deleteTemplate(t.id);

  // === 导入标签（保留原 id） ===
  for (const tag of tags) {
    if (!tag) { result.tagsSkipped++; continue; }
    try {
      await db.createTag(tag.name, {
        id: tag.id,
        isSmart: tag.isSmart,
        searchCriteria: tag.searchCriteria,
      });
      result.tagsImported++;
    } catch (err) {
      result.errors.push(`标签导入失败 ${tag.name}: ${String(err)}`);
    }
  }

  // === 导入组（保留原 id） ===
  for (const group of groups) {
    if (!group) { result.groupsSkipped++; continue; }
    try {
      await db.createGroup(group.name, { id: group.id });
      result.groupsImported++;
    } catch (err) {
      result.errors.push(`组导入失败 ${group.name}: ${String(err)}`);
    }
  }

  // === 导入条目（保留原 id + 标签关联） ===
  for (const entry of entries) {
    if (!entry) { result.entriesSkipped++; continue; }
    try {
      await db.createEntry({
        id: entry.id,
        content: entry.content,
        source: entry.source,
        groupId: entry.groupId,
        supplement: entry.supplement,
        isStarred: entry.isStarred ?? false,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        lastUsedAt: entry.lastUsedAt,
        copyCount: entry.copyCount ?? 0,
      });
      if (Array.isArray(entry.tags)) {
        for (const tag of entry.tags) {
          if (tag?.id) await db.addTagToEntry(entry.id, tag.id);
        }
      }
      result.entriesImported++;
    } catch (err) {
      result.errors.push(`条目导入失败 ${entry.id}: ${String(err)}`);
    }
  }

  // === 导入链接（保留原 id） ===
  for (const link of links) {
    if (!link) continue;
    try {
      await db.createLink(link.sourceId, link.targetId, link.description, { id: link.id });
    } catch (err) {
      result.errors.push(`链接导入失败 ${link.id}: ${String(err)}`);
    }
  }

  // === 导入设置 ===
  if (settings) {
    try {
      await db.saveSettings(settings as Settings);
    } catch (err) {
      result.errors.push(`设置导入失败: ${String(err)}`);
    }
  }

  // === 导入待办标签（保留原 id） ===
  for (const tt of todoTags) {
    if (!tt) continue;
    try {
      await todoDb.createTodoTag(tt.name, tt.color, { id: tt.id });
    } catch (err) {
      result.errors.push(`待办标签导入失败 ${tt.name}: ${String(err)}`);
    }
  }

  // === 导入待办（保留原 id + 标签关联） ===
  for (const todo of todos) {
    if (!todo) { result.todosSkipped++; continue; }
    try {
      await todoDb.createTodo({
        id: todo.id,
        title: todo.title,
        note: todo.note,
        status: todo.status || 'pending',
        startTime: todo.startTime,
        endTime: todo.endTime,
        isToday: todo.isToday ?? false,
        tagIds: todo.tagIds,
        createdAt: todo.createdAt,
        updatedAt: todo.updatedAt,
        completedAt: todo.completedAt,
        deletedAt: todo.deletedAt,
        folderDate: todo.folderDate,
      } as any);
      result.todosImported++;
    } catch (err) {
      result.errors.push(`待办导入失败 ${todo.title}: ${String(err)}`);
    }
  }

  // === 导入模板 + 条目（保留原 id） ===
  for (const twi of templates) {
    if (!twi?.template) continue;
    try {
      await todoDb.createTemplate(twi.template.name, { id: twi.template.id });
      if (Array.isArray(twi.items)) {
        for (const item of twi.items) {
          await todoDb.addTemplateItem({
            id: item.id,
            templateId: twi.template.id,
            title: item.title,
            note: item.note,
            startTime: item.startTime,
            endTime: item.endTime,
            isToday: item.isToday,
            tagIds: item.tagIds,
            sortOrder: item.sortOrder,
          } as any);
        }
      }
    } catch (err) {
      result.errors.push(`模板导入失败 ${twi.template.name}: ${String(err)}`);
    }
  }

  // === 导入对话历史 ===
  if (chatSessions && Array.isArray(chatSessions)) {
    for (const session of chatSessions) {
      if (!session) continue;
      try {
        await db.saveChatSession({
          id: session.id,
          title: session.title || '未命名对话',
          messages: session.messages || [],
          createdAt: session.createdAt || Date.now(),
          updatedAt: session.updatedAt || Date.now(),
          model: session.model,
          mcpEnabledTools: session.mcpEnabledTools,
          mcpSearchResults: session.mcpSearchResults,
        });
        result.chatSessionsImported = (result.chatSessionsImported ?? 0) + 1;
      } catch (err) {
        result.errors.push(`对话恢复失败 id=${session.id}: ${String(err)}`);
      }
    }
  }

  // === 导入附件（写缩略图文件 + 元数据，保留原 id） ===
  for (const att of attachments) {
    if (!att) continue;
    try {
      // 从块池恢复缩略图
      if (att.thumbHash) {
        try {
          const thumbRes = await Filesystem.readFile({
            path: `${STORE_ATT_DIR}/${att.thumbHash}.jpg`,
            directory: Directory.Documents,
          });
          await Filesystem.writeFile({
            path: att.thumbPath,
            data: thumbRes.data as string,
            directory: Directory.Data,
            recursive: true,
          });
        } catch (err) {
          result.errors.push(`缩略图恢复失败 att=${att.id}: ${String(err)}`);
        }
      }
      await db.addAttachment({
        id: att.id,
        entryId: att.entryId,
        filePath: att.filePath,
        thumbPath: att.thumbPath,
        mimeType: att.mimeType || 'image/jpeg',
        sortOrder: att.sortOrder ?? 0,
        createdAt: att.createdAt || Date.now(),
      });
    } catch (err) {
      result.errors.push(`附件元数据导入失败 att=${att.id}: ${String(err)}`);
    }
  }

  return result;
}

/** ============================================================
 *  全量 zip 备份（导出 / 局域网同步发送用）
 *  ============================================================ */

/**
 * 构建全量备份 zip（不落盘到备份目录）
 *
 * 原图策略：本地备份不打包原图；同步发送时通过 includeOrigIds 指定
 * 要打包的原图（接收方没有的），实现增量
 *
 * @param includeOrigIds 要打包原图的附件 id 集合（同步场景）；不传=不打包原图
 */
export async function buildBackupZip(
  type: BackupType = 'manual',
  includeOrigIds?: Set<string>,
): Promise<{ zip: JSZip; manifest: BackupManifest; filename: string }> {
  const ts = Date.now();
  const { entries, tags, groups, links, settings, allTodos, allTodoTags, templatesWithItems, allAttachments, chatSessions } = await collectBackupData();

  const manifest: BackupManifest = {
    version: '1.0',
    timestamp: ts,
    type,
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    entryCount: entries.length,
    todoCount: allTodos.length,
    tagCount: tags.length,
    groupCount: groups.length,
    appVersion: APP_VERSION,
    chatSessionCount: chatSessions.length,
  };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('entries.json', JSON.stringify(
    entries.map(e => { const { attachments, ...rest } = e; return rest; }),
    null,
    2
  ));
  zip.file('tags.json', JSON.stringify(tags, null, 2));
  zip.file('groups.json', JSON.stringify(groups, null, 2));
  zip.file('links.json', JSON.stringify(links, null, 2));
  zip.file('settings.json', JSON.stringify(settings, null, 2));
  zip.file('todos.json', JSON.stringify(allTodos, null, 2));
  zip.file('todoTags.json', JSON.stringify(allTodoTags, null, 2));
  zip.file('templates.json', JSON.stringify(templatesWithItems, null, 2));

  // 附件元数据（全量）+ 缩略图（全量）+ 原图（增量：接收方没有的）
  zip.file('attachments.json', JSON.stringify(allAttachments, null, 2));
  zip.file('chatSessions.json', JSON.stringify(chatSessions, null, 2));

  // 并发读缩略图（I/O 批处理）
  const thumbResults = await runBatch(allAttachments, 4, async (att) => {
    try {
      const thumbRes = await Filesystem.readFile({
        path: att.thumbPath,
        directory: Directory.Data,
      });
      return { att, data: thumbRes.data as string };
    } catch {
      return null; // 缩略图缺失，跳过
    }
  });
  for (const item of thumbResults) {
    if (item) zip.file(`attachments/${item.att.id}_thumb.jpg`, item.data, { base64: true });
  }

  // 原图：仅打包 includeOrigIds 指定的（同步增量场景）
  if (includeOrigIds && includeOrigIds.size > 0) {
    const origAtts = allAttachments.filter(a => includeOrigIds.has(a.id));
    const origResults = await runBatch(origAtts, 4, async (att) => {
      try {
        const origRes = await Filesystem.readFile({
          path: att.filePath,
          directory: Directory.Data,
        });
        return { att, data: origRes.data as string };
      } catch {
        return null; // 原图缺失，跳过
      }
    });
    for (const item of origResults) {
      if (item) zip.file(`attachments/${item.att.id}_orig.jpg`, item.data, { base64: true });
    }
  }

  return { zip, manifest, filename: `${formatTimestamp(ts)}.zip` };
}

/**
 * 导出备份到公共 Download 目录（全量 zip 快照）
 */
export async function exportToDownload(type: BackupType = 'manual'): Promise<BackupManifest> {
  const { zip, manifest, filename } = await buildBackupZip(type);

  // 生成 zip 为 Blob，通过 <a download> 方式触发浏览器/WebView 下载
  // 这种方式在所有平台都能正常工作：
  // - Web/Electron: 保存到 Downloads 目录
  // - Android APK: WebView 下载管理器保存到 /storage/emulated/0/Download/
  // - 不需要任何存储权限
  const zipBlobBytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
  const outName = `${filename.replace(/\.zip$/, '')}_${getDeviceId()}.zip`;

  const blob = new Blob([new Uint8Array(zipBlobBytes)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = outName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放 URL，确保下载已触发
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return manifest;
}

/** ============================================================
 *  旧 zip 恢复逻辑（接收外部 zip / 恢复旧备份，保持兼容）
 *  ============================================================ */

/**
 * 从 zip 文件增量恢复
 */
export async function restoreFromZipFile(file: File): Promise<RestoreResult> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  return await restoreFromZip(zip, false);
}

/**
 * 内部：从 zip 恢复数据
 * @param overwrite true=覆盖式，false=增量式
 */
async function restoreFromZip(zip: JSZip, overwrite: boolean): Promise<RestoreResult> {
  const result: RestoreResult = {
    entriesImported: 0, entriesSkipped: 0,
    todosImported: 0, todosSkipped: 0,
    tagsImported: 0, tagsSkipped: 0,
    groupsImported: 0, groupsSkipped: 0,
    errors: [],
  };

  const db = await getDatabase();
  const todoDb = await getTodoDatabase();

  // 读取各 JSON
  const readJson = async <T>(name: string): Promise<T | null> => {
    const f = zip.file(name);
    if (!f) return null;
    try {
      return JSON.parse(await f.async('string')) as T;
    } catch {
      result.errors.push(`${name} 解析失败`);
      return null;
    }
  };

  const entries = await readJson<any[]>('entries.json');
  const tags = await readJson<any[]>('tags.json');
  const groups = await readJson<any[]>('groups.json');
  const links = await readJson<any[]>('links.json');
  const settings = await readJson<any>('settings.json');
  const todos = await readJson<any[]>('todos.json');
  const todoTags = await readJson<any[]>('todoTags.json');
  const templates = await readJson<any[]>('templates.json');
  const chatSessions = await readJson<any[]>('chatSessions.json');

  // 覆盖式：先清空数据库
  if (overwrite) {
    // 清空条目
    const allEntries = await db.getAllEntries();
    for (const e of allEntries) {
      await db.deleteEntry(e.id);
    }
    // 清空标签
    const allTags = await db.getAllTags();
    for (const t of allTags) {
      await db.deleteTag(t.id);
    }
    // 清空组
    const allGroups = await db.getAllGroups();
    for (const g of allGroups) {
      await db.deleteGroup(g.id);
    }
    // 注意：不直接清空待办数据库，通过增量导入覆盖
  }

  // === 导入标签 ===
  const tagIdMap = new Map<string, string>(); // 旧ID -> 新ID
  if (tags) {
    const existingTags = await db.getAllTags();
    const existingNames = new Set(existingTags.map(t => t.name));

    for (const tag of tags) {
      if (existingNames.has(tag.name)) {
        const existing = existingTags.find(t => t.name === tag.name)!;
        tagIdMap.set(tag.id, existing.id);
        result.tagsSkipped++;
      } else {
        const newTag = await db.createTag(tag.name, {
          isSmart: tag.isSmart,
          searchCriteria: tag.searchCriteria,
        });
        tagIdMap.set(tag.id, newTag.id);
        result.tagsImported++;
      }
    }
  }

  // === 导入组 ===
  const groupIdMap = new Map<string, string>();
  if (groups) {
    const existingGroups = await db.getAllGroups();
    const existingNames = new Set(existingGroups.map(g => g.name));

    for (const group of groups) {
      if (existingNames.has(group.name)) {
        const existing = existingGroups.find(g => g.name === group.name)!;
        groupIdMap.set(group.id, existing.id);
        result.groupsSkipped++;
      } else {
        const newGroup = await db.createGroup(group.name);
        groupIdMap.set(group.id, newGroup.id);
        result.groupsImported++;
      }
    }
  }

  // === 导入条目 ===
  const existingHashes = overwrite ? new Set<string>() : await db.getAllContentHashes();
  // 旧 entryId -> 新 entryId 映射（供附件导入使用）
  const entryIdMap = new Map<string, string>();

  if (entries) {
    for (const entry of entries) {
      const hash = contentHash(entry.content || '');
      if (existingHashes.has(hash)) {
        result.entriesSkipped++;
        continue;
      }

      const now = Date.now();
      const newId = `${now.toString(36)}_${Math.random().toString(36).slice(2, 11)}`;

      await db.createEntry({
        id: newId,
        content: entry.content,
        source: entry.source,
        supplement: entry.supplement,
        isStarred: entry.isStarred ?? false,
        createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : now,
        updatedAt: now,
        copyCount: entry.copyCount ?? 0,
      });

      // 记录映射（旧 id -> 新 id）
      if (entry.id) entryIdMap.set(entry.id, newId);

      // 关联标签
      if (entry.tagIds && Array.isArray(entry.tagIds)) {
        for (const oldTagId of entry.tagIds) {
          const newTagId = tagIdMap.get(oldTagId);
          if (newTagId) {
            await db.addTagToEntry(newId, newTagId);
          }
        }
      }

      existingHashes.add(hash);
      result.entriesImported++;
    }
  }

  // === 导入链接 ===
  if (links && !overwrite) {
    // 增量模式下暂不导入链接（需要条目ID映射，复杂度高，暂跳过）
    // 覆盖模式下已在上面清空数据库，这里重建链接
  }

  // === 导入设置 ===
  if (settings && overwrite) {
    await db.saveSettings(settings);
  }

  // === 导入待办标签 ===
  const todoTagIdMap = new Map<string, string>();
  if (todoTags) {
    const existingTodoTags = await todoDb.getAllTodoTags();
    const existingNames = new Set(existingTodoTags.map(t => t.name));

    for (const tag of todoTags) {
      if (existingNames.has(tag.name)) {
        const existing = existingTodoTags.find(t => t.name === tag.name)!;
        todoTagIdMap.set(tag.id, existing.id);
      } else {
        const newTag = await todoDb.createTodoTag(tag.name, tag.color);
        todoTagIdMap.set(tag.id, newTag.id);
      }
    }
  }

  // === 导入待办 ===
  if (todos) {
    // 获取现有待办的内容哈希
    const existingTodos = await todoDb.getAllTodos();
    const existingTodoHashes = new Set<string>();
    for (const t of existingTodos) {
      existingTodoHashes.add(contentHash(t.title + '|' + (t.note || '')));
    }

    for (const todo of todos) {
      const hash = contentHash((todo.title || '') + '|' + (todo.note || ''));
      if (existingTodoHashes.has(hash)) {
        result.todosSkipped++;
        continue;
      }

      const now = Date.now();
      const newId = `${now.toString(36)}_${Math.random().toString(36).slice(2, 11)}`;

      await todoDb.createTodo({
        id: newId,
        title: todo.title,
        note: todo.note,
        folderDate: todo.folderDate,
        time: todo.time,
        isDone: todo.isDone ?? false,
        isToday: todo.isToday ?? false,
        createdAt: todo.createdAt || now,
        updatedAt: now,
        completedAt: todo.completedAt,
        tagIds: todo.tagIds,
      } as any);

      existingTodoHashes.add(hash);
      result.todosImported++;
    }
  }

  // === 导入模板 ===
  if (templates) {
    const existingTemplates = await todoDb.getAllTemplates();
    const existingTplNames = new Set(existingTemplates.map(t => t.name));

    for (const item of templates) {
      const tpl = item.template;
      if (!tpl || existingTplNames.has(tpl.name)) continue;

      const newTpl = await todoDb.createTemplate(tpl.name);
      if (item.items && Array.isArray(item.items)) {
        for (const tplItem of item.items) {
          await todoDb.addTemplateItem({
            templateId: newTpl.id,
            title: tplItem.title,
            note: tplItem.note,
            time: tplItem.time,
            startTime: tplItem.startTime,
            endTime: tplItem.endTime,
            isToday: tplItem.isToday,
            sortOrder: tplItem.sortOrder,
          } as any);
        }
      }
    }
  }

  // === 导入附件（元数据 + 缩略图全量；原图从 zip 写入或补齐） ===
  const attachmentsJson = await readJson<any[]>('attachments.json');
  if (attachmentsJson && Array.isArray(attachmentsJson)) {
    // 本地已有附件 id 集合 + attId -> 本地附件映射（用于补原图）
    const existingAtts = await db.getAllAttachments();
    const existingAttIds = new Set(existingAtts.map(a => a.id));
    const existingAttMap = new Map(existingAtts.map(a => [a.id, a] as const));

    for (const att of attachmentsJson) {
      // 尝试从 zip 读取原图（本地备份 zip 不含原图，同步 zip 才有）
      const origFile = zip.file(`attachments/${att.id}_orig.jpg`);

      if (!existingAttIds.has(att.id)) {
        // === 新附件：写缩略图 + 原图（如有）+ 写 DB ===
        // 通过 entryId 映射找到新 entryId
        // 覆盖式恢复下 entryIdMap 可能为空（旧 id 已不可考），此时跳过附件
        const newEntryId = entryIdMap.get(att.entryId);
        if (!newEntryId) continue;

        const thumbFile = zip.file(`attachments/${att.id}_thumb.jpg`);
        if (!thumbFile) continue;

        let thumbBase64: string;
        try {
          thumbBase64 = await thumbFile.async('base64');
        } catch {
          continue;
        }

        // 用源附件 id 作为文件名，跨设备一致
        const dir = `attachments/${newEntryId}`;
        const thumbPath = `${dir}/${att.id}_thumb.jpg`;
        const filePath = `${dir}/${att.id}_orig.jpg`;

        // 写缩略图
        try {
          await Filesystem.writeFile({
            path: thumbPath,
            data: thumbBase64,
            directory: Directory.Data,
            recursive: true,
          });
        } catch (err) {
          result.errors.push(`附件缩略图写入失败 att=${att.id}: ${String(err)}`);
          continue;
        }

        // 写原图（如果 zip 里有）
        if (origFile) {
          try {
            const origBase64 = await origFile.async('base64');
            await Filesystem.writeFile({
              path: filePath,
              data: origBase64,
              directory: Directory.Data,
              recursive: true,
            });
          } catch (err) {
            result.errors.push(`附件原图写入失败 att=${att.id}: ${String(err)}`);
          }
        }

        // 写 DB（复用源附件 id，保证跨设备一致）
        try {
          await db.addAttachment({
            id: att.id,
            entryId: newEntryId,
            filePath,
            thumbPath,
            mimeType: att.mimeType || 'image/jpeg',
            sortOrder: att.sortOrder ?? 0,
            createdAt: att.createdAt || Date.now(),
          });
          existingAttIds.add(att.id);
        } catch (err) {
          result.errors.push(`附件写入数据库失败 att=${att.id}: ${String(err)}`);
        }
      } else {
        // === 已有附件：补原图（本地没有但 zip 有） ===
        if (!origFile) continue;
        const localAtt = existingAttMap.get(att.id);
        if (!localAtt) continue;

        // 检查本地是否已有原图（内联检查，避免依赖 syncService 造成循环引用）
        let hasOrig = true;
        try {
          await Filesystem.readFile({
            path: localAtt.filePath,
            directory: Directory.Data,
          });
        } catch {
          hasOrig = false;
        }

        if (!hasOrig) {
          try {
            const origBase64 = await origFile.async('base64');
            await Filesystem.writeFile({
              path: localAtt.filePath,
              data: origBase64,
              directory: Directory.Data,
              recursive: true,
            });
          } catch (err) {
            result.errors.push(`附件原图补齐失败 att=${att.id}: ${String(err)}`);
          }
        }
      }
    }
  }

  // v2.0.0: 恢复对话历史
  if (chatSessions && Array.isArray(chatSessions)) {
    const existingSessions = await db.getAllChatSessions();
    const existingIds = new Set(existingSessions.map(s => s.id));
    for (const session of chatSessions) {
      if (existingIds.has(session.id)) {
        result.chatSessionsSkipped = (result.chatSessionsSkipped ?? 0) + 1;
        continue;
      }
      try {
        await db.saveChatSession({
          id: session.id,
          title: session.title || '未命名对话',
          messages: session.messages || [],
          createdAt: session.createdAt || Date.now(),
          updatedAt: session.updatedAt || Date.now(),
          model: session.model,
          mcpEnabledTools: session.mcpEnabledTools,
          mcpSearchResults: session.mcpSearchResults,
        });
        result.chatSessionsImported = (result.chatSessionsImported ?? 0) + 1;
      } catch (err) {
        result.errors.push(`对话恢复失败 id=${session.id}: ${String(err)}`);
      }
    }
  }

  return result;
}

/** ============================================================
 *  Zip 文件读取工具
 *  ============================================================ */

/**
 * 读取 zip 文件并解析 manifest（用于选择文件时预览）
 */
export async function readZipManifest(file: File): Promise<BackupManifest | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) return null;
    return JSON.parse(await manifestFile.async('string')) as BackupManifest;
  } catch {
    return null;
  }
}

/**
 * 保存接收到的 zip 数据到备份目录
 * @param base64Data zip 的 base64 数据
 * @param filename 文件名
 */
export async function saveReceivedZip(base64Data: string, filename: string): Promise<string> {
  await ensureDir(BACKUP_DIR, Directory.Documents);
  await Filesystem.writeFile({
    path: `${BACKUP_DIR}/${filename}`,
    data: base64Data,
    directory: Directory.Documents,
    recursive: true,
  });
  return `${BACKUP_DIR}/${filename}`;
}

/**
 * 从 base64 zip 数据恢复
 */
export async function restoreFromBase64Zip(base64Data: string): Promise<RestoreResult> {
  const zip = await JSZip.loadAsync(base64Data, { base64: true });
  return await restoreFromZip(zip, false);
}
