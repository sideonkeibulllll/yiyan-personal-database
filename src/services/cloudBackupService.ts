/**
 * 云端备份服务（Cloudflare D1 + R2）
 *
 * 功能：
 * 1. 增量备份本地数据到 D1（文本）+ R2（附件）
 * 2. 从云端恢复数据到本地（合并模式，跳过已存在 hash）
 * 3. 测试连接 · 管理配置
 *
 * 增量策略：
 * - 首次备份：D1 空库 → 全量导入（自然全量）
 * - 后续备份：按 updated_at > last_backup_ts 增量上传
 * - 删除同步：本地删除的条目在 D1 标记 is_deleted=1
 *
 * 安全提醒：
 * - API Token 存 localStorage 明文，仅适用于个人使用场景
 * - Token 拥有 D1 编辑权限，泄漏后可被删库
 */
import { D1Client } from './d1Client';
import { R2Client } from './r2Client';
import { getDatabase } from './database';
import { getTodoDatabase } from './todoDatabase';
import { Filesystem, Directory } from './filesystemAdapter';
import { contentHash } from '@/features/datamanager/types';
import {
  CLOUD_BACKUP_CONFIG_KEY,
  D1_INIT_SQL,
  R2_ATTACHMENT_PREFIX,
} from './cloudBackupTypes';
import type {
  CloudBackupConfig,
  CloudBackupResult,
  CloudRestoreResult,
} from './cloudBackupTypes';

const APP_VERSION = '1.7.5';
const SYNC_STATE_KEY = 'last_backup_ts';

/** ============ 配置管理 ============ */

