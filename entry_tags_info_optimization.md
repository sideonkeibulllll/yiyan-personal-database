# 任务：优化录入界面的"添加标签"和"添加信息"功能

## 日期
2026-07-22

## 目标
实现 HomePage 录入后"添加标签"和"添加信息"按钮功能，替换原有的"开发中"占位。

## 修改文件
1. `src/features/input/HomePage.tsx` — 核心逻辑修改
2. `src/features/input/HomePage.css` — 新增标签选择器弹层样式

## 实现详情

### 1. "添加标签" → 弹出标签选择器
- 引入 `TagSelector` 组件和 `useTagStore` 
- `handleSend` 改为保存 `addEntry` 返回的 `entry.id` 到 `lastEntryId` state
- `handleAddTag` 改为：读取当前条目已有标签 → 打开底部弹出的 TagSelector 覆盖层
- 新增 `handleConfirmTags`：对比已有标签和选中标签的差集，调用 `addTagToEntry` / `removeTagFromEntry` 增量保存
- 弹层 UI：底部弹出面板，包含 TagSelector + 取消/确定按钮

### 2. "添加信息" → 跳转编辑页面
- `handleAddInfo` 改为：清模式定时器 → `navigate('/entry/${lastEntryId}/edit')`
- 编辑页面已存在（EntryEditPage），其"←"按钮使用 `navigate(-1)` 返回首页

### 3. entryStore.addEntry
- 检查确认 `addEntry` 已返回 `Promise<Entry>`，无需修改

## 验证
- `npx tsc --noEmit` — 无错误 ✓
- `npm run build` — 构建成功 ✓

## 未修改的文件
- EntryEditPage.tsx（由其他任务创建，未触碰）
- TagSelector.tsx / TagSelector.css（接口已满足需求，未修改）
- RandomPage.tsx / QuickMenu.tsx / DataManagerPage（未触碰）
- router.tsx（/entry/:id/edit 路由已存在，未修改）
