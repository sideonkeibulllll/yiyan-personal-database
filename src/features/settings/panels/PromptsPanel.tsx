/**
 * 设置面板 - 功能提示词
 *
 * v3.6.1：从「提示词」改名「功能提示词」，和「提示词库」区分开 ——
 * 这里放的是**功能内部用**的提示词（标签建议 / 连线建议 / 对话上下文等），
 * 不是你自己攒来复用的那批。
 *
 * settings 数据在 zustand store 中，面板直接订阅，行为与原先一致。
 */
import { useSettingsStore } from '@/stores/settingsStore';
import { DEFAULT_PROMPTS } from '@/types';
import type { PromptConfig } from '@/types';

/** 提示词标签 */
const PROMPT_LABELS: Record<keyof PromptConfig, string> = {
  tagSuggestion: '标签建议提示词',
  relationSuggestion: '关联建议提示词',
  dialogueContext: '对话上下文提示词',
  autoLink: '自动连线提示词',
  groupSuggestion: '组建议提示词',
  connectionSuggestion: '连线建议提示词',
};

/** 提示词提示 */
const PROMPT_HINTS: Record<keyof PromptConfig, string> = {
  tagSuggestion: '可用变量: {content} {context}',
  relationSuggestion: '可用变量: {contentA} {contentB}',
  dialogueContext: '可用变量: {currentEntry} {recentEntries}',
  autoLink: '可用变量: {newEntry} {candidates}',
  groupSuggestion: '可用变量: {existingGroups} {recentEntries}',
  connectionSuggestion: '可用变量: {entries}',
};

interface PromptsPanelProps {
  markDirty: (field: string) => void;
}

export function PromptsPanel({ markDirty }: PromptsPanelProps) {
  const settings = useSettingsStore(state => state.settings);
  const updateAIConfig = useSettingsStore(state => state.updateAIConfig);

  return (
    <div className="settings-panel-content">
      <h2 className="panel-title">功能提示词</h2>
      <p className="form-hint" style={{ marginTop: 0 }}>
        这些是<strong>功能内部</strong>用的提示词（标签建议、连线建议、对话上下文等），改错了对应功能会变差。
        想攒自己复用的提示词，请去「提示词库」—— 那边才是给 Chat 挂载用的。
      </p>
      {(['tagSuggestion', 'relationSuggestion', 'dialogueContext', 'autoLink', 'groupSuggestion', 'connectionSuggestion'] as const).map(key => (
        <div key={key} className="form-group">
          <label className="form-label">{PROMPT_LABELS[key]}</label>
          <textarea
            className="form-input glass"
            style={{ minHeight: '80px', fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
            value={settings.ai.prompts[key] ?? ''}
            onChange={e => { updateAIConfig({
              prompts: {
                ...settings.ai.prompts,
                [key]: e.target.value,
              },
            }); markDirty(`ai.prompts.${key}`); }}
            rows={4}
          />
          <span className="form-hint">{PROMPT_HINTS[key]}</span>
        </div>
      ))}
      <div className="form-group">
        <button
          className="form-reset-btn"
          onClick={() => {
            if (confirm('确定重置所有提示词为默认值？')) {
              updateAIConfig({ prompts: DEFAULT_PROMPTS });
              markDirty('ai.prompts');
            }
          }}
        >
          重置提示词为默认
        </button>
      </div>
    </div>
  );
}