/**
 * Soul 事实库 · 蒸馏 / 拆解（v3.4.0）
 *
 * 两个 AI 辅助任务（**手动触发**；模型由用户在「管理事实库」面板里指定）：
 * 1. distillFromInbox：把「素材收件箱」的条目提炼为事实变更组（add/update/retire）
 * 2. extractFromLegacySoul：把旧版档案文本拆解为事实条目（迁移用）
 *
 * 调用基建：非流式单次请求（60s 超时）+ JSON 剥围栏容错（复用 worryAI 的 extractJson）；
 * 失败直接抛错，由 UI 提供重试。模型选择为独立复合值（与「怕了么」同款格式）。
 */
import { resolveEndpointForModelValue, extractJson } from './worryAI';
import { isSoulFactCategory, listSoulFacts, parseSoulChanges } from './soulFacts';
import { listMemories } from './aiMemory';
import { SOUL_CATEGORY_LABELS } from '@/types';
import type { SoulChanges, SoulFactCategory } from '@/types';

/** 蒸馏/拆解模型选择的存储键（'' = 全局默认，与「怕了么」同语义） */
export const SOUL_DISTILL_MODEL_KEY = 'yiyan_soul_distill_model_v1';

export function getSoulDistillModelValue(): string {
  try {
    return localStorage.getItem(SOUL_DISTILL_MODEL_KEY) || '';
  } catch {
    return '';
  }
}

export function setSoulDistillModelValue(value: string): void {
  try {
    localStorage.setItem(SOUL_DISTILL_MODEL_KEY, value);
  } catch {
    /* 忽略写入失败 */
  }
}

/** 请求超时（融合任务输出较长，比怕了么的 30s 宽） */
const REQUEST_TIMEOUT_MS = 60_000;
/** 单次提炼的收件箱条目上限 */
export const INBOX_MAX_ITEMS = 50;
/** 每条素材进入 prompt 的截断长度 */
const INBOX_ITEM_CLIP = 200;
/** 拆解旧档案的最大条目数 */
const MAX_MIGRATE_ITEMS = 20;

/** 非流式请求 + JSON 解析（安卓端普通 fetch 走 CapacitorHttp 原生补丁，无 CORS 问题） */
async function requestJson(systemPrompt: string, userMessage: string): Promise<any> {
  const endpoint = resolveEndpointForModelValue(getSoulDistillModelValue());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${endpoint.baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: 2400,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({} as any));
      throw new Error(error?.error?.message || `AI 请求失败: ${response.status}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return extractJson(content);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('AI 请求超时（60s），请重试或换一个模型');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ============ 蒸馏：收件箱 → 事实变更组 ============ */

export interface DistillResult {
  /** AI 生成的变更组（结构性解析，无需再校验） */
  changes: SoulChanges;
  /** AI 给出的整理说明（面板展示） */
  note: string;
  /** 本次输入（用于预览/清理/撤销） */
  usedMemories: ReturnType<typeof listMemories>;
}

const DISTILL_SYSTEM = `你是一个「个人事实库」整理助手。用户有一批零散素材（来自对话中暂存的收件箱条目），你的任务：把其中值得长期保留的**持久事实**提炼出来，并对照现有事实库生成一组变更。

铁律：
1. 只提炼「事实与状态」：身份、处境、状态、目标、经历五大类。
2. 不要提炼指令、偏好、倾向——凡是在替 AI 决定「怎么回应 / 怎么对待用户」的内容、以及「喜欢/讨厌某事物」类内容，一律丢弃。
3. 一次性/时效性素材（如「明天要交报告」）不提炼。
4. 与现有事实库对照：重复信息丢弃；信息有更新的用 update（提供 factId 或 matchText 原文片段）；已明显不再成立的用 retire；新信息用 add。
5. 每条事实是一条独立、完整、≤200 字的陈述；合并同一主题的素材，不要逐条罗列。
6. 没有值得提炼的内容时，返回空变更组（各类均为空数组）。

只输出一个 JSON 对象，不要输出任何其他文字：
{"add": [{"content": "…", "category": "identity|situation|state|goal|history"}], "update": [{"factId": "或用 matchText", "content": "…"}], "retire": [{"factId": "或用 matchText"}], "note": "一句话说明本次整理"}`;

/**
 * 从收件箱提炼事实变更组（不落盘；由 UI 预览确认后 applySoulChanges）。
 * @throws 收件箱为空 / AI 调用失败
 */
export async function distillFromInbox(): Promise<DistillResult> {
  const memories = listMemories();
  if (memories.length === 0) throw new Error('收件箱是空的，没有可提炼的素材');
  const usedMemories = memories.slice(0, INBOX_MAX_ITEMS);

  const itemsText = usedMemories
    .map((m, i) => `${i + 1}. ${m.content.slice(0, INBOX_ITEM_CLIP)}`)
    .join('\n');
  const factsText = listSoulFacts()
    .map(f => `[${f.id}]【${SOUL_CATEGORY_LABELS[f.category]}】${f.content}`)
    .join('\n') || '（事实库为空）';

  const json = await requestJson(
    DISTILL_SYSTEM,
    `## 现有事实库\n${factsText}\n\n## 待提炼素材（收件箱，共 ${usedMemories.length} 条）\n${itemsText}`,
  );
  return {
    changes: parseSoulChanges(json),
    note: String(json?.note ?? '').trim(),
    usedMemories,
  };
}

