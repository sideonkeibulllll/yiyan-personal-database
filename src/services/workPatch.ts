/**
 * 作品文件的局部编辑（v4.2.0）
 *
 * 背景：v3.8.x 的 write_file 只能「整份覆盖」——AI 给一个 200KB 的作品
 * 加一行 `<meta name="cover">`，也得把全文重新输出一遍。token 是小事，
 * 真正的风险是长文件重打必失真（漏行、改缩进、编码漂移）。
 *
 * 这里实现「编辑器式」的局部替换（对标 Cline/Cursor 的 search-replace、
 * Claude Code 的 Edit 工具），规则只有三条：
 *
 * 1. `find` 必须在**当前文本里恰好出现 1 次**才替换；0 次或多次都算失败，
 *    并把「附近最像的几行」回传给模型，让它补上下文重试。
 *    绝不学 `String.replace` 只换第一处——那是最容易静默改错的路径。
 * 2. 只有 `all: true` 才允许多处替换（明确要求的批量改名、批量加属性）。
 * 3. 多次编辑在**副本**上顺序执行，任何一处失败整批作废（原子性），
 *    调用方拿到的 ok:false 意味着一个字节都没写进去。
 *
 * 纯函数、不碰文件系统：便于用 node 脚本直接单测（见 test/workPatch.test.mjs）。
 */

export interface WorkEdit {
  /** 要在文件里找的原文（建议带 3~5 行上下文，保证唯一） */
  find: string;
  /** 替换成什么（空串 = 删掉这段） */
  replace: string;
  /** 允许 find 出现多次并全部替换（默认 false，要求唯一） */
  all?: boolean;
}

export interface AppliedEdit {
  /** 第几处编辑（1-based，对应入参顺序） */
  index: number;
  /** 命中次数 */
  hits: number;
  /** 每处替换所在行号（1-based） */
  lines: number[];
  /** 替换后的首行摘要（给模型/UI 看） */
  preview: string;
}

export type EditFailureReason = 'empty-find' | 'find-equals-replace' | 'not-found' | 'ambiguous';

export interface EditFailure {
  /** 出问题的是第几处编辑（1-based） */
  index: number;
  reason: EditFailureReason;
  /** 给模型看的建议（含行号与附近内容提示） */
  message: string;
  /** 附近可能想匹配的位置（行号 + 整行内容，已截断） */
  nearby: Array<{ line: number; text: string }>;
  /** 这一处实际命中的次数（ambiguous 时有意义） */
  hits: number;
  /** 命中所在行号（ambiguous 时有意义） */
  lines: number[];
}

export type ApplyEditResult =
  | { ok: true; text: string; applied: AppliedEdit[]; before: number; after: number }
  | { ok: false; failure: EditFailure; appliedBefore: AppliedEdit[] };

/** 单次编辑的 find / replace 长度上限（防止模型把整份文件塞进 find） */
export const EDIT_FIND_MAX_CHARS = 200_000;
export const EDIT_REPLACE_MAX_CHARS = 200_000;
/** 一次调用最多几处编辑（每个文件） */
export const EDIT_MAX_PER_FILE = 10;

const LINE_PREVIEW_MAX = 160;

function linePreview(text: string): string {
  const trimmed = text.replace(/\s+$/g, '');
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}

/** 统计 find 在 text 里出现的次数与每次的起点 */
function findHits(text: string, find: string): number[] {
  const hits: number[] = [];
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(find, from);
    if (at < 0) break;
    hits.push(at);
    from = at + Math.max(1, find.length);
  }
  return hits;
}

/** 字符下标 → 1-based 行号（按 \n 计数） */
function lineOfIndex(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** 取某行（1-based）的内容，越界返回空串 */
function lineAt(lines: string[], line: number): string {
  return lines[line - 1] ?? '';
}

/**
 * 找「附近最像的行」：拿 find 里最长的、去掉首尾空白后仍有 8 字以上的那一行，
 * 去文件里找包含它的行（最多 3 条）。
 * 比较前把连续空白折叠成一个空格——「缩进/空格数量不一致」是模型改错的首要原因，
 * 直接按原样比较会一条候选都给不出来。
 */
function nearbyLines(text: string, find: string, max = 3): Array<{ line: number; text: string }> {
  const lines = text.split('\n');
  const norm = (value: string) => value.replace(/[\s\u3000]+/g, ' ').trim();
  const candidates = find
    .split('\n')
    .map(line => norm(line))
    .filter(line => line.length >= 8)
    .sort((a, b) => b.length - a.length);
  const needle = candidates[0];
  if (!needle) return [];
  // 长片段优先；差异落在中间时退到短片段；空格数量不一致时退到「去掉所有空格」再比
  const rawProbes: Array<{ kind: 'flat' | 'nospace'; value: string }> = [
    { kind: 'flat', value: needle.slice(0, 60) },
    { kind: 'flat', value: needle.slice(0, 24) },
    { kind: 'nospace', value: needle.split(' ').join('').slice(0, 24) },
  ];
  const probes = rawProbes.filter(probe => probe.value.length >= 6);
  if (probes.length === 0) return [];
  const out: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const flat = norm(lines[i]!);
    const nospace = flat.split(' ').join('');
    const matched = probes.some(probe => (
      probe.kind === 'flat' ? flat.includes(probe.value) : nospace.includes(probe.value)
    ));
    if (matched) {
      out.push({ line: i + 1, text: linePreview(lines[i]!) });
      if (out.length >= max) break;
    }
  }
  return out;
}

