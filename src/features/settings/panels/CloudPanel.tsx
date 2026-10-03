/**
 * 设置面板 - 云端备份
 *
 * 状态与云端备份逻辑由父组件 SettingsPage 持有，本组件负责展示；
 * 另外直连 settingsStore 维护「中转站连接」配置（密钥手填，v2.7.0）。
 */
import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { TRANSFER_URL_DEFAULT, R2_PUBLIC_DOMAIN_DEFAULT } from '@/config/cloudflare';

interface CloudPanelProps {
  /** 云端备份模块是否已加载（懒加载完成后为 true） */
  moduleLoaded: boolean;
  moduleLoading: boolean;
  message: string;
  busy: boolean;
  lastBackupTs: number | null;
  backupHistory: any[];
  onLoadModule: () => void;
  onTestCloud: () => void;
  onCloudBackup: () => void;
  onCloudRestore: () => void;
}

export function CloudPanel({
  moduleLoaded,
  moduleLoading,
  message,
  busy,
  lastBackupTs,
  backupHistory,
  onLoadModule,
  onTestCloud,
  onCloudBackup,
  onCloudRestore,
}: CloudPanelProps) {
  const cloud = useSettingsStore(state => state.settings.cloud);
  const updateCloudConfig = useSettingsStore(state => state.updateCloudConfig);

  // 本地草稿：点保存才落库，避免每敲一个字符都写一次数据库
  const [draft, setDraft] = useState({
    url: cloud?.url || '',
    token: cloud?.token || '',
    publicDomain: cloud?.publicDomain || '',
  });
  const [showToken, setShowToken] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // 外部（首次加载 / 云恢复 / 重置）改动时同步草稿
  useEffect(() => {
    setDraft({
      url: cloud?.url || '',
      token: cloud?.token || '',
      publicDomain: cloud?.publicDomain || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud?.url, cloud?.token, cloud?.publicDomain]);

  const dirty =
    draft.url !== (cloud?.url || '') ||
    draft.token !== (cloud?.token || '') ||
    draft.publicDomain !== (cloud?.publicDomain || '');

  const handleSave = () => {
    updateCloudConfig({
      url: draft.url.trim(),
      token: draft.token.trim(),
      publicDomain: draft.publicDomain.trim(),
    });
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">云端备份</h2>

      {/* ===== 中转站连接（密钥手填） ===== */}
      <div className="settings-subsection-title">中转站连接</div>
      <div className="form-hint" style={{ marginBottom: '10px' }}>
        为安全起见，安装包内<strong>不再内置任何密钥</strong>。请把你的中转站 token 填在这里（仅存本机）。
      </div>

      <div className="form-group">
        <label className="form-label">中转站地址</label>
        <input
          className="form-input"
          type="text"
          inputMode="url"
          value={draft.url}
          onChange={e => setDraft(d => ({ ...d, url: e.target.value }))}
          placeholder={TRANSFER_URL_DEFAULT}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="form-hint">
          不用写 <code>https://</code>，会自动补全；留空则用默认地址
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">中转站密钥（Token）</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            className="form-input"
            type={showToken ? 'text' : 'password'}
            value={draft.token}
            onChange={e => setDraft(d => ({ ...d, token: e.target.value }))}
            placeholder="粘贴你的中转站 token"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="form-reset-btn"
            type="button"
            onClick={() => setShowToken(v => !v)}
            style={{ whiteSpace: 'nowrap' }}
          >
            {showToken ? '隐藏' : '显示'}
          </button>
        </div>
        {!draft.token && (
          <div className="form-hint" style={{ color: 'var(--color-warning, #f59f00)' }}>
            未填写密钥时，云备份 / 附件上传将无法使用。
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">R2 附件公开域名</label>
        <input
          className="form-input"
          type="text"
          value={draft.publicDomain}
          onChange={e => setDraft(d => ({ ...d, publicDomain: e.target.value }))}
          placeholder={R2_PUBLIC_DOMAIN_DEFAULT}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="form-group">
        <button
          className="form-reset-btn"
          type="button"
          onClick={handleSave}
          disabled={!dirty && !justSaved}
        >
          {justSaved ? '✓ 已保存' : (dirty ? '保存连接配置' : '配置已保存')}
        </button>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border-primary)', margin: '16px 0' }} />

      {!moduleLoaded ? (
        <>
          <div className="form-hint" style={{ marginBottom: '12px' }}>
            Cloudflare D1 + R2 远程备份（中转站模式）
          </div>
          <div className="form-group">
            <button
              className="form-reset-btn"
              onClick={onLoadModule}
              disabled={moduleLoading}
            >
              {moduleLoading ? '加载中...' : '初始化云端备份模块'}
            </button>
          </div>
          <div className="form-hint" style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            ℹ️ 点击按钮后才会加载云端备份模块，避免影响启动速度
          </div>
          {message && (
            <div className="form-hint" style={{ marginTop: '8px' }}>{message}</div>
          )}
        </>
      ) : (
        <>
          <div className="form-hint" style={{ marginBottom: '12px' }}>
            {lastBackupTs
              ? `上次备份: ${new Date(lastBackupTs).toLocaleString('zh-CN')}`
              : 'Cloudflare D1 + R2 · 中转站模式'}
          </div>

          <div className="settings-subsection-title">操作</div>
          <div className="form-group" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="form-reset-btn"
              onClick={onTestCloud}
              disabled={busy}
            >
              {busy ? '测试中...' : '测试连接'}
            </button>
            <button
              className="form-reset-btn"
              onClick={onCloudBackup}
              disabled={busy}
            >
              {busy ? '备份中...' : '增量备份'}
            </button>
            <button
              className="form-reset-btn"
              onClick={onCloudRestore}
              disabled={busy}
            >
              {busy ? '恢复中...' : '从云端恢复'}
            </button>
          </div>

          {lastBackupTs && (
            <div className="form-hint">
              上次备份: {new Date(lastBackupTs).toLocaleString('zh-CN')}
            </div>
          )}

          {message && (
            <div className="form-hint" style={{ whiteSpace: 'pre-wrap', marginTop: '8px' }}>
              {message}
            </div>
          )}

          {backupHistory.length > 0 && (
            <>
              <div className="settings-subsection-title" style={{ marginTop: '16px' }}>备份历史</div>
              <div className="backup-list">
                {backupHistory.slice(0, 10).map((item: any) => (
                  <div key={item.id} className="backup-item">
                    <div className="backup-item-info">
                      <div className="backup-item-name">
                        {new Date(item.timestamp).toLocaleString('zh-CN')}
                      </div>
                      <div className="backup-item-meta">
                        {item.entry_count} 条 · {item.todo_count} 待办 · v{item.app_version}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
