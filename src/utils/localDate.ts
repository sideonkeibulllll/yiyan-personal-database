/**
 * 本地日期工具（北京时间 / 设备本地时区）。
 *
 * ⚠️ 禁止再用 `new Date().toISOString().slice(0, 10)` 取「今天」——
 * `toISOString()` 返回的是 UTC 日期，北京时间凌晨 0:00 ~ 8:00 之间
 * UTC 还停留在前一天，会取到「昨天」，导致：
 *   - get_today_todos / create_todo 等 MCP 工具返回错一天的日期；
 *   - 凌晨创建的待办落进昨天的日期文件夹。
 * 统一改用本文件的 localDateKey()。
 */

/** 本地日期键（YYYY-MM-DD），默认取当前时刻 */
export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