/** 命中行的上下文（前一行 / 本行 / 后一行），给 ambiguous 用 */
function contextAt(text: string, index: number): Array<{ line: number; text: string }> {
  const lines = text.split('\n');
  const line = lineOfIndex(text, index);
  const out: Array<{ line: number; text: string }> = [];
  for (let n = Math.max(1, line - 1); n <= Math.min(lines.length, line + 1); n++) {
    out.push({ line: n, text: linePreview(lineAt(lines, n)) });
  }
  return out;
}

/**
 * 把一批编辑应用到文本上（纯函数）。
 *
 * 返回值里 `ok:false` 时 `text` 一定没被改动过——调用方直接报错即可，
 * 不存在「改了一半」的状态。
 */
export function applyEdits(source: string, edits: WorkEdit[]): ApplyEditResult {
  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      ok: false,
      appliedBefore: [],
      failure: { index: 0, reason: 'empty-find', message: 'edits 不能为空', nearby: [], hits: 0, lines: [] },
    };
  }

  let text = source;
  const applied: AppliedEdit[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    const index = i + 1;
    const find = typeof edit?.find === 'string' ? edit.find : '';
    const replace = typeof edit?.replace === 'string' ? edit.replace : '';

    if (find.length === 0) {
      return {
        ok: false,
        appliedBefore: applied,
        failure: {
          index,
          reason: 'empty-find',
          message: 'find 不能为空（空字符串会命中每个位置）',
          nearby: [],
          hits: 0,
          lines: [],
        },
      };
    }
    if (find.length > EDIT_FIND_MAX_CHARS || replace.length > EDIT_REPLACE_MAX_CHARS) {
      return {
        ok: false,
        appliedBefore: applied,
        failure: {
          index,
          reason: 'empty-find',
          message: `第 ${index} 处的 find/replace 超过 ${EDIT_FIND_MAX_CHARS} 字符，请缩小改动范围`,
          nearby: [],
          hits: 0,
          lines: [],
        },
      };
    }
    if (find === replace) {
      return {
        ok: false,
        appliedBefore: applied,
        failure: {
          index,
          reason: 'find-equals-replace',
          message: `第 ${index} 处的 find 与 replace 完全相同，等于没改`,
          nearby: [],
          hits: 0,
          lines: [],
        },
      };
    }

    const hits = findHits(text, find);
    const lines = hits.map(at => lineOfIndex(text, at));

    if (hits.length === 0) {
      const nearby = nearbyLines(text, find);
      const hint = nearby.length > 0
        ? `文件里没有这段原文。最相近的是第 ${nearby.map(n => n.line).join('、')} 行，请照着文件里的真实内容（含缩进）重写 find。`
        : '文件里没有这段原文。建议先用 search_in_work 或 read_file 确认实际内容（注意缩进与标点）。';
      return {
        ok: false,
        appliedBefore: applied,
        failure: { index, reason: 'not-found', message: hint, nearby, hits: 0, lines: [] },
      };
    }

    if (hits.length > 1 && edit.all !== true) {
      const contexts = hits.slice(0, 3).flatMap(at => contextAt(text, at));
      return {
        ok: false,
        appliedBefore: applied,
        failure: {
          index,
          reason: 'ambiguous',
          message: `这段原文出现了 ${hits.length} 次（第 ${lines.join('、')} 行），无法确定改哪一处。请带上前后各 1~2 行让它唯一；确实要全改就传 all: true。`,
          nearby: contexts,
          hits: hits.length,
          lines,
        },
      };
    }

    if (edit.all === true) {
      text = text.split(find).join(replace);
    } else {
      const at = hits[0]!;
      text = text.slice(0, at) + replace + text.slice(at + find.length);
    }

    applied.push({
      index,
      hits: hits.length,
      lines: lines.slice(0, 20),
      preview: replace.length > 0 ? linePreview(replace) : '（删除该片段）',
    });
  }

  return { ok: true, text, applied, before: source.length, after: text.length };
}

/** 把失败结果压成一句给模型看的话（工具回执里用） */
export function describeEditFailure(failure: EditFailure): string {
  const lines = [`第 ${failure.index} 处编辑失败：${failure.message}`];
  if (failure.nearby.length > 0) {
    lines.push('附近内容：');
    for (const item of failure.nearby) lines.push(`  ${item.line}| ${item.text}`);
  }
  return lines.join('\n');
}
