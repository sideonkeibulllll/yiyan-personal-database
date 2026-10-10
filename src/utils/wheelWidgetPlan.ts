/**
 * 转盘小组件 · 计划与抽选（纯函数模块，v2.14.0）
 *
 * ⚠️ 本文件不做任何 Capacitor / DOM / localStorage 访问 —— 只做「计算」。
 *    因此可以在 Node 中直接单元测试（见 _scratch_yiyan/wheel_widget_test.mjs）。
 *    被 services/wheelWidgetService.ts 引用；模块外请勿绕开门面使用。
 *
 * 与原生侧的契约（android/.../widget/WheelWidget.kt 依赖此 JSON 结构）：
 *   WheelWidgetPlan = {
 *     version: 1,
 *     generatedAt: number,
 *     wheels: WheelSnapshot[]        // 盘序：MRU 在前，其余按 updatedAt
 *   }
 *   WheelSnapshot = {
 *     id: string,
 *     name: string,                  // 截断 8 字
 *     removeAfterSpin: boolean,      // 转动后是否移除该选项（原生亮小红点）
 *     options: { name: string, weight: number }[]
 *   }
 *   —— 修改结构时必须同步 Kotlin 侧解析逻辑。
 */

/** 转盘名在组件上的最大字数（窄条显示） */
export const WHEEL_NAME_MAX = 8;

/** 单盘选项下发上限（防止极端大盘把 prefs 撑爆；超出按权重降序取样） */
export const WHEEL_OPTIONS_MAX = 60;

/** 结果文字最大字数（窄条显示，超出截断） */
export const RESULT_TEXT_MAX = 8;

/** 一个盘（选项快照） */
export interface WheelSnapshot {
  id: string;
  /** 盘名（截断 WHEEL_NAME_MAX） */
  name: string;
  /** 转动后移除已选中选项（原生据此亮右上角小红点） */
  removeAfterSpin: boolean;
  /** 选项快照（desc 权重序，用于原生加权抽选） */
  options: { name: string; weight: number }[];
}

/** 完整计划 */
export interface WheelWidgetPlan {
  version: 1;
  generatedAt: number;
  wheels: WheelSnapshot[];
}

/** 盘输入（从 wheelDatabase 拿到的子集形状） */
export interface WheelLike {
  id: string;
  name: string;
  options: { name: string; weight: number }[];
  removeAfterSpin?: boolean;
}

