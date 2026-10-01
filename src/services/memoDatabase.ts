/**
 * 备忘录数据服务（v2.3.1）
 *
 * 一表多篇：每篇备忘录 = 一条记录，正文整段存 content。
 * lastAnchor 记录「上次聚焦的 # 标题纯文本」，进入时自动定位。
 *
 * 落盘用 localStorage（Web / Android WebView / Electron 三端一致且持久），
 * 键名 `yiyan_memos_v1`，整体是 MemoDoc[] 数组。
 */
import type { MemoDoc } from '@/types';

const STORAGE_KEY = 'yiyan_memos_v1';
const LAST_ID_KEY = 'yiyan_memo_last_id';

const WELCOME = `# 欢迎使用备忘录

在这里写点什么吧。

## 小提示

- 顶部快捷栏可以插入 Markdown 符号
- 光标停在某个 \`#\` 标题上时，下次进入会自动跳回这里

> 支持引用、**加粗**、*斜体*、\`行内代码\`、列表和链接
`;

function genId(): string {
  return `memo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readAll(): MemoDoc[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m: any) => m && typeof m.id === 'string')
      .map((m: any): MemoDoc => ({
        id: m.id,
        title: String(m.title ?? '未命名'),
        content: String(m.content ?? ''),
        lastAnchor: m.lastAnchor ?? null,
        createdAt: Number(m.createdAt) || Date.now(),
        updatedAt: Number(m.updatedAt) || Date.now(),
        isDeleted: m.isDeleted || 0,
      }));
  } catch {
    return [];
  }
}

function writeAll(memos: MemoDoc[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
  } catch (err) {
    console.error('[memoDatabase] 写入失败:', err);
  }
}

/** 按更新时间倒序 */
export async function getAllMemos(): Promise<MemoDoc[]> {
  return readAll()
    .filter(m => !m.isDeleted)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getMemo(id: string): Promise<MemoDoc | null> {
  return readAll().find(m => m.id === id && !m.isDeleted) || null;
}

export async function createMemo(title = '未命名', content = ''): Promise<MemoDoc> {
  const now = Date.now();
  const memo: MemoDoc = {
    id: genId(),
    title,
    content,
    lastAnchor: null,
    createdAt: now,
    updatedAt: now,
    isDeleted: 0,
  };
  const all = readAll();
  all.push(memo);
  writeAll(all);
  return memo;
}

export async function saveMemo(memo: MemoDoc): Promise<void> {
  const all = readAll();
  const idx = all.findIndex(m => m.id === memo.id);
  const next = { ...memo, updatedAt: Date.now() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  writeAll(all);
}

/** 只更新「上次聚焦标题」（轻量写入，不改 updatedAt 避免打乱排序） */
export async function saveMemoAnchor(id: string, anchor: string | null): Promise<void> {
  const all = readAll();
  const idx = all.findIndex(m => m.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], lastAnchor: anchor };
    writeAll(all);
  }
}

export async function deleteMemo(id: string): Promise<void> {
  const all = readAll();
  const idx = all.findIndex(m => m.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], isDeleted: 1, updatedAt: Date.now() };
    writeAll(all);
  }
}

/** 取「上次打开的备忘录」；没有则新建一篇 */
export async function getLastOrCreateMemo(): Promise<MemoDoc> {
  const memos = await getAllMemos();
  if (memos.length > 0) {
    const lastId = localStorage.getItem(LAST_ID_KEY);
    if (lastId) {
      const found = memos.find(m => m.id === lastId);
      if (found) return found;
    }
    return memos[0];
  }
  const created = await createMemo('未命名', WELCOME);
  setLastMemoId(created.id);
  return created;
}

export function setLastMemoId(id: string): void {
  try { localStorage.setItem(LAST_ID_KEY, id); } catch { /* 忽略 */ }
}