export function getCloudBackupConfig(): CloudBackupConfig | null {
  try {
    const raw = localStorage.getItem(CLOUD_BACKUP_CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CloudBackupConfig;
  } catch {
    return null;
  }
}

export function saveCloudBackupConfig(config: CloudBackupConfig): void {
  localStorage.setItem(CLOUD_BACKUP_CONFIG_KEY, JSON.stringify(config));
}

export function clearCloudBackupConfig(): void {
  localStorage.removeItem(CLOUD_BACKUP_CONFIG_KEY);
}

function getConfigOrThrow(): CloudBackupConfig {
  const config = getCloudBackupConfig();
  if (!config) {
    throw new Error('未配置云端备份，请先在设置中填写 Cloudflare 凭证');
  }
  return config;
}

function getD1Client(): D1Client {
  const config = getConfigOrThrow();
  return new D1Client(config);
}

function getR2Client(): R2Client {
  const config = getConfigOrThrow();
  return new R2Client(config);
}

/** ============ 测试连接 ============ */

export async function testCloudConnection(): Promise<{ d1: string; r2: string; ok: boolean }> {
  const config = getConfigOrThrow();
  const d1 = new D1Client(config);
  const r2 = new R2Client(config);

  const [d1Result, r2Result] = await Promise.all([
    d1.testConnection(D1_INIT_SQL),
    r2.testConnection(),
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

  const config = getConfigOrThrow();
  const d1 = new D1Client(config);
  const r2 = new R2Client(config);
  const db = await getDatabase();
  const todoDb = await getTodoDatabase();

  // 确保数据库连接健康
  await (db as any).ensureConnection?.();
  await (todoDb as any).ensureConnection?.();

  // 确保 D1 表结构存在
  await d1.initSchema(D1_INIT_SQL);

  // 读取上次备份时间戳（首次备份时为 0 → 全量）
  const lastBackupTsStr = await d1.getSyncState(SYNC_STATE_KEY);
  const lastBackupTs = lastBackupTsStr ? parseInt(lastBackupTsStr, 10) : 0;

  // 收集本地数据
  const [entries, tags, groups, allTodos, allTodoTags, allTemplates, allAttachments] = await Promise.all([
    db.getAllEntries(),
    db.getAllTags(),
    db.getAllGroups(),
    todoDb.getAllTodos(),
    todoDb.getAllTodoTags(),
    todoDb.getAllTemplates(),
    db.getAllAttachments(),
  ]);

  // 收集链接
  const links = [];
  for (const entry of entries) {
    const entryLinks = await db.getLinksByEntryId(entry.id);
    links.push(...entryLinks);
  }

  // 收集模板 items
  const templatesWithItems = [];
  for (const tpl of allTemplates) {
    const items = await todoDb.getTemplateItems(tpl.id);
    templatesWithItems.push({ template: tpl, items });
  }

  // ===== 同步 entries（增量：updated_at > lastBackupTs）=====
  const changedEntries = entries.filter(e => e.updatedAt > lastBackupTs);
  for (const entry of changedEntries) {
    try {
      await d1.query(
        `INSERT OR REPLACE INTO entries
         (id, content, source, supplement, is_starred, is_deleted, created_at, updated_at, copy_count, content_hash, backup_batch_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
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
        ]
      );
      result.entriesSynced++;

      // 同步该条目的标签关联
      if (entry.tags && entry.tags.length > 0) {
        // 先删除旧关联
        await d1.query('DELETE FROM entry_tags WHERE entry_id = ?', [entry.id]);
        // 插入新关联
        for (const tag of entry.tags) {
          await d1.query(
            'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)',
            [entry.id, tag.id]
          );
        }
      }
    } catch (err) {
      result.errors.push(`entry ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 同步 tags（增量：createdAt > lastBackupTs 或所有 tags 如果首次）=====
  for (const tag of tags) {
    try {
      await d1.query(
        `INSERT OR REPLACE INTO tags
         (id, name, color, is_smart, search_criteria, is_deleted, created_at, updated_at, backup_batch_id)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          tag.id,
          tag.name,
          tag.color || null,
          tag.isSmart ? 1 : 0,
          tag.searchCriteria ? JSON.stringify(tag.searchCriteria) : null,
          tag.createdAt,
          Date.now(),
          result.batchId,
        ]
      );
      result.tagsSynced++;
    } catch (err) {
      result.errors.push(`tag ${tag.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 同步 groups =====
  for (const group of groups) {
    try {
      await d1.query(
        `INSERT OR REPLACE INTO groups_table
         (id, name, sort_order, is_deleted, backup_batch_id)
         VALUES (?, ?, ?, 0, ?)`,
        [group.id, group.name, group.sortOrder || 0, result.batchId]
      );
      result.groupsSynced++;
    } catch (err) {
      result.errors.push(`group ${group.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 同步 links =====
  for (const link of links) {
    try {
      await d1.query(
        `INSERT OR REPLACE INTO links
         (id, source_id, target_id, description, is_deleted, created_at, backup_batch_id)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [link.id, link.sourceId, link.targetId, link.description || null, link.createdAt, result.batchId]
      );
      result.linksSynced++;
    } catch (err) {
      result.errors.push(`link ${link.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 同步 todos =====
  const changedTodos = allTodos.filter(t => (t.updatedAt || t.createdAt) > lastBackupTs);
  for (const todo of changedTodos) {
    try {
      await d1.query(
        `INSERT OR REPLACE INTO todos
         (id, title, note, folder_date, time, is_done, is_today, is_deleted, created_at, updated_at, completed_at, backup_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [
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
        ]
      );
      result.todosSynced++;
    } catch (err) {
      result.errors.push(`todo ${todo.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 同步 todo tags =====
  for (const tt of allTodoTags) {
    try {
      await d1.query(
        `INSERT OR REPLACE INTO todo_tags
         (id, name, color, is_deleted, backup_batch_id)
         VALUES (?, ?, ?, 0, ?)`,
        [tt.id, tt.name, tt.color || null, result.batchId]
      );
    } catch (err) {
      result.errors.push(`todo_tag ${tt.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 同步 templates =====
  for (const { template, items } of templatesWithItems) {
    try {
      await d1.query(
        `INSERT OR REPLACE INTO templates
         (id, name, is_deleted, backup_batch_id)
         VALUES (?, ?, 0, ?)`,
        [template.id, template.name, result.batchId]
      );
      result.templatesSynced++;

      // 同步 template items
      for (const item of items) {
        await d1.query(
          `INSERT OR REPLACE INTO template_items
           (id, template_id, title, note, time, sort_order, backup_batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            template.id,
            item.title || null,
            item.note || null,
            item.startTime != null ? String(item.startTime) : null,
            item.sortOrder || 0,
            result.batchId,
          ]
        );
      }
    } catch (err) {
      result.errors.push(`template ${template.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 同步附件到 R2 + D1 元数据 =====
  // 获取 D1 中已有的附件 id 集合
  const existingAttRows = await d1.query('SELECT id FROM attachments_meta WHERE is_deleted = 0', []);
  const existingAttIds = new Set(existingAttRows.map((r: any) => r.id));

  for (const att of allAttachments) {
    try {
      const r2KeyOrig = `${R2_ATTACHMENT_PREFIX}${att.id}_orig.jpg`;
      const r2KeyThumb = `${R2_ATTACHMENT_PREFIX}${att.id}_thumb.jpg`;

      // 如果 D1 中没有该附件记录，需要上传到 R2
      if (!existingAttIds.has(att.id)) {
        // 上传原图
        try {
          const origRes = await Filesystem.readFile({
            path: att.filePath,
            directory: Directory.Data,
          });
          await r2.putBase64Image(r2KeyOrig, origRes.data as string, att.mimeType || 'image/jpeg');
        } catch (err) {
          // 原图可能不存在（按需拉取未完成），跳过但记录
          result.errors.push(`附件原图缺失 att=${att.id}, 跳过上传`);
        }

        // 上传缩略图
        try {
          const thumbRes = await Filesystem.readFile({
            path: att.thumbPath,
            directory: Directory.Data,
          });
          await r2.putBase64Image(r2KeyThumb, thumbRes.data as string, att.mimeType || 'image/jpeg');
        } catch (err) {
          result.errors.push(`附件缩略图缺失 att=${att.id}, 跳过上传`);
        }

        result.attachmentsUploaded++;
      }

      // 写入/更新 D1 附件元数据
      await d1.query(
        `INSERT OR REPLACE INTO attachments_meta
         (id, entry_id, r2_key_orig, r2_key_thumb, mime_type, sort_order, is_deleted, created_at, backup_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          att.id,
          att.entryId,
          r2KeyOrig,
          r2KeyThumb,
          att.mimeType || 'image/jpeg',
          att.sortOrder || 0,
          att.createdAt,
          result.batchId,
        ]
      );
      existingAttIds.add(att.id);
    } catch (err) {
      result.errors.push(`attachment ${att.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ===== 同步删除（软删）=====
  // 检测本地已删除但 D1 中仍标记为 is_deleted=0 的条目
  // 策略：D1 中有但本地没有的 entry → 标记 is_deleted=1
  const d1EntryIds = await d1.query('SELECT id FROM entries WHERE is_deleted = 0', []);
  const localEntryIds = new Set(entries.map(e => e.id));
  for (const row of d1EntryIds) {
    if (!localEntryIds.has(row.id)) {
      await d1.query('UPDATE entries SET is_deleted = 1 WHERE id = ?', [row.id]);
      result.deletionsSynced++;
    }
  }

  // 同样检测 todos 的删除
  const d1TodoIds = await d1.query('SELECT id FROM todos WHERE is_deleted = 0', []);
  const localTodoIds = new Set(allTodos.map(t => t.id));
  for (const row of d1TodoIds) {
    if (!localTodoIds.has(row.id)) {
      await d1.query('UPDATE todos SET is_deleted = 1 WHERE id = ?', [row.id]);
      result.deletionsSynced++;
    }
  }

  // ===== 写入备份 manifest =====
  await d1.query(
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

  // ===== v2.0.0: 同步对话历史 =====
  const localChatSessions = await db.getAllChatSessions();
  for (const session of localChatSessions) {
    if (session.updatedAt > lastBackupTs) {
      try {
        await d1.query(
          `INSERT OR REPLACE INTO chat_sessions (id, title, messages, model, mcp_enabled_tools, mcp_search_results, created_at, updated_at, backup_batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            session.id,
            session.title,
            JSON.stringify(session.messages),
            session.model || null,
            session.mcpEnabledTools ? JSON.stringify(session.mcpEnabledTools) : null,
            session.mcpSearchResults ? JSON.stringify(session.mcpSearchResults) : null,
            session.createdAt,
            session.updatedAt,
            result.batchId,
          ],
        );
      } catch (err) {
        result.errors.push(`sync chat_session ${session.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ===== 更新同步状态 =====
  await d1.setSyncState(SYNC_STATE_KEY, String(startTime));

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

  const config = getConfigOrThrow();
  const d1 = new D1Client(config);
  const r2 = new R2Client(config);
  const db = await getDatabase();
  const todoDb = await getTodoDatabase();

  await (db as any).ensureConnection?.();
  await (todoDb as any).ensureConnection?.();

  // 确保表结构
  await d1.initSchema(D1_INIT_SQL);

  // ===== 拉取所有未删除的 entries =====
  const d1Entries = await d1.query('SELECT * FROM entries WHERE is_deleted = 0', []);
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
  const d1Tags = await d1.query('SELECT * FROM tags WHERE is_deleted = 0', []);
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
  const d1Groups = await d1.query('SELECT * FROM groups_table WHERE is_deleted = 0', []);
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
  const d1Links = await d1.query('SELECT * FROM links WHERE is_deleted = 0', []);
  for (const row of d1Links) {
    try {
      await db.createLink(row.source_id, row.target_id, row.description || undefined);
      result.linksPulled++;
    } catch {
      // 链接的源/目标可能不存在，跳过
    }
  }

  // ===== 拉取 todos =====
  const d1Todos = await d1.query('SELECT * FROM todos WHERE is_deleted = 0', []);
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
  const d1Templates = await d1.query('SELECT * FROM templates WHERE is_deleted = 0', []);
  const existingTplNames = new Set((await todoDb.getAllTemplates()).map(t => t.name));

  for (const row of d1Templates) {
    if (existingTplNames.has(row.name)) continue;
    try {
      const newTpl = await todoDb.createTemplate(row.name);
      // 拉取 template items
      const items = await d1.query(
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

  // ===== 拉取附件（从 R2 下载到本地）=====
  const d1Attachments = await d1.query('SELECT * FROM attachments_meta WHERE is_deleted = 0', []);
  const existingAttIds = new Set((await db.getAllAttachments()).map(a => a.id));

  for (const row of d1Attachments) {
    if (existingAttIds.has(row.id)) continue;

    try {
      // 需要找到本地对应的 entry（通过 content hash 匹配）
      // 这里简化处理：跳过无法匹配的附件
      // 实际场景中，恢复条目时已经生成了新的 entry id，
      // 附件的 entry_id 指向的是源设备的 entry id，无法直接映射
      // TODO: 后续可以通过维护 entry id 映射表来支持附件恢复
      // 目前先跳过附件下载，用户可以后续通过同步功能补齐

      // 尝试直接用源 entry_id 查找本地条目
      const localEntry = await db.getEntryById(row.entry_id);
      if (!localEntry) continue;

      const dir = `attachments/${localEntry.id}`;
      const thumbPath = `${dir}/${row.id}_thumb.jpg`;
      const filePath = `${dir}/${row.id}_orig.jpg`;

      // 下载缩略图
      if (row.r2_key_thumb) {
        const thumbBase64 = await r2.getBase64(row.r2_key_thumb);
        await Filesystem.writeFile({
          path: thumbPath,
          data: thumbBase64,
          directory: Directory.Data,
          recursive: true,
        });
      }

      // 下载原图
      if (row.r2_key_orig) {
        try {
          const origBase64 = await r2.getBase64(row.r2_key_orig);
          await Filesystem.writeFile({
            path: filePath,
            data: origBase64,
            directory: Directory.Data,
            recursive: true,
          });
        } catch {
          // 原图下载失败不阻塞，缩略图已够用
        }
      }

      // 写入本地 DB
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
  }

  // ===== v2.0.0: 拉取对话历史 =====
  try {
    const d1ChatSessions = await d1.query('SELECT * FROM chat_sessions', []);
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
  const d1 = getD1Client();
  await d1.initSchema(D1_INIT_SQL);
  return await d1.query(
    'SELECT * FROM _backup_manifests ORDER BY timestamp DESC LIMIT 50'
  );
}

/**
 * 获取上次备份时间戳
 */
export async function getLastCloudBackupTime(): Promise<number | null> {
  const d1 = getD1Client();
  try {
    await d1.initSchema(D1_INIT_SQL);
    const ts = await d1.getSyncState(SYNC_STATE_KEY);
    return ts ? parseInt(ts, 10) : null;
  } catch {
    return null;
  }
}
