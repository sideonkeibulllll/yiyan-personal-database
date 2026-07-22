# MT管理器风格数据库管理器 - 任务完成总结

## 任务目标
创建一个类似MT管理器的双栏"数据库管理器"页面，实现标签管理、组管理、数据浏览和增量导入功能。

## 完成内容

### 新建文件（7个）
1. **`src/features/datamanager/types.ts`** — 类型定义（ManagerMode, WindowState, PathSegment, ListItem, ImportResult, contentHash函数等）
2. **`src/features/datamanager/DataManagerPage.tsx`** — 主页面组件，管理双窗口状态、底部操作栏、三点菜单、侧边栏、导入功能、条目操作菜单
3. **`src/features/datamanager/DataManagerPage.css`** — 主页面样式（暗色主题、glass效果、响应式双栏布局）
4. **`src/features/datamanager/FileManagerWindow.tsx`** — 单窗口组件，显示列表、路径导航、选中/多选、长按触发
5. **`src/features/datamanager/FileManagerWindow.css`** — 窗口样式
6. **`src/features/datamanager/SideMenu.tsx`** — 侧边栏菜单（模式切换：标签/组/数据）
7. **`src/features/datamanager/SideMenu.css`** — 侧边栏样式

### 新建工具文件
8. **`src/utils/import.ts`** — 增量导入逻辑，使用content hash去重，自动创建/关联标签

### 修改文件（6个）
1. **`src/services/types.ts`** — IDatabaseService接口新增3个方法：getEntriesByTagId, getEntriesByGroupId, getAllContentHashes
2. **`src/services/webDatabase.ts`** — WebDatabaseService实现新增的3个方法 + simpleContentHash辅助函数
3. **`src/services/nativeDatabase.ts`** — NativeDatabaseService实现新增的3个方法 + updateEntry扩展支持groupId/supplement/source字段更新
4. **`src/stores/entryStore.ts`** — 新增importEntries方法
5. **`src/app/router.tsx`** — 添加路由 `/data-manager` 和 `/data-manager/:mode`
6. **`src/features/settings/SettingsPage.tsx`** — "标签管理"改为跳转 `/data-manager/tags`，新增"组数据"跳转 `/data-manager/groups`，"数据存储"改为可点击跳转 `/data-manager/data`

## 功能清单

### 任务3：MT管理器双栏页面
- ✅ 顶部栏：菜单按钮(☰)、面包屑路径导航、三点菜单(⋮)
- ✅ 三点菜单：刷新、搜索、全选、排序方式（按时间/按名称/按使用次数）、导入数据（仅数据模式）
- ✅ 双栏窗口：左右各50%宽度，独立导航，点击切换active窗口
- ✅ 窗口内列表：文件夹(📁)和文件(⭐📄)两种类型，显示标题/子标题/元信息
- ✅ 底部操作栏：后退(←)、前进(→)、新建(+)、窗口路径复制(⇄)、返回上级(↑)
- ✅ 侧边栏：模式切换（标签/组/数据）
- ✅ 路径历史管理（history + historyIndex）
- ✅ 新建标签/组对话框
- ✅ 长按进入多选模式 + 弹出操作菜单
- ✅ 条目操作：复制内容、复制到另一窗口、移动到另一窗口、删除属性、查看详情
- ✅ 删除语义区分：标签模式=移除标签，组模式=清除groupId，数据模式=真正删除条目

### 任务4：标签管理和组管理统一入口
- ✅ 标签模式 `/data-manager/tags`：根路径显示所有标签，进入标签显示关联条目
- ✅ 组模式 `/data-manager/groups`：根路径显示所有组，进入组显示关联条目
- ✅ 数据模式 `/data-manager/data`：直接显示所有条目
- ✅ 跨窗口操作：复制到另一窗口（添加标签/修改groupId），移动到另一窗口（添加+移除）

### 任务5：增量导入
- ✅ 设置页"数据存储"可点击跳转到数据模式
- ✅ 数据模式三点菜单中有"导入数据"选项
- ✅ 使用 `<input type="file" accept=".json">` 选择文件
- ✅ 增量导入：用content的hash判断重复，已存在跳过，不存在创建新条目
- ✅ 标签自动创建/关联：如果标签名不存在则创建，存在则关联
- ✅ 导入结果对话框：显示总计/新增/跳过/错误

## 验证结果
- ✅ `npx tsc --noEmit` — 无类型错误
- ✅ `npm run build` — 构建成功，产出 DataManagerPage chunk (~16KB JS + ~11KB CSS)

## 设计要点
- 保持暗色主题风格，使用项目CSS变量（--color-bg-*, --color-accent-*, --space-*, --radius-* 等）
- glass效果用于对话框、菜单、窗口背景
- 手机端适配：双栏各占50%，文字ellipsis截断，触摸长按500ms触发多选
- 安全区域适配：padding-top/bottom 使用 env(safe-area-inset-*)
- 组件间通信：自定义事件（dm-navigate, dm-clear-selection, dm-select-all）避免prop drilling
