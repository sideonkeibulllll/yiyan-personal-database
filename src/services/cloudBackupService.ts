/**
 * 云端备份服务（Cloudflare D1 + R2）
 *
 * v2.2.0 重构：
 * - 连接层改为函数式调用（d1Query / r2PutBase64Image 等）
 * - 配置硬编码到 config/cloudflare.ts，不再从 localStorage 读取
 * - 原生端用 CapacitorHttp 绕过 CORS
 * - testConnection 轻量化
 *
 * 功能：
 * 1. 增量备份本地数据到 D1（文本）+ R2（附件）
 * 2. 从云端恢复数据到本地（合并模式，跳过已存在 hash）
 * 3. 测试连接
 *
 * 增量策略：
 * - 首次备份：D1 空库 → 全量导入（自然全量）
 * - 后续备份：按 updated_at > last_backup_ts 增量上传
 * - 删除同步：本地删除的条目在 D1 标记 is_deleted=1
 */
import {
  d1Query,
  d1BatchExec,
  d1BatchInsert,
  d1InitSchema,
  d1InitSchemaOnce,
  d1GetSyncState,
  d1SetSyncState,
  d1TestConnection,
} from './d1Client';
import {
  r2PutBase64Image,
  r2GetBase64,
  r2TestConnection,
} from './r2Client';
import { getDatabase } from './database';
import { getTodoDatabase } from './todoDatabase';
import { Filesystem, Directory } from './filesystemAdapter';
import { contentHash } from '@/features/datamanager/types';
import {
  R2_ATTACHMENT_PREFIX,
} from './cloudBackupTypes';
import type {
  CloudBackupResult,
  CloudRestoreResult,
} from './cloudBackupTypes';

const APP_VERSION = '2.6.0';
const SYNC_STATE_KEY = 'last_backup_ts';

/** 并发批处理（限制并发数，避免一次性发起过多 I/O） */
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

/** ============ 测试连接 ============ */

export async function testCloudConnection(): Promise<{ d1: string; r2: string; ok: boolean }> {
  const [d1Result, r2Result] = await Promise.all([
    d1TestConnection(),
    r2TestConnection(),
  ]);

  return {
    d1: d1Result.message,
    r2: r2Result.message,
    ok: d1Result.ok && r2Result.ok,
  };
}

/** ============ 备份 ============ */

/**
 * 执行增量备份到云端
 *
 * v2.3.0 性能重构：
 * - 所有逐条 `await d1Query` 改为 `d1BatchInsert`（并发 10），网络往返次数不变但**并行**发出
 * - 消除 N+1：links / templateItems 一次性取回后内存分组
 * - `d1InitSchema` → `d1InitSchemaOnce`，建表只在首次执行
 */
