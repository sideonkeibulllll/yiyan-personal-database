/**
 * 云端备份类型定义
 */

/** 云端备份配置（存 localStorage） */
export interface CloudBackupConfig {
  /** Cloudflare Account ID */
  accountId: string;
  /** D1 Database ID */
  d1DatabaseId: string;
  /** D1 API Token（需 D1 编辑权限） */
  d1ApiToken: string;
  /** R2 Bucket 名称 */
  r2BucketName: string;
  /** R2 Access Key ID */
  r2AccessKeyId: string;
  /** R2 Secret Access Key */
  r2SecretAccessKey: string;
  /** R2 自定义域名（可选，用于公开访问附件） */
  r2CustomDomain?: string;
}

/** 云端备份结果 */
export interface CloudBackupResult {
  /** 备份批次 ID */
  batchId: string;
  /** 备份时间戳 */
  timestamp: number;
  /** 新增/更新的条目数 */
  entriesSynced: number;
  /** 新增/更新的待办数 */
  todosSynced: number;
  /** 新增/更新的标签数 */
  tagsSynced: number;
  /** 新增/更新的组数 */
  groupsSynced: number;
  /** 新增/更新的链接数 */
  linksSynced: number;
  /** 新增/更新的模板数 */
  templatesSynced: number;
  /** 上传到 R2 的附件数 */
  attachmentsUploaded: number;
  /** 软删除同步数 */
  deletionsSynced: number;
  /** 耗时（ms） */
  duration: number;
  /** 错误信息 */
  errors: string[];
}

/** 云端恢复结果 */
export interface CloudRestoreResult {
  /** 拉取的条目数 */
  entriesPulled: number;
  /** 跳过的条目数（hash 已存在） */
  entriesSkipped: number;
  /** 拉取的待办数 */
  todosPulled: number;
  /** 跳过的待办数 */
  todosSkipped: number;
  /** 拉取的标签数 */
  tagsPulled: number;
  /** 拉取的组数 */
  groupsPulled: number;
  /** 拉取的链接数 */
  linksPulled: number;
  /** 拉取的模板数 */
  templatesPulled: number;
  /** 从 R2 下载的附件数 */
  attachmentsDownloaded: number;
  /** 耗时（ms） */
  duration: number;
  /** 错误信息 */
  errors: string[];
}

/** D1 查询响应 */
export interface D1QueryResponse {
  result: Array<{
    results: any[];
    success: boolean;
    meta: any;
  }>;
  errors?: Array<{ code: number; message: string }>;
  messages?: any[];
}

/** R2 对象元信息 */
export interface R2ObjectMeta {
  key: string;
  size: number;
  lastModified: string;
  etag: string;
}

/** D1 中的备份批次记录 */
export interface D1BackupBatch {
  id: string;
  timestamp: number;
  type: string;
  entry_count: number;
  todo_count: number;
  tag_count: number;
  group_count: number;
  attachment_count: number;
  app_version: string;
  created_at: number;
}

/** 云端备份配置的 localStorage key */
export const CLOUD_BACKUP_CONFIG_KEY = 'yiyan_cloud_backup_config';

/** R2 中附件存储的 key 前缀 */
export const R2_ATTACHMENT_PREFIX = 'attachments/';

/** D1 初始化 SQL（建表语句） */
export const D1_INIT_SQL = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT,
  supplement TEXT,
  is_starred INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  copy_count INTEGER DEFAULT 0,
  content_hash TEXT,
  backup_batch_id TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  is_smart INTEGER DEFAULT 0,
  search_criteria TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  backup_batch_id TEXT
);

CREATE TABLE IF NOT EXISTS groups_table (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  backup_batch_id TEXT
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  description TEXT,
  is_deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  backup_batch_id TEXT
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  note TEXT,
  folder_date TEXT,
  time TEXT,
  is_done INTEGER DEFAULT 0,
  is_today INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  backup_batch_id TEXT
);

CREATE TABLE IF NOT EXISTS todo_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  is_deleted INTEGER DEFAULT 0,
  backup_batch_id TEXT
);

CREATE TABLE IF NOT EXISTS todo_tag_relations (
  todo_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (todo_id, tag_id)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_deleted INTEGER DEFAULT 0,
  backup_batch_id TEXT
);

CREATE TABLE IF NOT EXISTS template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  title TEXT,
  note TEXT,
  time TEXT,
  sort_order INTEGER DEFAULT 0,
  backup_batch_id TEXT
);

CREATE TABLE IF NOT EXISTS attachments_meta (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  r2_key_orig TEXT,
  r2_key_thumb TEXT,
  mime_type TEXT,
  sort_order INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  backup_batch_id TEXT
);

CREATE TABLE IF NOT EXISTS _backup_manifests (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  entry_count INTEGER DEFAULT 0,
  todo_count INTEGER DEFAULT 0,
  tag_count INTEGER DEFAULT 0,
  group_count INTEGER DEFAULT 0,
  attachment_count INTEGER DEFAULT 0,
  app_version TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS _sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  messages TEXT NOT NULL,
  model TEXT,
  mcp_enabled_tools TEXT,
  mcp_search_results TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  backup_batch_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_updated ON entries(updated_at);
CREATE INDEX IF NOT EXISTS idx_todos_updated ON todos(updated_at);
CREATE INDEX IF NOT EXISTS idx_tags_updated ON tags(updated_at);
CREATE INDEX IF NOT EXISTS idx_entries_deleted ON entries(is_deleted);
CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments_meta(entry_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at);
`;
