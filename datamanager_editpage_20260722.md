# 任务总结：数据管理器优化 + 新建数据编辑页面

**日期**: 2026-07-22
**执行人**: Subagent (Opt1: DataManager + EditPage)

## 完成内容

### 1. 左右窗口独立模式 ✅

**文件**: `src/features/datamanager/DataManagerPage.tsx`

- 左右窗口现在各自独立拥有自己的 `mode` 和 `path`
  - 左窗口默认为 `tags` 模式
  - 右窗口默认为 `data` 模式
- 移除了 URL 参数同步模式逻辑（不再需要 `useParams`）
- `handleModeChange` 现在只影响 `activeWindow`（最近点击的窗口）
- 新增 `activeWindow` 跟踪：点击某窗口时设为 active
- 底部操作栏新增两个按钮：
  - **⧉ 复制条目到另一窗口**：如果目标在标签文件夹下 → 给条目添加标签；如果目标在组文件夹下 → 修改 groupId；如果目标在数据模式 → 提示"目标窗口不在标签或组路径下"
  - **✂ 移动条目到另一窗口**：同上但会移除当前窗口路径对应的属性
- 原有 ⇄ 按钮保留为"复制路径到另一窗口"

### 2. 长按只弹菜单，不影响选中 ✅

**文件**: `src/features/datamanager/FileManagerWindow.tsx`

- `handleItemLongPress` 现在只调用 `onLongPress(item.id)` 弹出操作菜单
- 不再调用 `setMultiSelectMode(true)` 和 `onMultiSelectToggle(item.id)`
- 单击继续负责选中/取消选中

### 3. 新建数据编辑页面 ✅

**新文件**:
- `src/features/entry/EntryEditPage.tsx`
- `src/features/entry/EntryEditPage.css`

**路由**: `/entry/:id/edit`（添加到 `src/app/router.tsx`）

**可编辑字段**:
- content（内容，多行文本）
- source（来源，单行文本）
- supplement（补充信息，多行文本）
- tags（标签，用 TagSelector 组件，显示为 chip，可删除和添加）
- groupId（组，用 GroupSelector 组件，显示当前组名或"未分组"）
- isStarred（星标，开关按钮）

**UI**:
- 顶部：标题"编辑条目" + 左侧返回箭头（`navigate(-1)`）
- 中间：表单垂直排列，glass 效果
- 底部：保存按钮
- 暗色主题，与整体一致

**数据加载与保存**:
- 使用 `useParams` 获取 id
- 从 `getDatabase().getEntryById` 加载条目
- 保存使用 `useEntryStore.updateEntry` + 直接调用 `db.addTagToEntry`/`db.removeTagFromEntry` 处理标签差异
- 保存后 `navigate(-1)` 返回

### 4. 侧边栏加"退出"按钮 ✅

**文件**: `src/features/datamanager/SideMenu.tsx` + `SideMenu.css`

- SideMenu 接受新 `onExit` prop
- 底部区域新增"退出"按钮，点击后 `navigate('/')` 回主界面
- 按钮样式：左侧图标 ⏏，文字"退出"，点击时变红

### 5. 长按菜单加"编辑"按钮 ✅

**文件**: `src/features/datamanager/DataManagerPage.tsx`

- 操作菜单新增"✏️ 编辑"选项（在"复制内容"之后）
- 点击后 `navigate('/entry/${actionMenuEntryId}/edit')` 跳转到编辑页

## 验证结果

- ✅ `npx tsc --noEmit` — 无类型错误
- ✅ `npm run build` — 构建成功（1.36s）
- ✅ 未修改 RandomPage.tsx 或 QuickMenu.tsx
- ✅ 未修改录入页面

## 修改的文件清单

1. `src/features/datamanager/DataManagerPage.tsx` — 左右窗口独立、跨窗口复制/移动、编辑菜单项
2. `src/features/datamanager/FileManagerWindow.tsx` — 长按只弹菜单
3. `src/features/datamanager/SideMenu.tsx` — 退出按钮
4. `src/features/datamanager/SideMenu.css` — 退出按钮样式
5. `src/app/router.tsx` — 添加 /entry/:id/edit 路由
6. `src/features/entry/EntryEditPage.tsx` — 新建
7. `src/features/entry/EntryEditPage.css` — 新建
