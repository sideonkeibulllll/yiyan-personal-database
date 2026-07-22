/**
 * 数据导出工具
 * 支持 JSON 和 Markdown 格式
 */
import { getDatabase } from '@/services/database';
import type { Entry, Tag } from '@/types';

/**
 * 导出数据类型
 */
export interface ExportOptions {
  format: 'json' | 'markdown';
  scope: 'all' | 'tag' | 'group' | 'starred';
  tagId?: string;
  groupId?: string;
  includeLinks?: boolean;
}

/**
 * 导出数据
 */
export async function exportData(options: ExportOptions): Promise<string> {
  const db = await getDatabase();

  // 获取要导出的条目
  let entries: Entry[] = [];

  switch (options.scope) {
    case 'all':
      entries = await db.getAllEntries();
      break;
    case 'starred':
      entries = await db.searchEntries('', { isStarred: true });
      break;
    case 'tag':
      if (options.tagId) {
        entries = await db.searchEntries('', { tagIds: [options.tagId] });
      }
      break;
    case 'group':
      // 需要按组筛选
      entries = await db.getAllEntries();
      if (options.groupId) {
        entries = entries.filter(e => e.groupId === options.groupId);
      }
      break;
  }

  // 根据格式导出
  if (options.format === 'json') {
    return exportAsJSON(entries, db, options.includeLinks);
  } else {
    return exportAsMarkdown(entries);
  }
}

/**
 * 导出为 JSON
 */
async function exportAsJSON(
  entries: Entry[],
  db: Awaited<ReturnType<typeof getDatabase>>,
  includeLinks?: boolean
): Promise<string> {
  const exportObj: Record<string, unknown> = {
    version: '1.0',
    exportTime: new Date().toISOString(),
    entries: entries.map(entry => ({
      id: entry.id,
      content: entry.content,
      source: entry.source,
      supplement: entry.supplement,
      isStarred: entry.isStarred,
      tags: entry.tags?.map(t => t.name),
      createdAt: new Date(entry.createdAt).toISOString(),
      updatedAt: new Date(entry.updatedAt).toISOString(),
      lastUsedAt: entry.lastUsedAt ? new Date(entry.lastUsedAt).toISOString() : undefined,
      copyCount: entry.copyCount,
    })),
  };

  if (includeLinks) {
    const allLinks = [];
    for (const entry of entries) {
      const links = await db.getLinksByEntryId(entry.id);
      allLinks.push(...links);
    }
    exportObj.links = allLinks;
  }

  return JSON.stringify(exportObj, null, 2);
}

/**
 * 导出为 Markdown
 */
function exportAsMarkdown(entries: Entry[]): string {
  let md = `# 记忆库导出\n\n`;
  md += `> 导出时间: ${new Date().toLocaleString('zh-CN')}\n`;
  md += `> 共 ${entries.length} 条记录\n\n---\n\n`;

  // 按日期分组
  const grouped = new Map<string, Entry[]>();
  entries.forEach(entry => {
    const date = new Date(entry.createdAt).toLocaleDateString('zh-CN');
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(entry);
  });

  // 生成 Markdown
  for (const [date, items] of grouped) {
    md += `## ${date}\n\n`;
    items.forEach(entry => {
      md += `### ${entry.isStarred ? '⭐ ' : ''}${entry.content.slice(0, 30)}${entry.content.length > 30 ? '...' : ''}\n\n`;
      md += `${entry.content}\n\n`;
      if (entry.source) md += `> 来源: ${entry.source}\n`;
      if (entry.supplement) md += `> 补充: ${entry.supplement}\n`;
      if (entry.tags && entry.tags.length > 0) {
        md += `> 标签: ${entry.tags.map(t => `#${t.name}`).join(' ')}\n`;
      }
      md += `\n---\n\n`;
    });
  }

  return md;
}

/**
 * 下载文件
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导出并下载
 */
export async function exportAndDownload(options: ExportOptions): Promise<void> {
  const content = await exportData(options);
  const timestamp = new Date().toISOString().slice(0, 10);
  const extension = options.format === 'json' ? 'json' : 'md';
  const filename = `memory-export-${timestamp}.${extension}`;
  const mimeType = options.format === 'json' ? 'application/json' : 'text/markdown';

  downloadFile(content, filename, mimeType);
}
