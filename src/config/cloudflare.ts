// Cloudflare 接入配置
// 密钥通过构建期环境变量（.env，已被 git 忽略）注入，由 Vite 打包进 APK。
// 源码中不存放任何密钥，请勿在此硬编码真实 token / secret。
// 构建前请在项目根目录 .env 中填写 VITE_CF_* 变量（详见 .env 示例）。
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;

const str = (key: string, fallback = ""): string => env[key] ?? fallback;

export const CF = {
  accountId: str("VITE_CF_ACCOUNT_ID"),
  d1DatabaseId: str("VITE_CF_D1_DATABASE_ID"),
  d1ApiToken: str("VITE_CF_D1_API_TOKEN"),
  r2Bucket: str("VITE_CF_R2_BUCKET", "memory"),
  r2AccessKeyId: str("VITE_CF_R2_ACCESS_KEY_ID"),
  r2SecretAccessKey: str("VITE_CF_R2_SECRET_ACCESS_KEY"),
  r2PublicDomain: str("VITE_CF_R2_PUBLIC_DOMAIN", "yiyanr2.8765777.xyz"),
} as const;

// 中转站配置（Cloudflare Worker 代理）
// 个人数据库走 memory 逻辑库/桶
export const TRANSFER_STATION = {
  url: str("VITE_CF_TRANSFER_URL", "https://cloudflare.8765777.xyz"),
  token: str("VITE_CF_TRANSFER_TOKEN"),
  db: "memory" as const,
  bucket: "memory" as const,
};

export const D1_API = `https://api.cloudflare.com/client/v4/accounts/${CF.accountId}/d1/database/${CF.d1DatabaseId}/query`;

export const R2_ENDPOINT = `https://${CF.accountId}.r2.cloudflarestorage.com`;
