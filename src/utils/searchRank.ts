/**
 * 搜索相关度工具（全域共享）
 *
 * 所有搜索入口（搜索页 / 数据选择器 / 连线选择 / Chat MCP 搜索面板 / MCP 工具）
 * 统一使用本模块做「多关键词 + 相关度排序」：
 *
 * - 关键词按空白切分（空格 / 全角空格），多关键词为 AND 语义（全部命中才保留）；
 * - 位置权重：字段开头 > 词边界（空格/标点后） > 字段中间；
 * - 出现次数加成（第 2~4 次命中，每次小幅加分）；
 * - 字段权重：主字段高（content/title 100），次要字段低（source 45 / supplement 40 / note 55）；
 * - 轻量加权：星标 +18；7 天内更新 +12、30 天内 +5（幅度小于主分，只微调同分段内的顺序）。
 *
 * 职责划分：
 * - 数据层（SQL / localStorage filter）负责「滤」：多关键词 AND 的粗过滤；
 * - 本模块负责「排」与严格剔除（未全部命中的结果丢弃）。
 *
 * 排序稳定：同分结果保持输入相对顺序（如数据层已按时间倒序）。
 */

/** 把查询串切分为关键词（空格 / 全角空格分隔，去空） */
export function splitKeywords(query: string): string[] {
  return query.split(/[\s\u3000]+/).map(k => k.trim()).filter(Boolean);
}

/** 转义 LIKE 模式中的通配符（配合 SQL 的 ESCAPE '\' 使用） */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, ch => '\\' + ch);
}

/** 词边界判定：命中位置的前一个字符是分隔符时视为词边界 */
const BOUNDARY_RE = /[\s\u3000，。！？、；：,.!?;:()（）【】\[\]{}《》""''"'/\\|~`@#$%^&*+=<>-]/;

/** 单字段打分：位置（开头 = base，词边界 = 0.75×，中间 = 0.5×）+ 出现次数（第 2~4 次，每次 +12%×base） */
function scoreField(text: string | undefined, keyword: string, base: number): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const idx = lower.indexOf(kw);
  if (idx < 0) return 0;

  let score: number;
  if (idx === 0) score = base;
  else if (BOUNDARY_RE.test(lower[idx - 1])) score = base * 0.75;
  else score = base * 0.5;

  // 出现次数（封顶计 4 次）
  let count = 1;
  let from = idx + kw.length;
  while (count < 4) {
    const j = lower.indexOf(kw, from);
    if (j < 0) break;
    count++;
    from = j + kw.length;
  }
  return score + (count - 1) * base * 0.12;
}

export interface RankField {
  text: string | undefined;
  /** 字段权重：主字段 ~100，次要字段 40~60 */
  weight: number;
}

export interface RankMeta {
  /** 星标加权 */
  starred?: boolean;
  /** 时间新鲜度参考（updatedAt 优先、否则 createdAt，毫秒时间戳） */
  timestamp?: number;
}

/**
 * 相关度评分（多关键词 AND）。
 * @returns 总分；0 = 有某个关键词未被任何字段命中 → 应剔除
 */
export function relevanceScore(fields: RankField[], keywords: string[], meta?: RankMeta): number {
  if (keywords.length === 0) return 1;
  let total = 0;
  for (const kw of keywords) {
    let best = 0;
    for (const f of fields) {
      const s = scoreField(f.text, kw, f.weight);
      if (s > best) best = s;
    }
    if (best === 0) return 0; // AND 语义：该关键词无处命中 → 剔除整条
    total += best;
  }
  if (meta?.starred) total += 18;
  if (meta?.timestamp) {
    const age = Date.now() - meta.timestamp;
    if (age >= 0 && age <= 7 * 864e5) total += 12;
    else if (age >= 0 && age <= 30 * 864e5) total += 5;
  }
  return total;
}

/**
 * 过滤 + 排序：剔除 0 分（未全部命中的）并按分数降序，同分保持输入相对顺序（稳定）。
 * keywords 为空 / 全部同分时，等价于原样返回。
 */
export function rankAndFilter<T>(items: T[], scoreOf: (item: T) => number): T[] {
  const scored: Array<{ item: T; score: number; index: number }> = [];
  items.forEach((item, index) => {
    const score = scoreOf(item);
    if (score > 0) scored.push({ item, score, index });
  });
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.map(x => x.item);
}
