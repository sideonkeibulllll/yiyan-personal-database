/**
 * 备份与恢复服务
 *
 * 功能：
 * 1. 创建备份副本（私有目录）和导出到公共目录
 * 2. 列出/删除备份副本
 * 3. 从副本覆盖式恢复（恢复前自动备份）
 * 4. 从 zip 文件增量恢复（按内容哈希跳过相同条目）
 *
 * 目录约定：
 * - 私有备份目录：应用 Documents/backups/
 * - 公共导出目录：Download/yiyan-backup/
 */
import JSZip from 'jszip';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from './filesystemAdapter';
import { getDatabase } from './database';
import { getTodoDatabase } from './todoDatabase';
import { contentHash } from '@/features/datamanager/types';
import type {
  BackupManifest,
  BackupItem,
  BackupType,
  RestoreResult,
} from './backupTypes';

const BACKUP_DIR = 'backups';
const EXPORT_DIR = 'yiyan-backup';
const APP_VERSION = '1.4.0';

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

/** 格式化时间戳为文件名：backup_20260723_162200 */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `backup_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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

/** ============================================================
 *  备份创建
 *  ============================================================ */

/**
 * 创建完整备份 zip
 * 包含：database.db（JSON 形式导出所有数据）+ config + tags + groups + manifest
 *
 * 原图策略：本地备份不打包原图（原图文件就在本地文件系统，恢复数据库记录后 filePath 仍指向已有文件）；
 *           同步发送时通过 includeOrigIds 指定要打包的原图（接收方没有的），实现增量。
 *
 * @param includeOrigIds 要打包原图的附件 id 集合（同步场景：接收方没有的 att id）
 *                      缩略图和元数据始终全量打包；不传=不打包任何原图（本地备份场景）
 */
export async function createBackup(
  type: BackupType = 'manual',
  includeOrigIds?: Set<string>,
): Promise<BackupManifest> {
  const ts = Date.now();
  const db = await getDatabase();
  const todoDb = await getTodoDatabase();

  // 确保数据库连接健康（手机端 Capacitor SQLite 连接可能不稳定）
  await (db as any).ensureConnection?.();
  await (todoDb as any).ensureConnection?.();

  // 收集所有数据
  const [entries, tags, groups, settings, allTodos, allTodoTags, allTemplates, allAttachments] = await Promise.all([
    db.getAllEntries(),
    db.getAllTags(),
    db.getAllGroups(),
    db.getSettings(),
    todoDb.getAllTodos(),
    todoDb.getAllTodoTags(),
    todoDb.getAllTemplates(),
    db.getAllAttachments(),
  ]);

  // 收集所有条目的关联链接
  const links = [];
  for (const entry of entries) {
    const entryLinks = await db.getLinksByEntryId(entry.id);
    links.push(...entryLinks);
  }

  // 收集每个模板的 items
  const templatesWithItems = [];
  for (const tpl of allTemplates) {
    const items = await todoDb.getTemplateItems(tpl.id);
    templatesWithItems.push({ template: tpl, items });
  }

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
  };

  // 打包 zip
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  // entries.json 中剥离 attachments（独立打到 attachments.json，避免冗余）
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

  // 附件元数据（全量）+ 缩略图（全量）+ 原图（增量：排除接收方已有的）
  zip.file('attachments.json', JSON.stringify(allAttachments, null, 2));
  for (const att of allAttachments) {
    // 缩略图：全量打包（体积小，新设备需要）
    try {
      const thumbRes = await Filesystem.readFile({
        path: att.thumbPath,
        directory: Directory.Data,
      });
      zip.file(`attachments/${att.id}_thumb.jpg`, thumbRes.data, { base64: true });
    } catch (err) {
      // 缩略图读取失败（可能已被删除），跳过
      console.warn(`[backup] 缩略图读取失败 att=${att.id}:`, err);
    }

    // 原图：仅打包 includeOrigIds 指定的（同步场景=接收方没有的 att id）
    // 不传 includeOrigIds 时（本地备份）不打包任何原图，省空间
    if (!includeOrigIds || !includeOrigIds.has(att.id)) continue;
    try {
      const origRes = await Filesystem.readFile({
        path: att.filePath,
        directory: Directory.Data,
      });
      zip.file(`attachments/${att.id}_orig.jpg`, origRes.data, { base64: true });
    } catch (err) {
      // 原图读取失败（按需拉取未完成/文件缺失），跳过
      console.warn(`[backup] 原图读取失败 att=${att.id}:`, err);
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  const filename = `${formatTimestamp(ts)}.zip`;

  // 保存到私有备份目录
  await ensureDir(BACKUP_DIR, Directory.Documents);
  await Filesystem.writeFile({
    path: `${BACKUP_DIR}/${filename}`,
    data: zipBlob,
    directory: Directory.Documents,
    recursive: true,
  });

  // 清理旧备份
  await pruneOldBackups(type);

  return manifest;
}

/**
 * 导出备份到公共 Download 目录
 */
export async function exportToDownload(type: BackupType = 'manual'): Promise<BackupManifest> {
  const ts = Date.now();
  const db = await getDatabase();
  const todoDb = await getTodoDatabase();

  // 确保数据库连接健康（手机端 Capacitor SQLite 连接可能不稳定）
  await (db as any).ensureConnection?.();
  await (todoDb as any).ensureConnection?.();

  const [entries, tags, groups, settings, allTodos, allTodoTags, allTemplates, allAttachments] = await Promise.all([
    db.getAllEntries(),
    db.getAllTags(),
    db.getAllGroups(),
    db.getSettings(),
    todoDb.getAllTodos(),
    todoDb.getAllTodoTags(),
    todoDb.getAllTemplates(),
    db.getAllAttachments(),
  ]);

  const links = [];
  for (const entry of entries) {
    const entryLinks = await db.getLinksByEntryId(entry.id);
    links.push(...entryLinks);
  }

  const templatesWithItems = [];
  for (const tpl of allTemplates) {
    const items = await todoDb.getTemplateItems(tpl.id);
    templatesWithItems.push({ template: tpl, items });
  }

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

  // 附件元数据 + 缩略图（原图不打包，按需拉取）
  zip.file('attachments.json', JSON.stringify(allAttachments, null, 2));
  for (const att of allAttachments) {
    try {
      const thumbRes = await Filesystem.readFile({
        path: att.thumbPath,
        directory: Directory.Data,
      });
      zip.file(`attachments/${att.id}_thumb.jpg`, thumbRes.data, { base64: true });
    } catch (err) {
      console.warn(`[export] 缩略图读取失败 att=${att.id}:`, err);
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  const filename = `${formatTimestamp(ts)}_${getDeviceId()}.zip`;

  await ensureDir(EXPORT_DIR, Directory.External);
  await Filesystem.writeFile({
    path: `${EXPORT_DIR}/${filename}`,
    data: zipBlob,
    directory: Directory.External,
    recursive: true,
  });

  return manifest;
}

/** ============================================================
 *  备份列表管理
 *  ============================================================ */

/**
 * 列出所有备份副本
 */
export async function listBackups(): Promise<BackupItem[]> {
  await ensureDir(BACKUP_DIR, Directory.Documents);
  const files = await readDir(BACKUP_DIR, Directory.Documents);

  const items: BackupItem[] = [];

  for (const file of files) {
    if (!file.name.endsWith('.zip')) continue;

    try {
      const result = await Filesystem.readFile({
        path: `${BACKUP_DIR}/${file.name}`,
        directory: Directory.Documents,
      });
      const zipData = result.data as string;
      const zip = await JSZip.loadAsync(zipData, { base64: true });
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) continue;

      const manifestText = await manifestFile.async('string');
      const manifest = JSON.parse(manifestText) as BackupManifest;

      items.push({
        filename: file.name,
        path: `${BACKUP_DIR}/${file.name}`,
        manifest,
        size: file.size,
      });
    } catch {
      // 跳过无法读取的文件
    }
  }

  // 按时间戳降序
  items.sort((a, b) => b.manifest.timestamp - a.manifest.timestamp);
  return items;
}

/**
 * 删除指定备份
 */
export async function deleteBackup(filename: string): Promise<void> {
  await deleteFile(`${BACKUP_DIR}/${filename}`, Directory.Documents);
}

/**
 * 清理过期备份
 * - 自动备份：最多保留 14 份
 * - 手动备份：最多保留 10 份
 */
async function pruneOldBackups(type: BackupType): Promise<void> {
  const all = await listBackups();
  const filtered = all.filter(item => item.manifest.type === type);
  const limit = type === 'auto' ? 14 : 10;

  if (filtered.length >= limit) {
    // 按时间戳升序，删除最旧的
    const sorted = [...filtered].sort((a, b) => a.manifest.timestamp - b.manifest.timestamp);
    const toDelete = sorted.slice(0, sorted.length - limit + 1);
    for (const item of toDelete) {
      await deleteBackup(item.filename);
    }
  }
}

/**
 * 检查今天是否已自动备份
 */
export async function shouldAutoBackup(): Promise<boolean> {
  const all = await listBackups();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  const todayAuto = all.find(item =>
    item.manifest.type === 'auto' && item.manifest.timestamp >= todayStart
  );

  return !todayAuto;
}

/** ============================================================
 *  恢复
 *  ============================================================ */

/**
 * 从备份副本覆盖式恢复
 * 恢复前自动创建当前数据的备份
 */
export async function restoreFromBackup(filename: string): Promise<RestoreResult> {
  // 1. 自动备份当前数据
  await createBackup('manual');

  // 2. 读取备份文件
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
