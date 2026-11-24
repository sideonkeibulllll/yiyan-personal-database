/**
 * 作品内搜索的匹配规则（v4.2.1）
 *
 * 背景：v4.2.0 的 search_in_work 是纯子串匹配，AI 搜 `cover` 时
 * discover / recovered / second_pass_recovered 全被捞回来，30 条里真正相关的不到 3 条。
 * 这里给 ASCII 词/短语加「整词匹配」，中文仍走子串 —— 中文没有词边界概念，
 * 硬加 `\b` 只会漏掉「封面配置」这类连写。
 *
 * 纯函数、零依赖：便于 node 单测（test 脚本见 _scratch_yiyan/_workSearch.test.mjs）。
 */

const WORD_CHAR_RE = /[A-Za-z0-9]/;

/** 是否「ASCII 词/短语」——只有它才适合整词匹配 */
export function isAsciiWordQuery(query: string): boolean {
  if (!query) return false;
  return /^[A-Za-z0-9_.\-/ ]+$/.test(query) && /[A-Za-z0-9]/.test(query);
}

/**
 * 整词匹配：命中位置前后不能紧邻字母/数字。
 *
 * 下划线 / 点 / 斜杠 / 引号都算分隔符，所以：
 * - `cover` 命中 `<meta name="cover">`、`assets/cover.jpg`、`cover_big.png`
 * - `cover` 不命中 `discover`、`recovered`、`second_pass_recovered`
 *
 * 不用 lookbehind（老 WebView 不保证支持），手动判字符更稳。
 */
export function includesWholeWord(row: string, query: string): boolean {
  if (!row || !query) return false;
  const haystack = row.toLowerCase();
  const needle = query.toLowerCase();
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at > 0 ? haystack.charAt(at - 1) : '';
    const after = at + needle.length < haystack.length ? haystack.charAt(at + needle.length) : '';
    const okBefore = before === '' || !WORD_CHAR_RE.test(before);
    const okAfter = after === '' || !WORD_CHAR_RE.test(after);
    if (okBefore && okAfter) return true;
    from = at + 1;
  }
  return false;
}