/** 名称截断（窄条显示；为空兜底「转盘」） */
export function truncateWheelName(name: string, max: number = WHEEL_NAME_MAX): string {
  const t = (name || '').trim() || '转盘';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 结果文字截断 */
export function truncateResult(text: string, max: number = RESULT_TEXT_MAX): string {
  const t = (text || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * 组装单个盘快照：
 * - 名称截断；选项权重归一为 ≥1 的整数（与 WheelCanvas 口径一致）
 * - 选项按权重降序、最多 WHEEL_OPTIONS_MAX 个（原生抽选更可能命中高权重）
 * - 少于 2 个选项的盘仍下发（原生显示「选项不足」态）
 */
export function makeWheelSnapshot(wheel: WheelLike): WheelSnapshot {
  const opts = (wheel.options || [])
    .map(o => ({ name: String(o.name ?? ''), weight: Math.max(1, Math.round(Number(o.weight) || 1)) }))
    .filter(o => o.name.length > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, WHEEL_OPTIONS_MAX);
  return {
    id: wheel.id,
    name: truncateWheelName(wheel.name),
    removeAfterSpin: wheel.removeAfterSpin === true,
    options: opts,
  };
}

/**
 * 组装计划：
 * @param wheels  已排好序的盘列表（MRU 在前；调用方用 sortWheelsByRecent 排）
 * @param generatedAt 生成时刻
 */
export function assembleWheelPlan(wheels: WheelLike[], generatedAt: number): WheelWidgetPlan {
  return {
    version: 1,
    generatedAt,
    wheels: wheels.map(makeWheelSnapshot),
  };
}

/** 计划结构校验（JS 与原生解析前的防御） */
export function isValidWheelPlan(v: unknown): v is WheelWidgetPlan {
  if (!v || typeof v !== 'object') return false;
  const p = v as WheelWidgetPlan;
  if (p.version !== 1 || typeof p.generatedAt !== 'number' || !Array.isArray(p.wheels)) return false;
  return p.wheels.every(
    w =>
      !!w &&
      typeof w.id === 'string' &&
      typeof w.name === 'string' &&
      typeof w.removeAfterSpin === 'boolean' &&
      Array.isArray(w.options) &&
      w.options.every(o => !!o && typeof o.name === 'string' && typeof o.weight === 'number'),
  );
}

/* ═══════════════ 加权抽选（与 WheelCanvas.pickWeightedIndex 同口径） ═══════════════ */

/** 「连续抽到同一个」的观感惩罚系数（与 App 内一致） */
export const REPEAT_PENALTY = 0.25;

/**
 * 按权重抽出索引（复刻 App 内 pickWeightedIndex 的语义）：
 * - 选项数 ≥3 且有 lastIndex 时，对上次结果临时降权 REPEAT_PENALTY
 * - 否则标准加权随机
 * @param rand 随机源（默认 Math.random；单测可注入）
 */
export function pickWeightedIndexPure(
  options: { weight: number }[],
  lastIndex: number | null | undefined,
  rand: () => number = Math.random,
): number {
  if (options.length === 0) return -1;
  if (options.length === 1) return 0;
  if (options.length >= 3 && lastIndex != null && lastIndex >= 0 && lastIndex < options.length) {
    const weights = options.map((o, i) =>
      i === lastIndex ? Math.max(1, o.weight) * REPEAT_PENALTY : Math.max(1, o.weight),
    );
    const total = weights.reduce((s, w) => s + w, 0);
    let r = rand() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }
  const total = options.reduce((s, o) => s + Math.max(1, o.weight), 0);
  let r = rand() * total;
  for (let i = 0; i < options.length; i++) {
    r -= Math.max(1, options[i].weight);
    if (r <= 0) return i;
  }
  return options.length - 1;
}

/**
 * 生成「跳字老虎机」中间态序列（不含最终结果）。
 * 返回 max-1 个随机选项名（允许重复、允许与最终结果撞车 —— 观感更真实）。
 * 原生在每次重绘时取序列下一项，间隔由原生控制（约 90~120ms）。
 *
 * @param options  当前盘选项
 * @param finalIndex 最终结果索引（不参与中间态筛选，允许出现）
 * @param count    总跳数（含最终定格那一下）
 * @param rand     随机源（单测可注入）
 */
export function buildSpinSequence(
  options: { name: string; weight: number }[],
  finalIndex: number,
  count: number,
  rand: () => number = Math.random,
): string[] {
  const seq: string[] = [];
  if (options.length === 0) return seq;
  const hops = Math.max(1, count) - 1;
  for (let i = 0; i < hops; i++) {
    const idx = Math.floor(rand() * options.length);
    seq.push(options[Math.min(idx, options.length - 1)]?.name ?? '');
  }
  return seq;
}

/**
 * 完整「转动」：算出结果索引 → 结果文字 → 跳字序列。
 * 原生侧可直接用同一算法（Kotlin 版）；此处导出供 JS 侧单测与「结果预演」使用。
 */
export function spinResult(
  options: { name: string; weight: number }[],
  lastIndex: number | null,
  hops: number,
  rand: () => number = Math.random,
): { index: number; text: string; sequence: string[] } {
  const index = pickWeightedIndexPure(options, lastIndex, rand);
  if (index < 0) return { index: -1, text: '', sequence: [] };
  const text = options[index]?.name ?? '';
  const sequence = buildSpinSequence(options, index, hops, rand);
  return { index, text: truncateResult(text), sequence };
}

/* ═══════════════ 结果回传（原生 → JS 补写） ═══════════════ */

/**
 * 原生「转动」产生的待回传结果（存 prefs `wheel_pending_result_json`）。
 * App 下次启动时 JS 读取 → 补写 history + MRU → 清空。
 */
export interface WheelPendingResult {
  wheelId: string;
  /** 抽中的选项名 */
  text: string;
  /** 扇区索引（用于历史彩点） */
  index: number;
  /** 转动时刻 */
  at: number;
}

export function isValidPendingResult(v: unknown): v is WheelPendingResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as WheelPendingResult;
  return (
    typeof r.wheelId === 'string' &&
    r.wheelId.length > 0 &&
    typeof r.text === 'string' &&
    typeof r.index === 'number' &&
    typeof r.at === 'number'
  );
}
