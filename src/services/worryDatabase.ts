/**
 * 「怕了么」担心记录数据服务（消除担心功能）
 *
 * 设计要点（参照 wheelDatabase.ts 先例）：
 * - **落盘用 localStorage**（Web / Android WebView / Electron 三端都可用且持久），
 *   键名 `yiyan_worries_v1`，整体是一个 WorryRecord[] 数组。
 *   —— 不碰三端 SQLite 数据层，零回归风险。
 * - **不进任何备份**（云备份与本地备份均不含，与转盘同待遇）。
 * - 一次调和 = 一条记录；进行中的记录 status='draft' 用于断点续接，
 *   同一时间最多保留一条 draft。
 */
import type { WorryRecord, WorryPendingSoul } from '@/types';

const STORAGE_KEY = 'yiyan_worries_v1';
/** v3.3.0：AI 提议的 Soul 档案更新（挂到「怕了么」主页等待确认；同样不进任何备份） */
const SOUL_PENDING_KEY = 'yiyan_worry_soul_pending_v1';

function genId(): string {
  return `worry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 读取全部记录（容错：坏数据回退空数组） */
function readAll(): WorryRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w: any) => w && typeof w.id === 'string')
      .map((w: any): WorryRecord => ({
        id: w.id,
        content: String(w.content ?? ''),
        scoreBefore: Number(w.scoreBefore) >= 1 && Number(w.scoreBefore) <= 10
          ? Number(w.scoreBefore)
          : 1,
        scoreAfter: typeof w.scoreAfter === 'number' && w.scoreAfter >= 1 && w.scoreAfter <= 10
          ? w.scoreAfter
          : null,
        outcomes: Array.isArray(w.outcomes)
          ? w.outcomes
              .filter((o: any) => o && (o.type === 'worst' || o.type === 'normal' || o.type === 'best'))
              .map((o: any) => ({
                type: o.type,
                text: String(o.text ?? ''),
                rawProb: Number(o.rawProb) >= 0 && Number(o.rawProb) <= 100 ? Number(o.rawProb) : 50,
                confirmed: o.confirmed === true,
              }))
          : [],
        normalizedProbs: w.normalizedProbs && typeof w.normalizedProbs === 'object'
          ? {
              worst: Number(w.normalizedProbs.worst) || 0,
              normal: Number(w.normalizedProbs.normal) || 0,
              best: Number(w.normalizedProbs.best) || 0,
            }
          : null,
        flipPoints: Array.isArray(w.flipPoints)
          ? w.flipPoints
              .filter((p: any) => p && typeof p.title === 'string')
              .map((p: any) => ({ title: p.title, desc: String(p.desc ?? '') }))
          : [],
        skippedFlip: w.skippedFlip === true,
        status: w.status === 'completed' ? 'completed' : 'draft',
        step: Number(w.step) >= 1 && Number(w.step) <= 7 ? Number(w.step) : 1,
        createdAt: Number(w.createdAt) || Date.now(),
        updatedAt: Number(w.updatedAt) || Date.now(),
        isDeleted: w.isDeleted || 0,
      }));
  } catch {
    return [];
  }
}

function writeAll(records: WorryRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (err) {
    console.error('[worryDatabase] 写入失败:', err);
  }
}

/** 获取全部已完成记录（按完成时间倒序，不含已删除） */
export async function getCompletedWorries(): Promise<WorryRecord[]> {
  return readAll()
    .filter(w => w.status === 'completed' && !w.isDeleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 按 id 获取单条记录 */
export async function getWorry(id: string): Promise<WorryRecord | null> {
  return readAll().find(w => w.id === id && !w.isDeleted) || null;
}

/** 获取当前未完成的草稿（最多一条；按更新时间取最新） */
export async function getDraft(): Promise<WorryRecord | null> {
  const drafts = readAll()
    .filter(w => w.status === 'draft' && !w.isDeleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return drafts[0] || null;
}

/** 新建一条空草稿（step=1，content 为空） */
export async function createDraft(): Promise<WorryRecord> {
  const now = Date.now();
  const draft: WorryRecord = {
    id: genId(),
    content: '',
    scoreBefore: 1,
    scoreAfter: null,
    outcomes: [],
    normalizedProbs: null,
    flipPoints: [],
    skippedFlip: false,
    status: 'draft',
    step: 1,
    createdAt: now,
    updatedAt: now,
    isDeleted: 0,
  };
  const all = readAll();
  all.push(draft);
  writeAll(all);
  return draft;
}

/** 全量保存一条记录（自动刷新 updatedAt 并落盘） */
export async function saveWorry(record: WorryRecord): Promise<void> {
  const all = readAll();
  const idx = all.findIndex(w => w.id === record.id);
  const next: WorryRecord = { ...record, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  writeAll(all);
}

/** 软删除一条记录（含丢弃草稿） */
export async function deleteWorry(id: string): Promise<void> {
  const all = readAll();
  const idx = all.findIndex(w => w.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], isDeleted: 1, updatedAt: Date.now() };
    writeAll(all);
  }
}

// ============ Soul 更新建议（v3.3.0，主页待确认）============

/** 读取待确认的 Soul 更新建议（无 / 损坏 → null） */
export function getPendingSoulUpdate(): WorryPendingSoul | null {
  try {
    const raw = localStorage.getItem(SOUL_PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p.content !== 'string' || !p.content.trim()) return null;
    return {
      reason: String(p.reason ?? ''),
      content: String(p.content),
      createdAt: Number(p.createdAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * 保存一条待确认的 Soul 更新建议。
 * **直接覆盖旧的待确认请求**（同一时间只保留最新一条，主人明确要求）。
 */
export function savePendingSoulUpdate(update: { reason: string; content: string }): void {
  try {
    const payload: WorryPendingSoul = {
      reason: update.reason,
      content: update.content,
      createdAt: Date.now(),
    };
    localStorage.setItem(SOUL_PENDING_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('[worryDatabase] 待确认 Soul 更新写入失败:', err);
  }
}

/** 清除待确认的 Soul 更新建议（用户已处理或主动放弃） */
export function clearPendingSoulUpdate(): void {
  try {
    localStorage.removeItem(SOUL_PENDING_KEY);
  } catch { /* 忽略 */ }
}
