/**
 * 增量导入工具
 */
import type { Entry, Tag } from '@/types';
import { getDatabase } from '@/services/database';
import { contentHash } from '@/features/datamanager/types';
import type { ImportResult } from '@/features/datamanager/types';

/** 导入 JSON 格式 */
interface ImportData {
  version: string;
  entries: Array<{
    id?: string;
    content: string;
    source?: string;
    isStarred?: boolean;
    tags?: string[];
    createdAt?: string | number;
    copyCount?: number;
    supplement?: string;
  }>;
}

/**
 * 增量导入 JSON 数据
 * 用 content 的 hash 判断重复，完全重复的不导入
 */
export async function incrementalImport(jsonText: string): Promise<ImportResult> {
  const result: ImportResult = {
    total: 0,
    imported: 0,
    skipped: 0,
    errors: [],
  };

  let data: ImportData;
  try {
    data = JSON.parse(jsonText) as ImportData;
  } catch {
    result.errors.push('JSON 解析失败');
    return result;
  }

  if (!data.entries || !Array.isArray(data.entries)) {
    result.errors.push('数据格式错误：缺少 entries 数组');
    return result;
  }

  result.total = data.entries.length;

  const db = await getDatabase();

  // 获取现有内容的 hash 集合
  const existingHashes = await db.getAllContentHashes();

  // 获取现有标签
  const existingTags = await db.getAllTags();
  const tagNameMap = new Map<string, Tag>();
  for (const tag of existingTags) {
    tagNameMap.set(tag.name, tag);
  }

  for (const item of data.entries) {
    if (!item.content || typeof item.content !== 'string') {
      result.errors.push('条目内容为空，跳过');
      result.skipped++;
      continue;
    }

    const hash = contentHash(item.content);
    if (existingHashes.has(hash)) {
      result.skipped++;
      continue;
    }

    // 创建新条目
    const now = Date.now();
    const createdAt = typeof item.createdAt === 'string'
      ? new Date(item.createdAt).getTime() || now
      : typeof item.createdAt === 'number'
        ? item.createdAt
        : now;

    const entryId = `${now.toString(36)}_${Math.random().toString(36).slice(2, 11)}`;

    const entry = await db.createEntry({
      id: entryId,
      content: item.content,
      source: item.source,
      supplement: item.supplement,
      isStarred: item.isStarred ?? false,
      createdAt,
      updatedAt: now,
      copyCount: item.copyCount ?? 0,
    });

    // 添加 hash 到已存在集合
    existingHashes.add(hash);

    // 处理标签
    if (item.tags && Array.isArray(item.tags)) {
      for (const tagName of item.tags) {
        let tag = tagNameMap.get(tagName);
        if (!tag) {
          tag = await db.createTag(tagName);
          tagNameMap.set(tagName, tag);
        }
        await db.addTagToEntry(entry.id, tag.id);
      }
    }

    result.imported++;
  }

  return result;
}
