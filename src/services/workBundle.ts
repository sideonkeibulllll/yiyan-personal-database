/**
 * 作品包导入（yiyan-mod v1）
 *
 * 一个 `.mod.zip` = 一个作品：包里带 `mod.json` 清单 + 生成的目录页入口，
 * 解压后按相对路径原样铺进 `works/<作品名>/`。
 *
 * 设计要点：
 * - **清单必填**：没有 mod.json 一律拒绝，避免裸 zip 散成一堆文件；
 * - **同 id = 升级**：id → 作品名记在 localStorage，再导只覆盖内容，
 *   应用数据和历史版本快照都不动，列表里仍是同一个卡片；
 * - **一个文件都不解码**：全部走 JSZip 的 base64 直出 + Filesystem 的 base64 管道，
 *   文本/图片/字体一视同仁，不猜编码，也就不会坏文件；
 * - **不存快照**：导入是整体替换，逐文件存快照会瞬间撑爆 fileAssets。
 *
 * 与电脑端 `pack.py` 保持同一套限制：2000 文件 / 单文件 20 MB / 总量 200 MB。
 */
import JSZip from 'jszip';
import {
  deleteWorkFile,
  listWorkFiles,
  sanitizeWorkName,
  uniqueWorkName,
  writeWorkBinary,
} from './workLibrary';

type ZipEntry = JSZip.JSZipObject;

export const BUNDLE_SPEC = 1;
export const BUNDLE_MAX_FILES = 2000;
export const BUNDLE_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const BUNDLE_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const ID_MAP_KEY = 'yiyan_mod_ids_v1';
const MAX_DEPTH = 8;

/** 平台不收的可执行类型，包里带了也跳过 */
const SKIP_EXT = new Set([
  'exe', 'dll', 'so', 'dylib', 'bat', 'cmd', 'ps1', 'msi',
  'apk', 'jar', 'sh', 'app', 'dmg', 'iso',
]);

export type BundleErrorCode =
  | 'not_zip'
  | 'empty'
  | 'missing_manifest'
  | 'bad_manifest'
  | 'missing_field'
  | 'invalid_spec'
  | 'invalid_id'
  | 'entry_missing'
  | 'bad_path'
  | 'too_many_files'
  | 'file_too_large'
  | 'too_large'
  | 'write_failed';

export interface BundleManifest {
  spec: number;
  id: string;
  name: string;
  version: string;
  entry: string;
  generatedEntry: boolean;
  cover: string | null;
  description: string | null;
}

export interface BundlePreparedFile {
  rel: string;
  /** zip 内的原始条目名（含顶层前缀） */
  raw: string;
  size: number;
}

export interface BundleReport {
  ok: boolean;
  code?: BundleErrorCode;
  message?: string;
  manifest?: BundleManifest;
  /** 会写入的文件（不含 mod.json） */
  files: BundlePreparedFile[];
  totalBytes: number;
  /** 同 id 已存在 → 升级到哪个作品 */
  upgradeOf?: string;
  warnings: string[];
}

export interface BundleImportResult extends BundleReport {
  workName?: string;
  upgraded?: boolean;
  writtenCount?: number;
}

interface IdMapEntry {
  work: string;
  version: string;
  at: number;
}

type IdMap = Record<string, IdMapEntry>;

// ===== id → 作品名 映射（判断升级用） =====

