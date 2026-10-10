/**
 * AI 长期记忆（v2.11.0）
 *
 * 一份跨对话持久保存的「关于用户」的事实/偏好清单：
 * - AI 在对话中主动保存（save_ai_memory 工具）
 * - 每次对话构建 systemPrompt 时注入（仅当 settings.context.enableLongTermMemory 打开）
 * - 用户在设置页可查看 / 编辑 / 删除（透明可控）
 *
 * 存储：localStorage（与转盘 yiyan_wheels_v1 / 备忘录 yiyan_memos_v1 同先例）。
 * 本期不进入云备份 / 导出（已知限制，后续可升级迁移）。
 */

const STORAGE_KEY = 'yiyan_ai_memories_v1';

/** 单条记忆内容长度上限（超出截断） */
export const MEMORY_CONTENT_MAX = 500;
/** 记忆总条数上限（超出时保存被拒，提示先清理） */
export const MEMORY_COUNT_MAX = 100;
/** systemPrompt 注入：条数上限 */
export const MEMORY_INJECT_MAX_COUNT = 30;
/** systemPrompt 注入：字符预算上限 */
export const MEMORY_INJECT_MAX_CHARS = 2000;

export interface AIMemory {
  id: string;
  content: string;
  /** 来源：ai = AI 对话中保存；user = 用户手动添加 */
  source: 'ai' | 'user';
  createdAt: number;
  updatedAt: number;
}

export interface MemoryWriteResult {
  success: boolean;
  memory?: AIMemory;
  error?: string;
}

function generateId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 全量读取（按最近更新倒序；损坏数据自动容错） */
export function listMemories(): AIMemory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is AIMemory =>
        m && typeof m === 'object' &&
        typeof m.id === 'string' && typeof m.content === 'string')
      .map((m): AIMemory => ({
        id: m.id,
        content: m.content,
        source: m.source === 'user' ? 'user' : 'ai',
        createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
        updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function persist(memories: AIMemory[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memories));
  } catch {
    /* 忽略存储失败 */
  }
}

/**
 * 保存一条记忆。
 * - 内容 trim 后为空 → 报错
 * - 完全相同的已有内容 → 幂等返回已有记录（不重复保存）
 * - 超过条数上限 → 报错（提示先清理旧记忆）
 */
export function saveMemory(content: string, source: 'ai' | 'user'): MemoryWriteResult {
  const text = content.trim();
  if (!text) return { success: false, error: '记忆内容不能为空' };

  const memories = listMemories();
  const dup = memories.find(m => m.content === text);
  if (dup) {
    return { success: true, memory: dup };
  }

  if (memories.length >= MEMORY_COUNT_MAX) {
    return {
      success: false,
      error: `长期记忆已达上限（${MEMORY_COUNT_MAX} 条），请先用 delete_ai_memory 清理不再需要的记忆`,
    };
  }

  const now = Date.now();
  const memory: AIMemory = {
    id: generateId(),
    content: text.length > MEMORY_CONTENT_MAX ? text.slice(0, MEMORY_CONTENT_MAX) : text,
    source,
    createdAt: now,
    updatedAt: now,
  };
  persist([memory, ...memories]);
  return { success: true, memory };
}

/** 修改一条记忆的内容 */
export function updateMemory(id: string, content: string): MemoryWriteResult {
  const text = content.trim();
  if (!text) return { success: false, error: '记忆内容不能为空' };

  const memories = listMemories();
  const target = memories.find(m => m.id === id);
  if (!target) return { success: false, error: `记忆 ${id} 不存在` };

  const next = memories.map(m => m.id === id
    ? { ...m, content: text.length > MEMORY_CONTENT_MAX ? text.slice(0, MEMORY_CONTENT_MAX) : text, updatedAt: Date.now() }
    : m);
  persist(next);
  return { success: true, memory: next.find(m => m.id === id)! };
}

/** 删除一条记忆；返回是否删除成功 */
export function deleteMemory(id: string): boolean {
  const memories = listMemories();
  const next = memories.filter(m => m.id !== id);
  if (next.length === memories.length) return false;
  persist(next);
  return true;
}

/**
 * 生成注入到 systemPrompt 的「长期记忆」列表文本。
 * 无记忆时返回 null（调用方自行决定是否仍注入行为引导）。
 * 超预算时按「最近更新优先」截断。
 */
export function getMemoryPromptSection(): string | null {
  const memories = listMemories();
  if (memories.length === 0) return null;

  const lines: string[] = [];
  let totalChars = 0;
  for (const m of memories) {
    if (lines.length >= MEMORY_INJECT_MAX_COUNT) break;
    const line = `- ${m.content}`;
    if (totalChars + line.length > MEMORY_INJECT_MAX_CHARS) break;
    lines.push(line);
    totalChars += line.length;
  }
  return lines.length > 0 ? lines.join('\n') : null;
}
