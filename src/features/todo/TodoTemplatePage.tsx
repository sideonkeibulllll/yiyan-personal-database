/**
 * 待办模板系统
 * 模板列表 + 模板详情（编辑模板项）+ 应用模板到日期
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTodoDatabase } from '@/services/todoDatabase';
import { BottomNav } from '@/components/BottomNav';
import type { TodoTemplate, TodoTemplateItem } from '@/types';
import './TodoTemplatePage.css';

export function TodoTemplatePage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TodoTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TodoTemplate | null>(null);
  const [items, setItems] = useState<TodoTemplateItem[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applyDate, setApplyDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });

  const loadTemplates = useCallback(async () => {
    const db = await getTodoDatabase();
    const list = await db.getAllTemplates();
    setTemplates(list);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const loadItems = useCallback(async (templateId: string) => {
    const db = await getTodoDatabase();
    const list = await db.getTemplateItems(templateId);
    setItems(list);
  }, []);

  const handleSelectTemplate = useCallback(async (template: TodoTemplate) => {
    setSelectedTemplate(template);
    await loadItems(template.id);
  }, [loadItems]);

  const handleCreateTemplate = useCallback(async () => {
    if (!newTemplateName.trim()) return;
    const db = await getTodoDatabase();
    const template = await db.createTemplate(newTemplateName.trim());
    setTemplates(prev => [template, ...prev]);
    setNewTemplateName('');
    setShowCreateDialog(false);
    setSelectedTemplate(template);
    setItems([]);
  }, [newTemplateName]);

  const handleAddItem = useCallback(async () => {
    if (!selectedTemplate) return;
    const db = await getTodoDatabase();
    const newItem = await db.addTemplateItem({
      templateId: selectedTemplate.id,
      title: '新待办',
      isToday: true,
      sortOrder: items.length,
    });
    setItems(prev => [...prev, newItem]);
  }, [selectedTemplate, items.length]);

  const handleUpdateItem = useCallback(async (id: string, updates: Partial<TodoTemplateItem>) => {
    const db = await getTodoDatabase();
    await db.updateTemplateItem(id, updates);
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
  }, []);

  const handleDeleteItem = useCallback(async (id: string) => {
    const db = await getTodoDatabase();
    await db.deleteTemplateItem(id);
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const handleDeleteTemplate = useCallback(async (templateId: string) => {
    const db = await getTodoDatabase();
    await db.deleteTemplate(templateId);
    setTemplates(prev => prev.filter(t => t.id !== templateId));
    setSelectedTemplate(null);
    setItems([]);
  }, []);

  const handleApplyTemplate = useCallback(async () => {
    if (!selectedTemplate || !applyDate) return;
    const db = await getTodoDatabase();
    await db.importTemplateToDate(selectedTemplate.id, applyDate);
    navigate('/todo');
  }, [selectedTemplate, applyDate, navigate]);

  /** 将分钟偏移转为 HH:MM 格式 */
  const formatOffset = (minutes?: number): string => {
    if (minutes === undefined) return '--:--';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  /** 将 HH:MM 转为分钟偏移 */
  const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  };

  return (
    <div className="todo-template-page">
      <main className="page-content">
        <div className="template-header">
          <button className="template-back" onClick={() => navigate('/todo')}>←</button>
          <h2>模板管理</h2>
          <button className="template-add-btn" onClick={() => setShowCreateDialog(true)}>+</button>
        </div>

        {!selectedTemplate ? (
          /* 模板列表 */
          <div className="template-list">
            {templates.length > 0 ? (
              templates.map(tpl => (
                <div
                  key={tpl.id}
                  className="template-card glass"
                  onClick={() => handleSelectTemplate(tpl)}
                >
                  <span className="template-name">{tpl.name}</span>
                  <span className="template-arrow">›</span>
                </div>
              ))
            ) : (
              <div className="template-empty">
                <p>还没有模板</p>
                <p className="template-empty-hint">点击右上角 + 创建第一个模板</p>
              </div>
            )}
          </div>
        ) : (
          /* 模板详情 */
          <div className="template-detail">
            <div className="template-detail-header">
              <button onClick={() => setSelectedTemplate(null)}>← 返回列表</button>
              <h3>{selectedTemplate.name}</h3>
              <button
                className="template-apply-btn"
                onClick={() => setShowApplyDialog(true)}
              >
                应用到日期
              </button>
            </div>

            <div className="template-items">
              {items.map((item, index) => (
                <div key={item.id} className="template-item glass">
                  <input
                    type="text"
                    className="template-item-title"
                    value={item.title}
                    onChange={e => handleUpdateItem(item.id, { title: e.target.value })}
                  />
                  <div className="template-item-times">
                    <label>
                      开始
                      <input
                        type="time"
                        value={formatOffset(item.startTime)}
                        onChange={e => handleUpdateItem(item.id, { startTime: timeToMinutes(e.target.value) })}
                      />
                    </label>
                    <label>
                      结束
                      <input
                        type="time"
                        value={formatOffset(item.endTime)}
                        onChange={e => handleUpdateItem(item.id, { endTime: timeToMinutes(e.target.value) })}
                      />
                    </label>
                  </div>
                  <label className="template-item-today">
                    <input
                      type="checkbox"
                      checked={item.isToday}
                      onChange={e => handleUpdateItem(item.id, { isToday: e.target.checked })}
                    />
                    <span>今日处理</span>
                  </label>
                  <button
                    className="template-item-delete"
                    onClick={() => handleDeleteItem(item.id)}
                  >
                    删除
                  </button>
                </div>
              ))}
              <button className="template-item-add" onClick={handleAddItem}>
                + 添加待办项
              </button>
            </div>

            <button
              className="template-delete-btn"
              onClick={() => handleDeleteTemplate(selectedTemplate.id)}
            >
              删除模板
            </button>
          </div>
        )}
      </main>

      {/* 创建模板对话框 */}
      {showCreateDialog && (
        <div className="dialog-overlay" onClick={() => setShowCreateDialog(false)}>
          <div className="dialog-content glass" onClick={e => e.stopPropagation()}>
            <h3>创建模板</h3>
            <input
              type="text"
              className="form-input glass"
              value={newTemplateName}
              onChange={e => setNewTemplateName(e.target.value)}
              placeholder="模板名称..."
              autoFocus
            />
            <div className="dialog-actions">
              <button onClick={() => setShowCreateDialog(false)}>取消</button>
              <button
                onClick={handleCreateTemplate}
                disabled={!newTemplateName.trim()}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 应用模板对话框 */}
      {showApplyDialog && (
        <div className="dialog-overlay" onClick={() => setShowApplyDialog(false)}>
          <div className="dialog-content glass" onClick={e => e.stopPropagation()}>
            <h3>应用到日期</h3>
            <input
              type="date"
              className="form-input glass"
              value={applyDate}
              onChange={e => setApplyDate(e.target.value)}
            />
            <div className="dialog-actions">
              <button onClick={() => setShowApplyDialog(false)}>取消</button>
              <button onClick={handleApplyTemplate}>应用</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  );
}