function loadIdMap(): IdMap {
  try {
    const raw = localStorage.getItem(ID_MAP_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as IdMap;
  } catch {
    return {};
  }
}

function saveIdMap(map: IdMap): void {
  try {
    localStorage.setItem(ID_MAP_KEY, JSON.stringify(map));
  } catch {
    /* 存不进去也不影响本次导入 */
  }
}

export function getBundleIdMap(): IdMap {
  return loadIdMap();
}

// ===== 包内路径清洗 =====

/** 包内相对路径：拒绝对路径、盘符、`..`、控制字符、过深目录 */
export function safeBundlePath(raw: string): string | null {
  const path = (raw || '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
  if (!path) return null;
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return null;
  const parts = path.split('/').filter(seg => seg.length > 0);
  if (parts.length === 0 || parts.length > MAX_DEPTH) return null;
  for (const seg of parts) {
    if (seg === '.' || seg === '..') return null;
    if (/[\u0000-\u001f]/.test(seg)) return null;
    if (seg.length > 120) return null;
  }
  return parts.join('/');
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function entrySize(entry: ZipEntry): number {
  // JSZip 3.x 在 loadAsync 后把解压后大小记在 _data.uncompressedSize；
  // 拿不到就返回 0，不阻塞（写盘时还有兜底判断）。
  const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
  const size = data?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : 0;
}

function manifestFromJson(raw: unknown): { manifest?: BundleManifest; code?: BundleErrorCode; message?: string } {
  if (!raw || typeof raw !== 'object') {
    return { code: 'bad_manifest', message: 'mod.json 不是一个 JSON 对象' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.spec === 'number' && obj.spec !== BUNDLE_SPEC) {
    return { code: 'invalid_spec', message: `清单 spec 是 ${obj.spec}，本版本只认 ${BUNDLE_SPEC}` };
  }
  for (const key of ['id', 'name', 'entry'] as const) {
    if (typeof obj[key] !== 'string' || !(obj[key] as string).trim()) {
      return { code: 'missing_field', message: `清单缺少 ${key} 字段` };
    }
  }
  const id = String(obj.id).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
    return { code: 'invalid_id', message: `id「${id}」只能用小写字母、数字、短横线` };
  }
  const entry = safeBundlePath(String(obj.entry));
  if (!entry) {
    return { code: 'entry_missing', message: `入口路径不合法：${String(obj.entry)}` };
  }
  return {
    manifest: {
      spec: BUNDLE_SPEC,
      id,
      name: String(obj.name).trim().slice(0, 60),
      version: typeof obj.version === 'string' && obj.version.trim() ? obj.version.trim() : '1.0',
      entry,
      generatedEntry: obj.generated_entry === true,
      cover: typeof obj.cover === 'string' && obj.cover.trim() ? safeBundlePath(obj.cover) : null,
      description: typeof obj.description === 'string' ? obj.description.slice(0, 300) : null,
    },
  };
}

/**
 * 只解析、不写盘：给「选完包先看报告」用。
 * 顶层只有一个文件夹时自动剥掉那一层（Mac 压缩常见）。
 */
function emptyReport(warnings: string[]): BundleReport {
  return { ok: false, files: [], totalBytes: 0, warnings };
}

/**
 * 解析已经读进内存的 zip。单独拆出来是为了让 importBundle 复用同一个 zip 实例，
 * 不然 200 多个文件的包会被 loadAsync 解析两遍。
 */
async function analyzeZip(zip: JSZip, warnings: string[]): Promise<BundleReport> {
  const empty = emptyReport(warnings);

  const all = Object.values(zip.files).filter(item => !item.dir);
  if (all.length === 0) {
    return { ...empty, code: 'empty', message: '压缩包是空的' };
  }

  // 定位 mod.json：根目录优先，其次唯一顶层目录下
  let prefix = '';
  let manifestEntry = all.find(item => item.name === 'mod.json');
  if (!manifestEntry) {
    const nested = all.filter(item => /^[^/]+\/mod\.json$/.test(item.name));
    if (nested.length === 1) {
      prefix = nested[0].name.slice(0, -'mod.json'.length);
      manifestEntry = nested[0];
    }
  }
  if (!manifestEntry) {
    return {
      ...empty,
      code: 'missing_manifest',
      message: '包里没有 mod.json —— 用「作品打包器」重新打一次，或者确认下选的是 .mod.zip',
    };
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(await manifestEntry.async('string'));
  } catch {
    return { ...empty, code: 'bad_manifest', message: 'mod.json 不是合法 JSON' };
  }

  const parsed = manifestFromJson(manifestJson);
  if (!parsed.manifest) {
    return { ...empty, code: parsed.code, message: parsed.message };
  }
  const manifest = parsed.manifest;

  // 收集文件 + 校验路径与体积
  const files: BundlePreparedFile[] = [];
  let totalBytes = 0;
  let skipped = 0;

  for (const item of all) {
    if (item === manifestEntry) continue;
    const stripped = prefix && item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name;
    const rel = safeBundlePath(stripped);
    if (!rel) {
      skipped += 1;
      continue;
    }
    const ext = rel.includes('.') ? rel.split('.').pop()!.toLowerCase() : '';
    if (SKIP_EXT.has(ext)) {
      skipped += 1;
      continue;
    }
    const size = entrySize(item);
    if (size > BUNDLE_MAX_FILE_BYTES) {
      return {
        ...empty,
        manifest,
        code: 'file_too_large',
        message: `${rel} 有 ${(size / 1024 / 1024).toFixed(1)} MB，超过单文件上限 20 MB`,
      };
    }
    totalBytes += size;
    files.push({ rel, raw: item.name, size });
  }

  if (files.length === 0) {
    return { ...empty, manifest, code: 'empty', message: '包里没有可用文件' };
  }
  if (files.length > BUNDLE_MAX_FILES) {
    return {
      ...empty,
      manifest,
      code: 'too_many_files',
      message: `包里有 ${files.length} 个文件，超过上限 ${BUNDLE_MAX_FILES}`,
    };
  }
  if (totalBytes > BUNDLE_MAX_TOTAL_BYTES) {
    return {
      ...empty,
      manifest,
      code: 'too_large',
      message: `解压后约 ${(totalBytes / 1024 / 1024).toFixed(0)} MB，超过上限 200 MB`,
    };
  }
  if (!files.some(item => item.rel === manifest.entry)) {
    return {
      ...empty,
      manifest,
      code: 'entry_missing',
      message: `清单写着从「${manifest.entry}」进，但包里的这个文件找不到`,
    };
  }
  if (skipped > 0) warnings.push(`跳过 ${skipped} 个文件（可执行类型或路径不合法）`);

  // 同 id 已装过 → 走升级
  const prev = loadIdMap()[manifest.id];
  let upgradeOf: string | undefined;
  if (prev?.work) {
    const existing = await listWorkFiles(prev.work);
    if (existing.length > 0) upgradeOf = prev.work;
  }

  return { ok: true, manifest, files, totalBytes, upgradeOf, warnings };
}

/** 只解析、不写盘：给「选完包先看报告」用 */
export async function inspectBundle(file: File | Blob): Promise<BundleReport> {
  try {
    return await analyzeZip(await JSZip.loadAsync(file), []);
  } catch {
    return { ...emptyReport([]), code: 'not_zip', message: '这个文件不是有效的 zip' };
  }
}

/**
 * 真正写盘。会先 inspect，再把文件逐个铺进作品文件夹。
 * - 首次导入：作品名 = 清单 name，重名自动加序号；
 * - 同 id 升级：清空旧文件后重写，作品名保持不变（应用数据按作品名分库，改名会丢）。
 */
export async function importBundle(
  file: File | Blob,
  opts: { onProgress?: (done: number, total: number) => void } = {},
): Promise<BundleImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return { ...emptyReport([]), code: 'not_zip', message: '这个文件不是有效的 zip' };
  }
  const report = await analyzeZip(zip, []);
  if (!report.ok || !report.manifest) return report;

  const manifest = report.manifest;
  const warnings = [...report.warnings];
  let workName: string;
  let upgraded = false;

  if (report.upgradeOf) {
    workName = report.upgradeOf;
    upgraded = true;
    const old = await listWorkFiles(workName);
    for (const item of old) {
      await deleteWorkFile(workName, item.path);
    }
  } else {
    workName = await uniqueWorkName(sanitizeWorkName(manifest.name));
  }

  let written = 0;

  try {
    // 清单本身也留在作品里：预览时靠它认出真正入口
    const manifestRaw = JSON.stringify(
      {
        spec: BUNDLE_SPEC,
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        entry: manifest.entry,
        ...(manifest.generatedEntry ? { generated_entry: true } : {}),
        ...(manifest.cover ? { cover: manifest.cover } : {}),
        ...(manifest.description ? { description: manifest.description } : {}),
      },
      null,
      2,
    );
    await writeWorkBinary(workName, 'mod.json', textToBase64(manifestRaw));

    for (let i = 0; i < report.files.length; i += 1) {
      const item = report.files[i];
      const entry = zip.file(item.raw);
      if (!entry) continue;
      const base64 = await entry.async('base64');
      await writeWorkBinary(workName, item.rel, base64);
      written += 1;
      if (opts.onProgress && (i % 8 === 0 || i === report.files.length - 1)) {
        opts.onProgress(i + 1, report.files.length);
      }
    }
  } catch (err) {
    return {
      ...report,
      ok: false,
      code: 'write_failed',
      message: `写入作品时出错：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const map = loadIdMap();
  map[manifest.id] = { work: workName, version: manifest.version, at: Date.now() };
  saveIdMap(map);

  if (upgraded && written !== report.files.length) {
    warnings.push(`有 ${report.files.length - written} 个文件没写成功`);
  }

  return { ...report, warnings, workName, upgraded, writtenCount: written };
}

/** 导入报告 → 一句话提示 */
export function describeBundleResult(result: BundleImportResult): string {
  if (!result.ok) return result.message ?? '导入失败';
  const pages = result.files.filter(item => /\.html?$/i.test(item.rel)).length;
  const head = result.upgraded
    ? `已更新「${result.workName}」`
    : `已导入「${result.workName}」`;
  return `${head} · ${pages} 个页面 / ${result.files.length} 个文件`;
}

/** 文件是不是 zip（安卓端 File 对象的 type 经常是空，得看后缀 + 魔数） */
export async function looksLikeZip(file: File): Promise<boolean> {
  if (/\.zip$/i.test(file.name)) return true;
  if (file.type === 'application/zip' || file.type === 'application/x-zip-compressed') return true;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  } catch {
    return false;
  }
}
