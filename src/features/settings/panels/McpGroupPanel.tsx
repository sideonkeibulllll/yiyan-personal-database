/**
 * 设置面板 - MCP 分组（v3.6.0）
 *
 * 解决的问题：Chat 的 MCP 面板把 4 个组硬编码在组件里，工具涨到 30+ 之后
 * 既不能按自己的用法组合，也没法把用不上的组收起来。
 *
 * 这里配置两件事（都只影响「选择层」，不改运行时）：
 * - 显示：该组是否出现在 Chat 的 MCP 面板
 * - 默认：新建对话时是否自动勾选该组的工具
 *
 * 数据存 settings.ai.mcpGroups（undefined = 用 services/mcpGroups 的出厂定义）。
 */
import { useCallback, useMemo, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  ALL_MCP_TOOLS,
  DEFAULT_MCP_GROUPS,
  newCustomGroupId,
  resolveMcpGroups,
} from '@/services/mcpGroups';
import { TOOL_DISPLAY_NAMES } from '@/services/chatBridge';
import type { McpGroupConfig } from '@/types';
import './McpGroupPanel.css';

/** 工具选择面板按「出厂组」分段，方便在 30+ 个工具里找到东西 */
const TOOL_SECTIONS = DEFAULT_MCP_GROUPS.map(g => ({ label: g.label, tools: g.tools }));
const SECTIONED_TOOLS = new Set(TOOL_SECTIONS.flatMap(s => s.tools));
/** 出厂组之外的工具（理论上没有，留个兜底段，避免以后加工具时漏显示） */
const ORPHAN_TOOLS = ALL_MCP_TOOLS.filter(t => !SECTIONED_TOOLS.has(t));

function toolLabel(name: string): string {
  return TOOL_DISPLAY_NAMES[name] || name;
}

