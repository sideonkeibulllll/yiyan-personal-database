/**
 * 首页 - 录入页面
 * 极简输入框 + 粘贴/发送按钮
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clipboard } from '@capacitor/clipboard';
import { useEntryStore } from '@/stores/entryStore';
import { BottomNav } from '@/components/BottomNav';
import './HomePage.css';

type InputMode = 'input' | 'tag' | 'info';

export function HomePage() {
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<InputMode>('input');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const navigate = useNavigate();
  const addEntry = useEntryStore(state => state.addEntry);

  // 自动聚焦
  useEffect(() => {
    if (mode === 'input' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  // 显示轻提示
  const showToastMessage = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  }, []);

  // 读取剪贴板
  const readClipboard = useCallback(async () => {
    try {
      const { value } = await Clipboard.read();
      if (value) {
        setContent(value);
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }
    } catch {
      // 剪贴板读取失败，静默处理
    }
  }, []);

  // 发送/录入
  const handleSend = useCallback(async () => {
    if (!content.trim()) return;

    await addEntry(content.trim());
    setContent('');
    showToastMessage('已入库');

    // 切换到标签/信息选择模式
    setMode('tag');

    // 3秒后自动回退到输入模式
    if (modeTimerRef.current) {
      clearTimeout(modeTimerRef.current);
    }
    modeTimerRef.current = setTimeout(() => {
      setMode('input');
    }, 3000);
  }, [content, addEntry, showToastMessage]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // 选择添加标签
  const handleAddTag = useCallback(() => {
    if (modeTimerRef.current) {
      clearTimeout(modeTimerRef.current);
    }
    // TODO: 打开标签选择栏
    showToastMessage('标签功能开发中...');
    setMode('input');
  }, [showToastMessage]);

  // 选择添加信息
  const handleAddInfo = useCallback(() => {
    if (modeTimerRef.current) {
      clearTimeout(modeTimerRef.current);
    }
    // TODO: 打开信息附加面板
    showToastMessage('信息附加功能开发中...');
    setMode('input');
  }, [showToastMessage]);

  return (
    <div className="home-page">
      <header className="page-header">
        <h1 className="page-title text-gradient">记忆库</h1>
        <p className="page-subtitle">随手扔进去，常翻常新</p>
      </header>

      <main className="page-content">
        {mode === 'input' ? (
          <div className="input-section">
            <div className="input-wrapper glass">
              <textarea
                ref={textareaRef}
                className="content-input"
                value={content}
                onChange={e => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="记录你的想法..."
                rows={4}
              />
            </div>

            <div className="input-actions">
              <button className="action-btn secondary" onClick={readClipboard}>
                <span className="btn-icon">📋</span>
                <span>粘贴</span>
              </button>
              <button
                className="action-btn primary"
                onClick={handleSend}
                disabled={!content.trim()}
              >
                <span className="btn-icon">✨</span>
                <span>发送</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="mode-section">
            <p className="mode-hint">为上一条添加信息？</p>
            <div className="mode-actions">
              <button className="mode-btn glass" onClick={handleAddTag}>
                <span className="btn-icon">🏷️</span>
                <span>添加标签</span>
              </button>
              <button className="mode-btn glass" onClick={handleAddInfo}>
                <span className="btn-icon">📎</span>
                <span>添加信息</span>
              </button>
            </div>
            <p className="mode-timer">3秒后自动回退...</p>
          </div>
        )}

        {/* 快捷入口 */}
        <div className="quick-actions">
          <button className="quick-btn glass" onClick={() => navigate('/random')}>
            <span className="btn-icon">🎴</span>
            <span>随机浏览</span>
          </button>
          <button className="quick-btn glass" onClick={() => navigate('/search')}>
            <span className="btn-icon">🔍</span>
            <span>搜索</span>
          </button>
        </div>
      </main>

      {/* 轻提示 */}
      {showToast && (
        <div className="toast glass">
          <span>{toastMessage}</span>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
