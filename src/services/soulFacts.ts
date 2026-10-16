/**
 * Soul 事实库（v3.4.0 · 档案进化）
 *
 * 「Soul 人格档案」的数据层：结构化事实（存 settings.ai.soulFacts）+ 场景渲染 + 变更应用 + 撤销快照。
 *
 * 设计要点：
 * - 只存事实与状态（不存指令/偏好/倾向）；AI 只提议变更，UI 确认后才调用 applySoulChanges 写入。
 * - 存储走 settings（自动获得本地 zip 备份 / 设备互传 / 三端持久化）。
 * - 注入 = 渲染（chat 全量 5 类 / 怕了么白名单 4 类），预算固定；无事实时返回 null，调用方回退 legacy soul。
 * - 匹配：factId 优先；matchText 走唯一包含匹配（精确 → 紧凑兜底），0 处/多处置报错。
 * - 撤销：蒸馏等批次应用前记录快照（单槽位），支持「撤销本次修改」（恢复 facts + 收件箱）。
 */
import { useSettingsStore } from '@/stores/settingsStore';
import {
  SOUL_CATEGORY_LABELS,
  SOUL_FACT_CONTENT_MAX,
  SOUL_FACTS_MAX,
  SOUL_PORTRAIT_CHAT_MAX,
  SOUL_PORTRAIT_WORRY_MAX,
} from '@/types';
import type { SoulChanges, SoulFact, SoulFactCategory } from '@/types';
import type { AIMemory } from './aiMemory';
import { listMemories, replaceAllMemories } from './aiMemory';

/* ============ 常量 ============ */

const CATEGORY_ORDER_CHAT: SoulFactCategory[] = ['identity', 'situation', 'state', 'goal', 'history'];
/** 怕了么视野：只给心理/生活相关的 4 类（经历/技术细节不打扰 CBT 流程） */
const CATEGORY_ORDER_WORRY: SoulFactCategory[] = ['identity', 'situation', 'state', 'goal'];

const VALID_CATEGORIES: SoulFactCategory[] = ['identity', 'situation', 'state', 'goal', 'history'];

const UNDO_STORAGE_KEY = 'yiyan_soul_undo_v1';

/* ============ 工具函数 ============ */

export function isSoulFactCategory(v: unknown): v is SoulFactCategory {
  return typeof v === 'string' && (VALID_CATEGORIES as string[]).includes(v);
}

function normalizeCategory(v: unknown): SoulFactCategory {
  return isSoulFactCategory(v) ? v : 'situation';
}

function normalizeContent(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  return text.length > SOUL_FACT_CONTENT_MAX ? text.slice(0, SOUL_FACT_CONTENT_MAX) : text;
}

