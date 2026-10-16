/**
 * 模板「自动应用」星期工具（v3.5.0）
 *
 * 存储格式：逗号分隔的 ISO 周几数字（"1"=周一 … "7"=周日），例："1,2,3,4,5"。
 * 空 / undefined = 不自动应用。
 */

/** 解析为去重升序的数字数组（容错：非法值直接忽略） */
export function parseAutoWeekdays(raw?: string | null): number[] {
  if (!raw) return [];
  const set = new Set<number>();
  for (const part of raw.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 7) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** 序列化为存储格式（空数组 → 空串） */
export function formatAutoWeekdays(days: number[]): string {
  const norm = Array.from(new Set(days.filter(d => d >= 1 && d <= 7))).sort((a, b) => a - b);
  return norm.join(',');
}

/** 指定日期是否命中规则（默认今天，本地时区；getDay 的 0=周日 → ISO 7） */
export function matchesAutoWeekdays(raw?: string | null, date: Date = new Date()): boolean {
  const days = parseAutoWeekdays(raw);
  if (days.length === 0) return false;
  const iso = date.getDay() === 0 ? 7 : date.getDay();
  return days.includes(iso);
}

/** 周几中文短名（1=周一 … 7=周日） */
export const WEEKDAY_LABELS: Record<number, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};
