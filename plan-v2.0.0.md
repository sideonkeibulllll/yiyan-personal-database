# v2.0.0 实施计划

## 一、功能变更点清单

### a. 随机页改为主动刷新
- [x] 已实现「刷新下一屏」按钮 + 移除自动刷新逻辑（已确认现有代码就是这样，无需改动）
- 说明：RandomPage.tsx 当前即为按钮触发刷新，符合要求

### b. QuickMenu 重构
- [ ] b.1: QuickMenu 中「编辑标签」改为复用 TagSelector 组件
- [ ] b.1: 标签建议改为发送最近50个标签让AI选1-6个；更新智能标签提示词
- [ ] b.2: 移除 QuickMenu 中「详情」选项，改为直接显示更新时间（默认创建时间，编辑后显示更新时间）
- [ ] b.3: 组标签选择器支持多选
- [ ] b.4: 连线页面底部添加「连线建议」按钮（发送最近100条给AI）
- [ ] b.5: AI对话「添加预备」对接 ChatPage 数据选择器，添加后自动选中
- [ ] b.6: 「就此内容谈话」跳到 AI 页面并选中数据（不单开一页）
- [ ] b.7: 「转为待办」后选项变为「编辑新建的待办」，点击跳到待办编辑页
- [ ] b.8: 编辑详情页标签附近添加「智能标签」「智能组」（组标签可多选）

### c. 待办编辑页支持图片附件
- [ ] c: 待办编辑页允许添加图片附件
- [ ] c: 待办删除时图片附件不保留
- [ ] c: 录入界面待办模式也可选图片

### d. 设置界面改造
- [ ] d: 设置改为左侧栏 + 右侧配置项 + 底部保存按钮；适配安卓

### e. AI 配置增强
- [ ] e.1: AI 配置添加「组」建议提示词
- [ ] e.2: AI 配置添加 chat soul 提示词；对话上下文提示词简化为 {currentEntry}{recentEntries}；数据选择器搜索按钮旁添加「最近」勾选项（自动选中最近30条）
- [ ] e.3: 检查提示词配置被正确使用
- [ ] e.4: 支持配置 GLM 模型（仅需apikey）；启用后非chat界面智能切换模型（GLM-4.7-Flash等）；chat界面模型选择添加「智能GLM」选项

### f. 可配置数字
- [ ] f: 上述带[]的数字（如50、100、30）可在设置中配置

### 发布
- [ ] 更新 README
- [ ] 构建 apk release
- [ ] 构建 exe
- [ ] 放入 release/ 文件夹
- [ ] 更新 BUILD_AND_RELEASE.md 动态字段
- [ ] 推送 Git + tag

## 二、版本号
- 当前：v1.7.5, versionCode 10
- 目标：v2.0.0 (大版本升级，>=500行改动), versionCode 11

## 三、实施顺序（分阶段）

### 阶段1：类型定义与基础设施更新
1. 更新 src/types/index.ts：
   - PromptConfig 添加 groupSuggestion、chatSoul 字段
   - PromptConfig.dialogueContext 简化
   - SmartTagOptions recentTagCount 支持配置
   - 新增 ConnectionSuggestionOptions（带 recentEntryCount）
   - AIConfig 添加 glm 配置（apiKey、model、enabled）
   - DEFAULT_PROMPTS 更新

### 阶段2：随机页与QuickMenu（a, b.1-b.3, b.5-b.7）
1. RandomPage.tsx (a)：已实现
2. QuickMenu.tsx：
   - b.2: 移除「详情」选项，菜单直接显示更新时间
   - b.1: 「编辑标签」复用 TagSelector
   - b.3: 组标签选择器支持多选
   - b.5: 「添加预备」对接 EntryPickerPanel，添加后自动选中
   - b.6: 「就此内容谈话」跳转到 /chat?entryId=xxx&from=random
   - b.7: 「转为待办」保存后选项变为「编辑新建的待办」
3. TagSelector.tsx (b.1)：标签建议改为 1-6 个

### 阶段3：连线页面（b.4）
1. LinkPage.tsx：底部添加「连线建议」按钮，发送最近100条给AI

### 阶段4：待办编辑页（c）
1. TodoEditPage.tsx：添加图片附件功能
2. 待办删除时附件不保留
3. 录入界面待办模式可选图片（需查录入界面）

### 阶段5：设置页改造（d, e, f）
1. SettingsPage.tsx：
   - d: 改为左侧栏 + 右侧配置项 + 底部保存按钮
   - e.1: 添加「组」建议提示词
   - e.2: 添加 chat soul 提示词；对话上下文简化；数据选择器加「最近」勾选
   - e.4: GLM 模型配置
   - f: 数字可配置（50、100、30）

### 阶段6：AI 服务与使用（e.3, e.4）
1. ai.ts：
   - suggestGroups 方法（用于 b.8）
   - suggestConnections 方法（用于 b.4）
   - chatSoul 系统提示注入

### 阶段7：编辑详情页（b.8）
1. 编辑详情页标签附近添加「智能标签」「智能组」

### 阶段8：发布
1. 更新 README
2. 构建 release APK
3. 构建 EXE
4. 放入 release/ 文件夹
5. 更新 BUILD_AND_RELEASE.md
6. Git push + tag

## 四、开始时间
2026-07-25 开始实施

## 五、注意事项
- 使用 PowerShell 语法
- 不使用 CMD 语法
- 不使用交互式命令
- GUI 程序使用 Start-Process
- 编码 UTF-8