export function McpGroupPanel() {
  const stored = useSettingsStore(state => state.settings.ai.mcpGroups);
  const groups = useMemo(() => resolveMcpGroups(stored), [stored]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [flash, setFlash] = useState('');

  const notify = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(''), 2000);
  }, []);

  /** 每次改动都写回「解析后的完整数组」，这样内置组的开关状态也是显式的 */
  const write = useCallback((next: McpGroupConfig[], msg?: string) => {
    useSettingsStore.getState().updateAIConfig({ mcpGroups: next });
    if (msg) notify(msg);
  }, [notify]);

  const patchGroup = useCallback((id: string, patch: Partial<McpGroupConfig>) => {
    write(groups.map(g => (g.id === id ? { ...g, ...patch } : g)));
  }, [groups, write]);

  const toggleTool = useCallback((group: McpGroupConfig, tool: string) => {
    const has = group.tools.includes(tool);
    const tools = has ? group.tools.filter(t => t !== tool) : [...group.tools, tool];
    patchGroup(group.id, { tools });
  }, [patchGroup]);

  const setAllTools = useCallback((group: McpGroupConfig, on: boolean) => {
    patchGroup(group.id, { tools: on ? [...ALL_MCP_TOOLS] : [] });
  }, [patchGroup]);

  const addCustom = useCallback(() => {
    const id = newCustomGroupId();
    write([
      ...groups,
      {
        id,
        label: `我的分组 ${groups.filter(g => !g.builtin).length + 1}`,
        icon: '🧩',
        desc: '自定义组合',
        tools: [],
        builtin: false,
        visible: true,
      },
    ], '已新建分组，点开勾工具');
    setExpanded(id);
  }, [groups, write]);

  const removeCustom = useCallback((g: McpGroupConfig) => {
    if (!confirm(`确定删除分组「${g.label}」吗？\n（只是删掉这个组合，工具本身和其他组不受影响）`)) return;
    write(groups.filter(x => x.id !== g.id), '已删除分组');
  }, [groups, write]);

  const enabledCount = groups.filter(g => g.visible).length;

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">MCP 分组</h2>
      <p className="form-hint" style={{ marginTop: 0 }}>
        「启用」= 这个组出现在 Chat 的 MCP 面板里；关掉就整组下线（里面的工具也勾不到）。
        分组只是选择视图，不改运行时行为；<strong>新对话永远从零工具开始</strong>，
        要用哪组就在面板里点一下 —— 免得自动挂上 30 多个工具把每轮 token 顶上去。
      </p>

      {flash && <div className="promptlib-flash">{flash}</div>}

      <div className="mcpg-list">
        {groups.map(g => {
          const open = expanded === g.id;
          return (
            <div key={g.id} className={`mcpg-item ${open ? 'open' : ''} ${g.visible ? '' : 'hidden-group'}`}>
              <div className="mcpg-head">
                <button className="mcpg-title-btn" onClick={() => setExpanded(open ? null : g.id)} type="button">
                  <span className="mcpg-icon">{g.icon}</span>
                  <span className="mcpg-text">
                    <span className="mcpg-name">
                      {g.label}
                      {g.builtin && <span className="mcpg-badge">内置</span>}
                    </span>
                    <span className="mcpg-sub">{g.tools.length} 个工具{g.desc ? ` · ${g.desc}` : ''}</span>
                  </span>
                  <span className="mcpg-chev">{open ? '▴' : '▾'}</span>
                </button>
                <div className="mcpg-flags">
                  <label className="form-checkbox" title="启用后该组出现在 Chat 的 MCP 面板；关掉整组下线">
                    <input
                      type="checkbox"
                      checked={g.visible}
                      onChange={e => patchGroup(g.id, { visible: e.target.checked })}
                    />
                    <span>启用</span>
                  </label>
                </div>
              </div>

              {open && (
                <div className="mcpg-body">
                  <div className="mcpg-field-row">
                    <div className="mcpg-field">
                      <label className="form-label">名称</label>
                      <input
                        type="text"
                        className="form-input"
                        value={g.label}
                        onChange={e => patchGroup(g.id, { label: e.target.value })}
                      />
                    </div>
                    <div className="mcpg-field mcpg-field-icon">
                      <label className="form-label">图标</label>
                      <input
                        type="text"
                        className="form-input"
                        maxLength={2}
                        value={g.icon}
                        onChange={e => patchGroup(g.id, { icon: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="mcpg-field">
                    <label className="form-label">说明（显示在 Chat 面板里）</label>
                    <input
                      type="text"
                      className="form-input"
                      value={g.desc ?? ''}
                      placeholder="如：搜索 / 创建 / 编辑"
                      onChange={e => patchGroup(g.id, { desc: e.target.value })}
                    />
                  </div>

                  <div className="mcpg-tools-head">
                    <span className="form-label">包含的工具（已选 {g.tools.length} / {ALL_MCP_TOOLS.length}）</span>
                    <span className="mcpg-tools-actions">
                      <button className="promptlib-ghost-btn" onClick={() => setAllTools(g, true)} type="button">全选</button>
                      <button className="promptlib-ghost-btn" onClick={() => setAllTools(g, false)} type="button">清空</button>
                    </span>
                  </div>

                  <div className="mcpg-tools">
                    {TOOL_SECTIONS.map(section => (
                      <div key={section.label} className="mcpg-tool-group">
                        <div className="mcpg-tool-group-label">{section.label}</div>
                        <div className="mcpg-tool-grid">
                          {section.tools.map(tool => (
                            <label key={tool} className="form-checkbox mcpg-tool">
                              <input
                                type="checkbox"
                                checked={g.tools.includes(tool)}
                                onChange={() => toggleTool(g, tool)}
                              />
                              <span>{toolLabel(tool)}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    {ORPHAN_TOOLS.length > 0 && (
                      <div className="mcpg-tool-group">
                        <div className="mcpg-tool-group-label">其他</div>
                        <div className="mcpg-tool-grid">
                          {ORPHAN_TOOLS.map(tool => (
                            <label key={tool} className="form-checkbox mcpg-tool">
                              <input
                                type="checkbox"
                                checked={g.tools.includes(tool)}
                                onChange={() => toggleTool(g, tool)}
                              />
                              <span>{toolLabel(tool)}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {!g.builtin && (
                    <div className="mcpg-danger-row">
                      <button className="form-reset-btn" onClick={() => removeCustom(g)} type="button">删除这个分组</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="form-group">
        <button className="promptlib-primary-btn" onClick={addCustom} type="button">＋ 新建分组</button>
        <span className="form-hint">
          已启用 {enabledCount} 个分组。改完即时生效，Chat 面板下一次打开就是这个样子；已存在的对话里勾过的工具不受影响。
        </span>
      </div>
    </div>
  );
}