export async function backupToCloud(): Promise<CloudBackupResult> {
  const startTime = Date.now();
  const result: CloudBackupResult = {
    batchId: `backup_${Date.now()}`,
    timestamp: startTime,
    entriesSynced: 0,
    todosSynced: 0,
    tagsSynced: 0,
    groupsSynced: 0,
    linksSynced: 0,
    templatesSynced: 0,
    attachmentsUploaded: 0,
    deletionsSynced: 0,
    duration: 0,
    errors: [],
  };

  const db = await getDatabase();
  const todoDb = await getTodoDatabase();

  // 确保数据库连接健康
  await (db as any).ensureConnection?.();
  await (todoDb as any).ensureConnection?.();

  // 确保 D1 表结构存在（进程内只执行一次，不再每次备份重复建表）
  await d1InitSchemaOnce();

  // 读取上次备份时间戳（首次备份时为 0 → 全量）
  const lastBackupTsStr = await d1GetSyncState(SYNC_STATE_KEY);
  const lastBackupTs = lastBackupTsStr ? parseInt(lastBackupTsStr, 10) : 0;

  // 收集本地数据（含 links / templateItems，避免逐条查询的 N+1）
  const [
    entries, tags, groups, allTodos, allTodoTags, allTemplates, allAttachments,
    links, allTemplateItems,
  ] = await Promise.all([
    db.getAllEntries(),
    db.getAllTags(),
    db.getAllGroups(),
    todoDb.getAllTodos(),
    todoDb.getAllTodoTags(),
    todoDb.getAllTemplates(),
    db.getAllAttachments(),
    db.getAllLinks(),
    todoDb.getAllTemplateItems(),
  ]);

  // 模板条目内存分组（替代逐模板查询）
  const itemsByTemplate = new Map<string, typeof allTemplateItems>();
  for (const item of allTemplateItems) {
    const list = itemsByTemplate.get(item.templateId) || [];
    list.push(item);
    itemsByTemplate.set(item.templateId, list);
  }

  // ===== 同步 entries（增量：updated_at > lastBackupTs）=====
  const changedEntries = entries.filter(e => e.updatedAt > lastBackupTs);
  const entryParams: any[][] = [];
  const entryTagSql = 'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)';
  const entryTagParams: any[][] = [];
  const entryTagClearParams: any[][] = [];

  for (const entry of changedEntries) {
    entryParams.push([
      entry.id,
      entry.content,
      entry.source || null,
      entry.supplement || null,
      entry.isStarred ? 1 : 0,
      entry.createdAt,
      entry.updatedAt,
      entry.copyCount || 0,
      contentHash(entry.content || ''),
      result.batchId,
    ]);
    if (entry.tags && entry.tags.length > 0) {
      entryTagClearParams.push([entry.id]);
      for (const tag of entry.tags) {
        entryTagParams.push([entry.id, tag.id]);
      }
    }
  }

  try {
    await d1BatchInsert(
      `INSERT OR REPLACE INTO entries
       (id, content, source, supplement, is_starred, is_deleted, created_at, updated_at, copy_count, content_hash, backup_batch_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      entryParams,
    );
    result.entriesSynced = entryParams.length;
  } catch (err) {
    result.errors.push(`entries 批量同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (entryTagClearParams.length > 0) {
    await d1BatchInsert('DELETE FROM entry_tags WHERE entry_id = ?', entryTagClearParams);
    await d1BatchInsert(entryTagSql, entryTagParams);
  }

  // ===== 同步 tags（增量：createdAt > lastBackupTs）=====
  const newTags = tags.filter(t => t.createdAt > lastBackupTs);
  try {
    await d1BatchInsert(
      `INSERT OR REPLACE INTO tags
       (id, name, color, is_smart, search_criteria, is_deleted, created_at, updated_at, backup_batch_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      newTags.map(tag => [
        tag.id,
        tag.name,
        tag.color || null,
        tag.isSmart ? 1 : 0,
        tag.searchCriteria ? JSON.stringify(tag.searchCriteria) : null,
        tag.createdAt,
        Date.now(),
        result.batchId,
      ]),
    );
    result.tagsSynced = newTags.length;
  } catch (err) {
    result.errors.push(`tags 批量同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ===== 同步 groups（增量：D1 中不存在的新 group）=====
  const existingGroupIds = new Set<string>(
    (await d1Query('SELECT id FROM groups_table WHERE is_deleted = 0', [])).map((r: any) => r.id)
  );
  const newGroups = groups.filter(g => !existingGroupIds.has(g.id));
  try {
    await d1BatchInsert(
      `INSERT OR REPLACE INTO groups_table
       (id, name, sort_order, is_deleted, backup_batch_id)
       VALUES (?, ?, ?, 0, ?)`,
      newGroups.map(group => [group.id, group.name, group.sortOrder || 0, result.batchId]),
    );
    result.groupsSynced = newGroups.length;
  } catch (err) {
    result.errors.push(`groups 批量同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ===== 同步 links（增量：createdAt > lastBackupTs）=====
  const newLinks = links.filter(l => l.createdAt > lastBackupTs);
  try {
    await d1BatchInsert(
      `INSERT OR REPLACE INTO links
       (id, source_id, target_id, description, is_deleted, created_at, backup_batch_id)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      newLinks.map(link => [
        link.id, link.sourceId, link.targetId, link.description || null,
        link.createdAt, result.batchId,
      ]),
    );
    result.linksSynced = newLinks.length;
  } catch (err) {
    result.errors.push(`links 批量同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ===== 同步 todos =====
  const changedTodos = allTodos.filter(t => (t.updatedAt || t.createdAt) > lastBackupTs);
  try {
    await d1BatchInsert(
      `INSERT OR REPLACE INTO todos
       (id, title, note, folder_date, time, is_done, is_today, is_deleted, created_at, updated_at, completed_at, backup_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      changedTodos.map(todo => [
        todo.id,
        todo.title,
        todo.note || null,
        todo.folderDate || null,
        todo.startTime != null ? String(todo.startTime) : null,
        todo.status === 'done' ? 1 : 0,
        todo.isToday ? 1 : 0,
        todo.createdAt,
        todo.updatedAt || todo.createdAt,
        todo.completedAt || null,
        result.batchId,
      ]),
    );
    result.todosSynced = changedTodos.length;
  } catch (err) {
    result.errors.push(`todos 批量同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ===== 同步 todo tags（增量：createdAt > lastBackupTs）=====
  const newTodoTags = allTodoTags.filter(tt => tt.createdAt > lastBackupTs);
  try {
    await d1BatchInsert(
      `INSERT OR REPLACE INTO todo_tags
       (id, name, color, is_deleted, backup_batch_id)
       VALUES (?, ?, ?, 0, ?)`,
      newTodoTags.map(tt => [tt.id, tt.name, tt.color || null, result.batchId]),
    );
  } catch (err) {
    result.errors.push(`todo_tags 批量同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ===== 同步 templates + items（items 一次性取回，无 N+1）=====
  const changedTemplateIds = new Set(
    allTemplates.filter(t => t.updatedAt > lastBackupTs).map(t => t.id)
  );
  const changedTemplates = allTemplates.filter(t => changedTemplateIds.has(t.id));
  const templateItemParams: any[][] = [];
  const existingItemIds = new Set<string>(
    (await d1Query('SELECT id FROM template_items', [])).map((r: any) => r.id)
  );
  for (const tpl of changedTemplates) {
    const items = itemsByTemplate.get(tpl.id) || [];
    for (const item of items) {
      if (existingItemIds.has(item.id)) continue;
      templateItemParams.push([
        item.id, tpl.id, item.title || null, item.note || null,
        item.startTime != null ? String(item.startTime) : null,
        item.sortOrder || 0, result.batchId,
      ]);
    }
  }
  try {
    await d1BatchInsert(
      `INSERT OR REPLACE INTO templates
       (id, name, is_deleted, backup_batch_id)
       VALUES (?, ?, 0, ?)`,
      changedTemplates.map(t => [t.id, t.name, result.batchId]),
    );
    result.templatesSynced = changedTemplates.length;
    await d1BatchInsert(
      `INSERT OR REPLACE INTO template_items
       (id, template_id, title, note, time, sort_order, backup_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      templateItemParams,
    );
  } catch (err) {
    result.errors.push(`templates 批量同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ===== 同步附件到 R2 + D1 元数据 =====
  const existingAttRows = await d1Query('SELECT id FROM attachments_meta WHERE is_deleted = 0', []);
  const existingAttIds = new Set(existingAttRows.map((r: any) => r.id));

  const attMetaParams: any[][] = [];
  const newAtts = allAttachments.filter(att => !existingAttIds.has(att.id));

  // 并发读本地附件文件（I/O 大头，先并行读出来）
  await runBatch(newAtts, 4, async (att) => {
    const r2KeyOrig = `${R2_ATTACHMENT_PREFIX}${att.id}_orig.jpg`;
    const r2KeyThumb = `${R2_ATTACHMENT_PREFIX}${att.id}_thumb.jpg`;
    try {
      const [origRes, thumbRes] = await Promise.all([
        Filesystem.readFile({ path: att.filePath, directory: Directory.Data }).catch(() => null),
        Filesystem.readFile({ path: att.thumbPath, directory: Directory.Data }).catch(() => null),
      ]);
      // 原图 + 缩略图并发上传
      await Promise.all([
        origRes
          ? r2PutBase64Image(r2KeyOrig, origRes.data as string, att.mimeType || 'image/jpeg')
              .catch(() => result.errors.push(`附件原图上传失败 att=${att.id}`))
          : Promise.resolve().then(() => result.errors.push(`附件原图缺失 att=${att.id}, 跳过上传`)),
        thumbRes
          ? r2PutBase64Image(r2KeyThumb, thumbRes.data as string, att.mimeType || 'image/jpeg')
              .catch(() => result.errors.push(`附件缩略图上传失败 att=${att.id}`))
          : Promise.resolve().then(() => result.errors.push(`附件缩略图缺失 att=${att.id}, 跳过上传`)),
      ]);
      result.attachmentsUploaded++;
    } catch (err) {
      result.errors.push(`attachment ${att.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // 全量附件元数据批量写 D1
  for (const att of allAttachments) {
    attMetaParams.push([
      att.id,
      att.entryId,
      `${R2_ATTACHMENT_PREFIX}${att.id}_orig.jpg`,
      `${R2_ATTACHMENT_PREFIX}${att.id}_thumb.jpg`,
      att.mimeType || 'image/jpeg',
      att.sortOrder || 0,
      att.createdAt,
      result.batchId,
    ]);
  }
  try {
    await d1BatchInsert(
      `INSERT OR REPLACE INTO attachments_meta
       (id, entry_id, r2_key_orig, r2_key_thumb, mime_type, sort_order, is_deleted, created_at, backup_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      attMetaParams,
    );
  } catch (err) {
    result.errors.push(`attachments_meta 批量同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ===== 同步删除（软删）=====
  const [d1EntryIds, d1TodoIds] = await Promise.all([
    d1Query('SELECT id FROM entries WHERE is_deleted = 0', []),
    d1Query('SELECT id FROM todos WHERE is_deleted = 0', []),
  ]);
  const localEntryIds = new Set(entries.map(e => e.id));
  const localTodoIds = new Set(allTodos.map(t => t.id));
  const delEntryParams = d1EntryIds.filter((r: any) => !localEntryIds.has(r.id)).map((r: any) => [r.id]);
  const delTodoParams = d1TodoIds.filter((r: any) => !localTodoIds.has(r.id)).map((r: any) => [r.id]);
  if (delEntryParams.length > 0) {
    await d1BatchInsert('UPDATE entries SET is_deleted = 1 WHERE id = ?', delEntryParams);
  }
  if (delTodoParams.length > 0) {
    await d1BatchInsert('UPDATE todos SET is_deleted = 1 WHERE id = ?', delTodoParams);
  }
  result.deletionsSynced = delEntryParams.length + delTodoParams.length;

  // ===== 写入备份 manifest =====
  await d1Query(
    `INSERT INTO _backup_manifests
     (id, timestamp, type, entry_count, todo_count, tag_count, group_count, attachment_count, app_version, created_at)
     VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)`,
    [
      result.batchId,
      startTime,
      entries.length,
      allTodos.length,
      tags.length,
      groups.length,
      allAttachments.length,
      APP_VERSION,
      Date.now(),
    ]
  );

  // ===== 同步对话历史（批量）=====
  const localChatSessions = await db.getAllChatSessions();
  const changedSessions = localChatSessions.filter(s => s.updatedAt > lastBackupTs);
  try {
    await d1BatchInsert(
      `INSERT OR REPLACE INTO chat_sessions (id, title, messages, model, mcp_enabled_tools, mcp_search_results, created_at, updated_at, backup_batch_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      changedSessions.map(session => [
        session.id,
        session.title,
        JSON.stringify(session.messages),
        session.model || null,
        session.mcpEnabledTools ? JSON.stringify(session.mcpEnabledTools) : null,
        session.mcpSearchResults ? JSON.stringify(session.mcpSearchResults) : null,
        session.createdAt,
        session.updatedAt,
        result.batchId,
      ]),
    );
  } catch (err) {
    result.errors.push(`chat_sessions 批量同步失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ===== 更新同步状态 =====
  await d1SetSyncState(SYNC_STATE_KEY, String(startTime));

  result.duration = Date.now() - startTime;
  return result;
}

/** ============ 恢复 ============ */

/**
 * 从云端恢复数据到本地（合并模式）
 */
export async function restoreFromCloud(): Promise<CloudRestoreResult> {
  const startTime = Date.now();
  const result: CloudRestoreResult = {
    entriesPulled: 0,
    entriesSkipped: 0,
    todosPulled: 0,
    todosSkipped: 0,
    tagsPulled: 0,
    groupsPulled: 0,
    linksPulled: 0,
    templatesPulled: 0,
    attachmentsDownloaded: 0,
    duration: 0,
    errors: [],
  };

  const db = await getDatabase();
  const todoDb = await getTodoDatabase();

  await (db as any).ensureConnection?.();
  await (todoDb as any).ensureConnection?.();

  // 确保表结构
  await d1InitSchemaOnce();

  // ===== 拉取所有未删除的 entries =====
  const d1Entries = await d1Query('SELECT * FROM entries WHERE is_deleted = 0', []);
  const existingHashes = await db.getAllContentHashes();

  for (const row of d1Entries) {
    const hash = row.content_hash;
    if (hash && existingHashes.has(hash)) {
      result.entriesSkipped++;
      continue;
    }

    try {
      const now = Date.now();
      const newId = `${now.toString(36)}_${Math.random().toString(36).slice(2, 11)}`;

      await db.createEntry({
        id: newId,
        content: row.content,
        source: row.source || undefined,
        supplement: row.supplement || undefined,
        isStarred: row.is_starred === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        copyCount: row.copy_count || 0,
      });
      existingHashes.add(hash);
      result.entriesPulled++;
    } catch (err) {
      result.errors.push(`restore entry ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 拉取 tags =====
  const d1Tags = await d1Query('SELECT * FROM tags WHERE is_deleted = 0', []);
  const existingTagNames = new Set((await db.getAllTags()).map(t => t.name));

  for (const row of d1Tags) {
    if (existingTagNames.has(row.name)) continue;
    try {
      await db.createTag(row.name, {
        isSmart: row.is_smart === 1,
        searchCriteria: row.search_criteria ? JSON.parse(row.search_criteria) : undefined,
      });
      result.tagsPulled++;
    } catch (err) {
      result.errors.push(`restore tag ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 拉取 groups =====
  const d1Groups = await d1Query('SELECT * FROM groups_table WHERE is_deleted = 0', []);
  const existingGroupNames = new Set((await db.getAllGroups()).map(g => g.name));

  for (const row of d1Groups) {
    if (existingGroupNames.has(row.name)) continue;
    try {
      await db.createGroup(row.name);
      result.groupsPulled++;
    } catch (err) {
      result.errors.push(`restore group ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 拉取 links =====
  const d1Links = await d1Query('SELECT * FROM links WHERE is_deleted = 0', []);
  for (const row of d1Links) {
    try {
      await db.createLink(row.source_id, row.target_id, row.description || undefined);
      result.linksPulled++;
    } catch {
      // 链接的源/目标可能不存在，跳过
    }
  }

  // ===== 拉取 todos =====
  const d1Todos = await d1Query('SELECT * FROM todos WHERE is_deleted = 0', []);
  const existingTodos = await todoDb.getAllTodos();
  const existingTodoHashes = new Set<string>();
  for (const t of existingTodos) {
    existingTodoHashes.add(contentHash(t.title + '|' + (t.note || '')));
  }

  for (const row of d1Todos) {
    const hash = contentHash((row.title || '') + '|' + (row.note || ''));
    if (existingTodoHashes.has(hash)) {
      result.todosSkipped++;
      continue;
    }

    try {
      const now = Date.now();
      const newId = `${now.toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
      await todoDb.createTodo({
        id: newId,
        title: row.title,
        note: row.note,
        folderDate: row.folder_date || '',
        startTime: row.time ? parseInt(row.time, 10) : undefined,
        status: row.is_done === 1 ? 'done' : 'pending',
        isToday: row.is_today === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
      } as any);
      existingTodoHashes.add(hash);
      result.todosPulled++;
    } catch (err) {
      result.errors.push(`restore todo ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 拉取 templates =====
  const d1Templates = await d1Query('SELECT * FROM templates WHERE is_deleted = 0', []);
  const existingTplNames = new Set((await todoDb.getAllTemplates()).map(t => t.name));

  for (const row of d1Templates) {
    if (existingTplNames.has(row.name)) continue;
    try {
      const newTpl = await todoDb.createTemplate(row.name);
      const items = await d1Query(
        'SELECT * FROM template_items WHERE template_id = ? ORDER BY sort_order',
        [row.id]
      );
      for (const item of items) {
        await todoDb.addTemplateItem({
          templateId: newTpl.id,
          title: item.title,
          note: item.note,
          startTime: item.start_time != null ? parseInt(item.start_time, 10) : undefined,
          sortOrder: item.sort_order,
        } as any);
      }
      result.templatesPulled++;
    } catch (err) {
      result.errors.push(`restore template ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 拉取附件（从 R2 下载到本地，并发 4 显著提速）=====
  const d1Attachments = await d1Query('SELECT * FROM attachments_meta WHERE is_deleted = 0', []);
  const existingAttIds = new Set((await db.getAllAttachments()).map(a => a.id));

  const newAttRows = d1Attachments.filter((row: any) => !existingAttIds.has(row.id));
  await runBatch(newAttRows, 4, async (row: any) => {
    try {
      const localEntry = await db.getEntryById(row.entry_id);
      if (!localEntry) return;

      const dir = `attachments/${localEntry.id}`;
      const thumbPath = `${dir}/${row.id}_thumb.jpg`;
      const filePath = `${dir}/${row.id}_orig.jpg`;

      // 缩略图 + 原图 并发下载
      await Promise.all([
        row.r2_key_thumb
          ? r2GetBase64(row.r2_key_thumb)
              .then(async thumbBase64 => {
                await Filesystem.writeFile({
                  path: thumbPath, data: thumbBase64,
                  directory: Directory.Data, recursive: true,
                });
              })
              .catch(() => { /* 缩略图下载失败忽略 */ })
          : Promise.resolve(),
        row.r2_key_orig
          ? r2GetBase64(row.r2_key_orig)
              .then(async origBase64 => {
                await Filesystem.writeFile({
                  path: filePath, data: origBase64,
                  directory: Directory.Data, recursive: true,
                });
              })
              .catch(() => { /* 原图下载失败不阻塞，缩略图已够用 */ })
          : Promise.resolve(),
      ]);

      await db.addAttachment({
        id: row.id,
        entryId: localEntry.id,
        filePath,
        thumbPath,
        mimeType: row.mime_type || 'image/jpeg',
        sortOrder: row.sort_order || 0,
        createdAt: row.created_at,
      });

      result.attachmentsDownloaded++;
      existingAttIds.add(row.id);
    } catch (err) {
      result.errors.push(`restore attachment ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ===== 拉取对话历史 =====
  try {
    const d1ChatSessions = await d1Query('SELECT * FROM chat_sessions', []);
    const localSessionIds = new Set((await db.getAllChatSessions()).map(s => s.id));
    for (const row of d1ChatSessions) {
      if (localSessionIds.has(row.id)) continue;
      try {
        await db.saveChatSession({
          id: row.id,
          title: row.title,
          messages: JSON.parse(row.messages),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          model: row.model || undefined,
          mcpEnabledTools: row.mcp_enabled_tools ? JSON.parse(row.mcp_enabled_tools) : undefined,
          mcpSearchResults: row.mcp_search_results ? JSON.parse(row.mcp_search_results) : undefined,
        });
      } catch (err) {
        result.errors.push(`restore chat_session ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`restore chat_sessions: ${err instanceof Error ? err.message : String(err)}`);
  }

  result.duration = Date.now() - startTime;
  return result;
}

/** ============ 查询云端备份信息 ============ */

/**
 * 获取云端备份历史列表
 */
export async function listCloudBackups(): Promise<any[]> {
  await d1InitSchemaOnce();
  return await d1Query(
    'SELECT * FROM _backup_manifests ORDER BY timestamp DESC LIMIT 50'
  );
}

/**
 * 获取上次备份时间戳
 */
export async function getLastCloudBackupTime(): Promise<number | null> {
  try {
    await d1InitSchemaOnce();
    const ts = await d1GetSyncState(SYNC_STATE_KEY);
    return ts ? parseInt(ts, 10) : null;
  } catch {
    return null;
  }
}
