/**
 * 提示词库数据服务（v3.6.0）
 *
 * 落盘在 `settings.ai.promptLibrary`：settings store 的 updateAIConfig 自带
 * localStorage + SQLite 双写，所以改完即时生效，不需要按设置页底部的「保存」。
 *
 * 为什么不用独立 localStorage 键（像备忘录/转盘那样）：本地备份 zip 与设备互传
 * 都携带 settings，提示词跟着备份走，才不会「辛苦攒的提示词一夜蒸发」。
 * 已知边界：云备份整包不含设置，所以云恢复不会带回提示词（原有的设计）。
 *
 * 本模块只做纯数据操作，UI 与 MCP 工具共用同一套语义。
 */
import { BUILTIN_PROMPTS } from '@/config/promptSeeds';
import { useSettingsStore } from '@/stores/settingsStore';
import type { SavedPrompt } from '@/types';

/** 单条正文上限：防手滑粘进巨型文本把 settings 撑爆（超出直接截断并提示） */
export const MAX_PROMPT_CHARS = 200_000;

/** 列表默认排序：置顶 → 最近用过 → 最近改动 */
const collator = new Intl.Collator('zh-Hans-CN');

function genId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 读取全部条目（不含归档时按需过滤）。返回的是副本，外部改它不影响 store。 */
export function listPrompts(opts: { includeArchived?: boolean } = {}): SavedPrompt[] {
  const all = useSettingsStore.getState().settings.ai.promptLibrary ?? [];
  const picked = opts.includeArchived ? all : all.filter(p => !p.archived);
  return picked.slice();
}

/** 排序后的列表（列表页与 Chat 面板都用这个顺序，保持一致） */
export function sortPrompts(list: SavedPrompt[]): SavedPrompt[] {
  return list.slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    const ua = a.lastUsedAt ?? 0;
    const ub = b.lastUsedAt ?? 0;
    if (ua !== ub) return ub - ua;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return collator.compare(a.title, b.title);
  });
}

export function listPromptsSorted(opts: { includeArchived?: boolean } = {}): SavedPrompt[] {
  return sortPrompts(listPrompts(opts));
}

/** 按 id 精确取；退化时按标题宽松匹配（MCP 只拿到标题的情况下用） */
export function getPrompt(idOrTitle: string): SavedPrompt | null {
  const key = (idOrTitle || '').trim();
  if (!key) return null;
  const all = listPrompts({ includeArchived: true });
  const byId = all.find(p => p.id === key);
  if (byId) return byId;
  const exact = all.find(p => p.title === key);
  if (exact) return exact;
  const lower = key.toLowerCase();
  return all.find(p => p.title.toLowerCase() === lower) ?? null;
}

/** 统计条数（列表页头部、AI 配置面板的概览都用它） */
export function countPrompts(opts: { includeArchived?: boolean } = {}): number {
  return listPrompts(opts).length;
}

function writePrompts(next: SavedPrompt[]): void {
  useSettingsStore.getState().updateAIConfig({ promptLibrary: next });
}

function clampContent(content: string): string {
  return content.length > MAX_PROMPT_CHARS ? content.slice(0, MAX_PROMPT_CHARS) : content;
}

export interface PromptDraft {
  title: string;
  scene?: string;
  content: string;
}

/** 新建一条；标题空则用「未命名提示词」，正文原样保存 */
export function createPrompt(draft: PromptDraft): SavedPrompt {
  const now = Date.now();
  const prompt: SavedPrompt = {
    id: genId(),
    title: draft.title.trim() || '未命名提示词',
    scene: draft.scene?.trim() || undefined,
    content: clampContent(draft.content),
    pinned: false,
    archived: 0,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  writePrompts([prompt, ...listPrompts({ includeArchived: true })]);
  return prompt;
}

export type PromptPatch = Partial<Pick<SavedPrompt, 'title' | 'scene' | 'content' | 'pinned' | 'archived'>>;

/** 局部更新；只有真的改了才刷 updatedAt（避免「打开又关掉」也算修改） */
export function updatePrompt(id: string, patch: PromptPatch): SavedPrompt | null {
  const all = listPrompts({ includeArchived: true });
  const idx = all.findIndex(p => p.id === id);
  if (idx < 0) return null;

  const prev = all[idx];
  const next: SavedPrompt = { ...prev };
  if (patch.title !== undefined) next.title = patch.title.trim() || prev.title;
  if (patch.scene !== undefined) next.scene = patch.scene.trim() || undefined;
  if (patch.content !== undefined) next.content = clampContent(patch.content);
  if (patch.pinned !== undefined) next.pinned = patch.pinned;
  if (patch.archived !== undefined) next.archived = patch.archived;

  const changed =
    next.title !== prev.title ||
    next.scene !== prev.scene ||
    next.content !== prev.content ||
    !!next.pinned !== !!prev.pinned ||
    (next.archived ?? 0) !== (prev.archived ?? 0);
  if (!changed) return prev;

  next.updatedAt = Date.now();
  all[idx] = next;
  writePrompts(all);
  return next;
}

/** 彻底删除（列表里有二次确认；归档才是「先收起来」的路径） */
export function deletePrompt(id: string): boolean {
  const all = listPrompts({ includeArchived: true });
  const next = all.filter(p => p.id !== id);
  if (next.length === all.length) return false;
  writePrompts(next);
  return true;
}

/** 记一次使用：挂载/插入时调用，用于「最近用过的排前面」 */
export function touchPromptUse(id: string): void {
  const all = listPrompts({ includeArchived: true });
  const idx = all.findIndex(p => p.id === id);
  if (idx < 0) return;
  // ⚠️ 这里刻意不动 updatedAt：使用不等于修改，否则「最近改动」排序会被刷烂
  all[idx] = { ...all[idx], useCount: (all[idx].useCount ?? 0) + 1, lastUsedAt: Date.now() };
  writePrompts(all);
}

/**
 * 导入内置 8 条教学提示词。
 * 按标题去重：已存在的跳过（包括被归档的），所以可以随时补回缺失的那几条。
 */
export function importBuiltinPrompts(): { added: number; skipped: number } {
  const all = listPrompts({ includeArchived: true });
  const existing = new Set(all.map(p => p.title.trim()));
  const now = Date.now();
  const added: SavedPrompt[] = [];

  for (const seed of BUILTIN_PROMPTS) {
    if (existing.has(seed.title)) continue;
    added.push({
      id: genId(),
      title: seed.title,
      scene: seed.scene,
      content: clampContent(seed.content),
      pinned: false,
      archived: 0,
      useCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (added.length > 0) writePrompts([...added, ...all]);
  return { added: added.length, skipped: BUILTIN_PROMPTS.length - added.length };
}

/** 挂载多条时拼给模型的文本：按顺序，条间空一行（只关心正文，接受任何带 content 的结构） */
export function composePromptText(prompts: { content: string }[]): string {
  return prompts.map(p => p.content.trim()).filter(Boolean).join('\n\n');
}
