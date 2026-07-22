# QuickMenu 修复任务总结

## 任务目标
修复 QuickMenu 组件的"详情"和"添加到组"功能，菜单固定定位，新增组选择器弹窗和加入时间显示。

## 完成内容

### 1. QuickMenu 菜单固定定位
- 菜单使用 `position: fixed; bottom: 0; left: 50%; transform: translateX(-50%)` 固定在屏幕底部居中
- 不再依赖卡片位置，标准 bottom sheet 风格

### 2. "详情"功能实现
- 点击"详情"后在 QuickMenu 内部切换到详情面板（`panel = 'detail'`）
- 详情面板展示：完整内容、来源、补充信息、标签列表、星标状态、使用次数（copyCount）、创建时间、更新时间
- 面板有返回按钮（‹）可回到主菜单

### 3. "添加到组"功能实现（改名为"组标签"）
- 点击后在 QuickMenu 内部切换到组选择器面板（`panel = 'group'`）
- 组选择器从数据库异步加载组列表（`getDatabase() → db.getAllGroups()`）
- 支持选中/取消选中（再次点击取消）
- 当前条目已有 groupId 时自动高亮
- 支持"未分组"选项（清除 groupId）
- 底部有"确定"和"取消"按钮
- 确定后调用 `useEntryStore.updateEntry(id, { groupId })` 保存

### 4. 菜单项调整
- "添加到组"改名为"组标签"
- 菜单底部新增分隔线 + "加入时间：YYYY-MM-DD"信息项（不可点击，纯展示）
- 使用 `entry.createdAt` 格式化为 `YYYY-MM-DD`

### 5. 三面板架构
- `panel = 'menu'`：主菜单（6个操作项 + 加入时间）
- `panel = 'detail'`：详情面板
- `panel = 'group'`：组选择器面板
- 面板间通过 `setPanel()` 切换，不关闭菜单

## 修改文件
- `src/features/random/QuickMenu.tsx` — 完全重写，新增详情面板和组选择器
- `src/features/random/QuickMenu.css` — 完全重写，新增固定定位、详情面板样式、组选择器样式

## 未修改文件
- `RandomPage.tsx` — 未修改（按要求不改动）

## 验证结果
- `npx tsc --noEmit` ✅ 通过
- `npm run build` ✅ 构建成功

## 技术要点
- 组选择器使用 `useEntryStore` 的 `updateEntry` 方法保存 groupId
- 组列表通过 `getDatabase()` 获取数据库实例后调用 `getAllGroups()` 加载
- 详情面板和组选择器都是 QuickMenu 内部状态管理，不需要额外的 props 或组件
- 所有样式保持暗色主题（glass 效果、CSS 变量）