/* ============ 拆解：旧档案文本 → 事实条目（迁移） ============ */

export interface ExtractResult {
  facts: Array<{ content: string; category: SoulFactCategory }>;
  /** 被丢弃内容的概括（如「丢弃了 2 条偏好类描述」），空字符串 = 无 */
  dropped: string;
}

const EXTRACT_SYSTEM = `你是一个「个人档案整理助手」。请把用户的一段旧版档案文本拆解为若干条独立的事实条目。

铁律：
1. 只保留「事实与状态」（身份/处境/状态/目标/经历五大类）；指令、偏好、倾向类内容一律丢弃（凡是在替 AI 决定「怎么回应」的，以及「喜欢/讨厌某事物」的，都不保留）。
2. 每条为一条独立、完整的陈述，≤200 字；保留原文关键信息，不要添加原文没有的信息，不要臆测。
3. 分类从 identity（身份）/ situation（处境）/ state（状态）/ goal（目标）/ history（经历）中选择；拿不准的放 history。
4. 最多拆 ${MAX_MIGRATE_ITEMS} 条。

只输出一个 JSON 对象，不要输出任何其他文字：
{"facts": [{"content": "…", "category": "identity|situation|state|goal|history"}], "dropped": "若丢弃了指令/偏好类内容，用一句话概括（否则为空字符串）"}`;

/**
 * 把旧版档案文本拆解为事实条目（不落盘；由 UI 预览确认后写入）。
 * @throws 文本为空 / AI 调用失败 / 未拆出任何条目
 */
export async function extractFromLegacySoul(text: string): Promise<ExtractResult> {
  const src = String(text || '').trim();
  if (!src) throw new Error('旧档案文本为空');
  const json = await requestJson(EXTRACT_SYSTEM, `## 旧档案文本\n${src}`);
  const raw = Array.isArray(json?.facts) ? json.facts : [];
  const facts = raw
    .filter((x: any) => x && typeof x.content === 'string' && x.content.trim())
    .slice(0, MAX_MIGRATE_ITEMS)
    .map((x: any) => ({
      content: String(x.content).trim(),
      category: isSoulFactCategory(x.category) ? x.category : ('history' as SoulFactCategory),
    }));
  if (facts.length === 0) {
    throw new Error('AI 未能从旧档案中拆解出事实条目（可能内容多为指令/偏好，或模型输出异常）');
  }
  return { facts, dropped: String(json?.dropped ?? '').trim() };
}
