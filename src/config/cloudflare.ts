// Cloudflare 接入配置
//
// ── v2.7.0 安全性改造 ─────────────────────────────────────────────
// 以前：accountId / D1 token / R2 AK·SK 都经 Vite 的 VITE_CF_* 注入，
//       全部被打包进 APK，谁反编译安装包谁就能拿到。
// 现在：**安装包里不再含任何密钥**。
//       - 应用只走「中转站」（Cloudflare Worker 代理）这一条数据通路；
//       - 中转站地址保留一个非密钥的默认值（可被设置覆盖）；
//       - 中转站 token 由用户在「设置 → 云端备份」手填，存进 settings（localStorage），
//         运行时通过 setTransferConfig() 注入，改完立即生效；
//       - D1 / R2 的直连密钥与端点（D1_API、R2_ENDPOINT、aws4fetch 签名）已整体移除。
//
// ⚠️ 新增任何云能力时，请沿用「只走中转站 + 密钥不落源码」这条规矩。

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

/** 中转站默认地址（非密钥；设置页可覆盖） */
export const TRANSFER_URL_DEFAULT = 'https://cloudflare.8765777.xyz';

/** R2 附件公开访问域名（非密钥；设置页可覆盖） */
export const R2_PUBLIC_DOMAIN_DEFAULT = 'yiyanr2.8765777.xyz';

export interface TransferConfig {
  /** 中转站地址 */
  url: string;
  /** 中转站密钥（手填） */
  token: string;
  /** D1 逻辑库名 */
  db: string;
  /** R2 逻辑桶名 */
  bucket: string;
  /** R2 附件公开域名 */
  publicDomain: string;
}

/** 规范化中转站地址：缺协议时自动补 https://，并去掉尾部斜杠 */
function normalizeUrl(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return withProto.replace(/\/+$/, '');
}

/** 规范化公开域名：去掉协议前缀与尾部斜杠 */
function normalizeDomain(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

const DEFAULTS: TransferConfig = {
  url: normalizeUrl(env.VITE_CF_TRANSFER_URL) || TRANSFER_URL_DEFAULT,
  token: '',
  db: 'memory',
  bucket: 'memory',
  publicDomain: normalizeDomain(env.VITE_CF_R2_PUBLIC_DOMAIN) || R2_PUBLIC_DOMAIN_DEFAULT,
};

/** 运行时的当前配置（由 settingsStore 注入） */
let runtime: TransferConfig | null = null;

/**
 * 注入运行时配置。
 * settingsStore 在「首次加载」与「用户修改设置」两处调用，
 * 保证设置页保存后无需重启即可生效。
 *
 * 空字符串/undefined 的字段会被忽略（回退到 DEFAULTS），
 * 这样用户在设置页只填 token 也能正常工作。
 *
 * ⚠️ URL 会被 normalizeUrl 补全协议 —— 用户手填 `cloudflare.example.com`
 * 这种不带协议的写法时必须自动补 `https://`，否则拼出来是相对路径，
 * 安卓原生端（CapacitorHttp）会直接抛 `MalformedURLException: no protocol`。
 */
export function setTransferConfig(cfg: Partial<TransferConfig> | null): void {
  if (!cfg) { runtime = null; return; }
  const next: TransferConfig = { ...DEFAULTS };

  const url = normalizeUrl(cfg.url);
  if (url) next.url = url;

  const domain = normalizeDomain(cfg.publicDomain);
  if (domain) next.publicDomain = domain;

  (['token', 'db', 'bucket'] as const).forEach(key => {
    const v = cfg[key];
    if (typeof v === 'string' && v.trim()) next[key] = v.trim();
  });

  runtime = next;
}

export function getTransferConfig(): TransferConfig {
  const cfg = runtime ?? DEFAULTS;
  // 兜底：URL 无论如何都不允许为空（空 URL → 相对路径 → 原生端 "no protocol"）
  const url = normalizeUrl(cfg.url) || DEFAULTS.url || TRANSFER_URL_DEFAULT;
  return { ...cfg, url };
}

/** 是否已配置好中转站（token 是唯一的必填项） */
export function isTransferReady(): boolean {
  const cfg = getTransferConfig();
  return !!cfg.url && !!cfg.token;
}

/**
 * 断言中转站已配置好，未配置时抛出**人话**错误。
 *
 * 不做这个检查的话，原生端只会抛
 * `java.net.MalformedURLException: no protocol: /d1/query`，
 * 完全看不出是「没填密钥」还是「地址写错了」。
 */
export function assertTransferReady(): void {
  const cfg = getTransferConfig();
  if (!cfg.url) {
    throw new Error('中转站地址为空 —— 请到「设置 → 云端备份 → 中转站连接」填写地址');
  }
  if (!cfg.token) {
    throw new Error('中转站密钥未填写 —— 请到「设置 → 云端备份 → 中转站连接」填入 Token');
  }
}

/**
 * 对象式访问（d1Client / r2Client 沿用这个写法）。
 * 用 getter 而不是普通属性：每次读取都拿**当前**运行时配置，
 * 设置页改完立即生效，不需要重新导入模块。
 */
export const TRANSFER_STATION = {
  get url(): string { return getTransferConfig().url; },
  get token(): string { return getTransferConfig().token; },
  get db(): string { return getTransferConfig().db; },
  get bucket(): string { return getTransferConfig().bucket; },
};

/** R2 公开域名（非密钥） */
export const CF = {
  get r2PublicDomain(): string { return getTransferConfig().publicDomain; },
};