function clip(s: string, n = 30): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function genFactId(): string {
  return `fact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ============ 读取 / 写入（低阶） ============ */

/** 全量事实（含已废除；撤销/快照用） */
export function getSoulFactsRaw(): SoulFact[] {
  return useSettingsStore.getState().settings.ai.soulFacts ?? [];
}

/** 活跃事实（默认接口；includeRetired 时含已废除） */
export function listSoulFacts(includeRetired = false): SoulFact[] {
  const all = getSoulFactsRaw();
  return includeRetired ? all : all.filter(f => f.status === 'active');
}

/** 活跃事实条数（UI 展示用） */
export function countActiveSoulFacts(): number {
  return listSoulFacts().length;
}

/** 直接写入全量数组（UI 内部操作 / 撤销恢复 / 变更应用统一走这里持久化） */
export function writeSoulFacts(facts: SoulFact[]): void {
  useSettingsStore.getState().updateAIConfig({ soulFacts: facts });
}

/* ============ UI 直操（面板内部用） ============ */

/** 手动新增一条（UI）；去重/校验与 applySoulChanges 一致 */
export function addSoulFactManually(content: string, category: SoulFactCategory): { ok: boolean; error?: string } {
  const outcome = applySoulChanges({ add: [{ content, category }], update: [], retire: [] }, 'user');
  if (outcome.added > 0) return { ok: true };
  return { ok: false, error: outcome.errors[0] || '未新增（可能与已有事实重复）' };
}

/** UI：直接更新一条的内容/分类 */
export function updateSoulFactDirect(id: string, content: string, category: SoulFactCategory): { ok: boolean; error?: string } {
  const facts = getSoulFactsRaw();
  const idx = facts.findIndex(f => f.id === id);
  if (idx < 0) return { ok: false, error: '事实不存在' };
  const text = normalizeContent(content);
  if (!text) return { ok: false, error: '内容不能为空' };
  facts[idx] = { ...facts[idx], content: text, category, updatedAt: Date.now() };
  writeSoulFacts(facts);
  return { ok: true };
}

/** UI：物理删除一条 */
export function removeSoulFact(id: string): void {
  writeSoulFacts(getSoulFactsRaw().filter(f => f.id !== id));
}

/** UI：废除（软删）一条 */
export function retireSoulFact(id: string): void {
  const facts = getSoulFactsRaw();
  const idx = facts.findIndex(f => f.id === id);
  if (idx < 0) return;
  facts[idx] = { ...facts[idx], status: 'retired', updatedAt: Date.now() };
  writeSoulFacts(facts);
}

/** UI：恢复一条（废除 → 活跃） */
export function reviveSoulFact(id: string): void {
  const facts = getSoulFactsRaw();
  const idx = facts.findIndex(f => f.id === id);
  if (idx < 0) return;
  facts[idx] = { ...facts[idx], status: 'active', updatedAt: Date.now() };
  writeSoulFacts(facts);
}

/* ============ 变更组（AI 提议 / 蒸馏 / 怕了么） ============ */

export interface SoulChangeOutcome {
  /** 应用后的完整数组（未写入前 = 干跑结果） */
  next: SoulFact[];
  added: number;
  updated: number;
  retired: number;
  /** 成功项的人类可读描述（确认卡 / 结果展示） */
  details: string[];
  /** 失败项原因（部分失败不阻塞其他项） */
  errors: string[];
}

/**
 * 从工具参数 / 模型 JSON 输出中宽松解析变更组（过滤非数组与无效项）。
 * 用于 chatBridge 的 update_soul 参数、worryAI 的 soulUpdate、蒸馏输出。
 */
export function parseSoulChanges(raw: unknown): SoulChanges {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const toArray = (v: unknown): Array<Record<string, unknown>> =>
    Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Array<Record<string, unknown>> : [];
  return {
    add: toArray(src.add).map(x => ({
      content: String(x.content ?? ''),
      category: x.category as SoulFactCategory | undefined,
    })),
    update: toArray(src.update).map(x => ({
      factId: typeof x.factId === 'string' ? x.factId : undefined,
      matchText: typeof x.matchText === 'string' ? x.matchText : undefined,
      content: String(x.content ?? ''),
      category: x.category as SoulFactCategory | undefined,
    })),
    retire: toArray(src.retire).map(x => ({
      factId: typeof x.factId === 'string' ? x.factId : undefined,
      matchText: typeof x.matchText === 'string' ? x.matchText : undefined,
    })),
  };
}

/** 变更组合计条数（确认卡摘要用） */
export function countSoulChanges(changes: SoulChanges): { add: number; update: number; retire: number } {
  return { add: changes.add.length, update: changes.update.length, retire: changes.retire.length };
}

/**
 * 按 factId 或 matchText 定位一条事实。
 * matchText：唯一包含匹配（精确 → 去空白紧凑兜底）；0 处/多处置报错。
 */
function resolveFactRef(
  pool: SoulFact[],
  factId?: string,
  matchText?: string,
): { fact?: SoulFact; error?: string } {
  if (factId) {
    const f = pool.find(x => x.id === factId);
    return f ? { fact: f } : { error: `未找到 ID「${factId}」对应的事实` };
  }
  const needle = String(matchText ?? '').trim();
  if (!needle) return { error: '需提供 factId 或 matchText（原文片段）' };
  const active = pool.filter(f => f.status === 'active');
  let hits = active.filter(f => f.content.includes(needle));
  if (hits.length === 0) {
    // 紧凑兜底：忽略空白差异后再匹配（防 AI 复制时吞了空格/换行）
    const compact = (s: string) => s.replace(/\s+/g, '');
    const n = compact(needle);
    if (n) hits = active.filter(f => compact(f.content).includes(n));
  }
  if (hits.length === 0) return { error: `未找到包含「${clip(needle)}」的活跃事实` };
  if (hits.length > 1) return { error: `「${clip(needle)}」匹配到 ${hits.length} 条事实，请用更长的唯一片段或 factId` };
  return { fact: hits[0] };
}

/**
 * 干跑一组变更（不落盘）。返回应用后的数组与逐项细节。
 * add 去重（与活跃事实逐字相同 → 跳过）；update/retire 定位失败只记 errors，不阻塞其他项。
 */
export function simulateSoulChanges(
  facts: SoulFact[],
  changes: SoulChanges,
  source: 'ai' | 'user' | 'migrated' = 'ai',
): SoulChangeOutcome {
  const next = facts.map(f => ({ ...f }));
  const details: string[] = [];
  const errors: string[] = [];
  let added = 0;
  let updated = 0;
  let retired = 0;

  const activeCount = () => next.filter(f => f.status === 'active').length;

  // ---- add ----
  for (const item of changes.add ?? []) {
    const content = normalizeContent(item?.content);
    if (!content) {
      errors.push('新增项内容为空，已跳过');
      continue;
    }
    if (next.some(f => f.status === 'active' && f.content === content)) {
      details.push(`已存在，跳过：「${clip(content)}」`);
      continue;
    }
    if (activeCount() >= SOUL_FACTS_MAX) {
      errors.push(`事实数量已达上限（${SOUL_FACTS_MAX} 条），本条新增被拒`);
      continue;
    }
    const cat = normalizeCategory(item?.category);
    const now = Date.now();
    next.push({
      id: genFactId(),
      content,
      category: cat,
      source,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    added++;
    details.push(`新增【${SOUL_CATEGORY_LABELS[cat]}】${clip(content)}`);
  }

  // ---- update ----
  for (const item of changes.update ?? []) {
    const ref = resolveFactRef(next, item?.factId, item?.matchText);
    if (!ref.fact) {
      errors.push(`修改失败：${ref.error}`);
      continue;
    }
    const content = normalizeContent(item?.content);
    if (!content) {
      errors.push(`修改「${clip(ref.fact.content, 20)}」失败：新内容为空`);
      continue;
    }
    const idx = next.findIndex(f => f.id === ref.fact!.id);
    const oldContent = next[idx].content;
    next[idx] = {
      ...next[idx],
      content,
      category: item?.category ? normalizeCategory(item.category) : next[idx].category,
      updatedAt: Date.now(),
    };
    updated++;
    details.push(`修改：${clip(oldContent, 16)} → ${clip(content, 40)}`);
  }

  // ---- retire ----
  for (const item of changes.retire ?? []) {
    const ref = resolveFactRef(next, item?.factId, item?.matchText);
    if (!ref.fact) {
      errors.push(`废除失败：${ref.error}`);
      continue;
    }
    if (ref.fact.status === 'retired') {
      details.push(`已废除，跳过：「${clip(ref.fact.content)}」`);
      continue;
    }
    const idx = next.findIndex(f => f.id === ref.fact!.id);
    next[idx] = { ...next[idx], status: 'retired', updatedAt: Date.now() };
    retired++;
    details.push(`废除：${clip(ref.fact.content)}`);
  }

  return { next, added, updated, retired, details, errors };
}

/** 干跑（读当前库；确认卡预览用，不落盘） */
export function previewSoulChanges(changes: SoulChanges): SoulChangeOutcome {
  return simulateSoulChanges(getSoulFactsRaw(), changes);
}

/**
 * 应用一组变更（确认后调用）。有任一成功项才落盘。
 * 注意：不负责快照——如需可撤销，调用方先 recordSoulUndoSnapshot()。
 */
export function applySoulChanges(
  changes: SoulChanges,
  source: 'ai' | 'user' | 'migrated' = 'ai',
): SoulChangeOutcome & { applied: boolean } {
  const outcome = simulateSoulChanges(getSoulFactsRaw(), changes, source);
  const changed = outcome.added + outcome.updated + outcome.retired > 0;
  if (changed) writeSoulFacts(outcome.next);
  return { ...outcome, applied: changed };
}

/* ============ 渲染（注入画像） ============ */

/**
 * 按场景渲染画像正文（纯函数；无活跃事实 → null）。
 * - chat：全部 5 类，预算 1200 字，超预算截断时尾部加提示行（AI 可 list_soul_facts 查看）
 * - worry：白名单 4 类，预算 800 字，不加提示行
 */
export function renderSoulPortraitForFacts(facts: SoulFact[], view: 'chat' | 'worry'): string | null {
  const active = facts.filter(f => f.status === 'active');
  if (active.length === 0) return null;
  const order = view === 'worry' ? CATEGORY_ORDER_WORRY : CATEGORY_ORDER_CHAT;
  const budget = view === 'worry' ? SOUL_PORTRAIT_WORRY_MAX : SOUL_PORTRAIT_CHAT_MAX;

  const grouped: Array<{ head: string; items: string[] }> = [];
  for (const cat of order) {
    const items = active
      .filter(f => f.category === cat)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(f => `- ${f.content}`);
    if (items.length > 0) grouped.push({ head: `【${SOUL_CATEGORY_LABELS[cat]}】`, items });
  }

  const parts: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const g of grouped) {
    const kept: string[] = [];
    for (const line of g.items) {
      if (used + line.length + 1 > budget) {
        dropped++;
        continue;
      }
      used += line.length + 1;
      kept.push(line);
    }
    if (kept.length > 0) parts.push(g.head + '\n' + kept.join('\n'));
  }
  if (parts.length === 0) return null;

  let out = parts.join('\n');
  if (view === 'chat' && dropped > 0) {
    out += `\n（档案还有 ${dropped} 条未显示，可用 list_soul_facts 查看）`;
  }
  return out;
}

/** 读当前事实库渲染（注入点用） */
export function renderSoulPortrait(view: 'chat' | 'worry'): string | null {
  return renderSoulPortraitForFacts(getSoulFactsRaw(), view);
}

/* ============ 撤销快照（单槽位） ============ */

export interface SoulUndoSnapshot {
  createdAt: number;
  /** 批次标签（展示用，如「从收件箱提炼」） */
  label: string;
  /** 应用前的事实库全量 */
  factsBefore: SoulFact[];
  /** 应用前的收件箱全量（蒸馏批次用；AI 提议批次传 null） */
  memoriesBefore: AIMemory[] | null;
}

/** 记录一份「应用前」快照（应用批次操作前调用；新批次覆盖旧快照） */
export function recordSoulUndoSnapshot(label: string, memoriesBefore: AIMemory[] | null): void {
  try {
    const snap: SoulUndoSnapshot = {
      createdAt: Date.now(),
      label,
      factsBefore: getSoulFactsRaw(),
      memoriesBefore: memoriesBefore ? memoriesBefore.map(m => ({ ...m })) : null,
    };
    localStorage.setItem(UNDO_STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* 忽略存储失败 */
  }
}

/** 读取当前快照（无 / 损坏 → null） */
export function getSoulUndoSnapshot(): SoulUndoSnapshot | null {
  try {
    const raw = localStorage.getItem(UNDO_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.factsBefore)) return null;
    return {
      createdAt: Number(p.createdAt) || 0,
      label: String(p.label ?? ''),
      factsBefore: p.factsBefore as SoulFact[],
      memoriesBefore: Array.isArray(p.memoriesBefore) ? (p.memoriesBefore as AIMemory[]) : null,
    };
  } catch {
    return null;
  }
}

/** 撤销上一次批次应用：恢复事实库 + 收件箱，清除快照 */
export function undoLastSoulApply(): { ok: boolean; error?: string } {
  const snap = getSoulUndoSnapshot();
  if (!snap) return { ok: false, error: '没有可撤销的批次' };
  writeSoulFacts(snap.factsBefore);
  if (snap.memoriesBefore) replaceAllMemories(snap.memoriesBefore);
  clearSoulUndoSnapshot();
  return { ok: true };
}

export function clearSoulUndoSnapshot(): void {
  try {
    localStorage.removeItem(UNDO_STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}

/* ============ legacy soul（兼容期） ============ */

/** 旧版档案文本（未迁移时非空） */
export function getLegacySoulText(): string {
  return (useSettingsStore.getState().settings.ai.soul || '').trim();
}

/** 迁移完成后清空旧档案文本（P3 拍板：直接删） */
export function clearLegacySoul(): void {
  useSettingsStore.getState().updateAIConfig({ soul: '' });
}

/** 当前收件箱快照（蒸馏撤销用） */
export function snapshotMemories(): AIMemory[] {
  return listMemories().map(m => ({ ...m }));
}
