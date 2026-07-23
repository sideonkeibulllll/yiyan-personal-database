# Sprint 2.5 待办功能开发 - 2026-07-23

## 目标
为 yiyan-personal-database 项目实现完整的待办（Todo）功能模块，独立于笔记数据层。

## 实现范围

### Phase A：类型定义 + 数据库 + Store（P0）
- 扩展 `types/index.ts`：新增 Todo、TodoTag、TodoTemplate、TodoTemplateItem、TodoConfig、TodoSearchTimeFilter 等类型
- 扩展 `services/types.ts`：新增 ITodoDatabaseService 接口
- 新增 `services/webTodoDatabase.ts`：Web 平台基于 localStorage 的待办数据库实现
- 新增 `services/nativeTodoDatabase.ts`：原生平台基于 Capacitor SQLite 的待办数据库实现（独立 memorydb_todo 连接）
- 新增 `services/todoDatabase.ts`：平台工厂函数
- 新增 `stores/todoStore.ts`：待办状态管理（CRUD、批量操作、搜索等）
- 新增 `stores/todoTagStore.ts`：待办独立标签池管理
- 扩展 `stores/settingsStore.ts`：新增 updateTodoConfig 方法
- 扩展 Settings 类型：加入 todo: TodoConfig 字段及 DEFAULT_TODO_CONFIG

### Phase B：首页待办模式 + 底栏（P0）
- 更新 `components/BottomNav.tsx`：底栏 5 项（录入/随机/待办/Chat/设置）
- 更新 `features/input/HomePage.tsx`：新增待办模式勾选框 + 高级选项（开始时间/结束时间/今日处理 + 快捷预设）
- 更新 `features/input/HomePage.css`：待办模式切换 + 高级选项面板样式
- 待办模式下录入会调用 todoStore.addTodo 创建独立待办条目

### Phase C：待办日常页面（P0）
- 新增 `features/todo/TodoPage.tsx`：
  - 7 天日期选择器（今天/明天/后天标签）
  - 待办列表（按日期加载，未完成在前，已完成沉底）
  - 下拉添加新待办手势
  - 单项左滑完成、右滑删除手势
  - 长按弹出快捷菜单（完成/编辑/删除）
  - 底部倒计时条（小于 60 分钟的待办显示倒计时，最多 3 条）
  - 从模板导入入口
- 新增 `features/todo/TodoPage.css`

### Phase D：待办编辑页 + 标签选择器（P0）
- 新增 `features/todo/TodoEditPage.tsx`：
  - 编辑标题、开始时间、结束时间、今日处理、备注、标签
  - 时间快捷预设（+30分钟/+1小时/+2小时/+4小时）
  - 标签选择器（独立标签池，支持创建新标签和自定义颜色）
  - 支持新建（/todo/new）和编辑（/todo/:id/edit）两种模式
- 新增 `features/todo/TodoEditPage.css`

### Phase E：待办管理器（时间轴视图）（P1）
- 新增 `features/todo/TodoManagerPage.tsx`：
  - 左侧 0-24 小时时间轴 + 右侧待办卡片定位
  - 当前时间指示线（仅在今天显示）
  - 过去时间灰色背景
  - 连续块着色（标签颜色或循环色板）
  - 日期文件夹选择器（前后 14 天）
  - 批量操作模式（多选、批量改时间、批量加标签、批量完成/删除）
  - 从模板导入到选定日期
- 新增 `features/todo/TodoManagerPage.css`

### Phase F：模板系统（P1）
- 新增 `features/todo/TodoTemplatePage.tsx`：
  - 模板列表（创建、删除）
  - 模板详情（编辑模板中的待办项：标题、相对时间、今日处理）
  - 应用模板到指定日期（将相对时间转换为绝对时间戳）
- 新增 `features/todo/TodoTemplatePage.css`

### Phase G：搜索页待办搜索模式（P1）
- 更新 `features/search/SearchPage.tsx`：
  - 新增"笔记搜索/待办搜索"模式切换标签
  - 待办搜索默认关闭，需点击切换
  - 时间筛选：未来待办/已过期/回收站(30天+)
  - 搜索结果显示状态标记和日期文件夹
- 更新 `features/search/SearchPage.css`：新增模式切换和待办结果样式

### Phase H：设置页待办分区（P1）
- 更新 `features/settings/SettingsPage.tsx`：
  - 新增待办配置分区（默认折叠，点击展开）
  - 倒计时配置（开启/格式/位置）
  - 其他配置（删除确认、回收站保留天数）
  - 待办管理器和模板管理入口
- AI 配置区域保持默认折叠（已有逻辑）
- 更新 IconClipboard 组件

### Phase I：路由配置（P0）
- 更新 `app/router.tsx`：新增路由
  - `/todo` → TodoPage
  - `/todo/new` → TodoEditPage
  - `/todo/:id/edit` → TodoEditPage
  - `/todo/manager` → TodoManagerPage
  - `/todo/templates` → TodoTemplatePage

## 设计要点

### 独立数据层
- todos 表与笔记 entries 表完全独立
- 独立标签池（todo_tags 表，不与笔记标签共享）
- 待办不进入随机池，不参与笔记搜索（除非切换到待办搜索模式）
- 软删除（deletedAt 字段），回收站保留 30 天后可清理

### 时间轴着色逻辑
- 优先使用第一个标签的颜色
- 无标签按创建顺序循环 8 色色板
- 已过时间区域灰色背景
- 当前时间指示线

### 完成状态处理
- 已完成待办沉底留顶（排序时未完成在上）
- 已完成显示删除线和透明度
- 可重新激活（toggleDone 切换状态）

## 构建结果
- TypeScript 类型检查：通过
- Vite 构建：通过（1.80s）
- 新增模块打包大小：
  - TodoPage: 5.19 kB
  - TodoEditPage: 4.87 kB
  - TodoManagerPage: 4.56 kB
  - TodoTemplatePage: 4.67 kB
  - webTodoDatabase: 5.77 kB
  - nativeTodoDatabase: 12.38 kB
  - todoStore: 2.25 kB

## 文件清单

### 新增文件（11 个）
- `src/services/webTodoDatabase.ts`
- `src/services/nativeTodoDatabase.ts`
- `src/services/todoDatabase.ts`
- `src/stores/todoStore.ts`
- `src/stores/todoTagStore.ts`
- `src/features/todo/TodoPage.tsx`
- `src/features/todo/TodoPage.css`
- `src/features/todo/TodoEditPage.tsx`
- `src/features/todo/TodoEditPage.css`
- `src/features/todo/TodoManagerPage.tsx`
- `src/features/todo/TodoManagerPage.css`
- `src/features/todo/TodoTemplatePage.tsx`
- `src/features/todo/TodoTemplatePage.css`

### 修改文件（8 个）
- `src/types/index.ts`：新增待办相关类型
- `src/services/types.ts`：新增 ITodoDatabaseService 接口
- `src/stores/settingsStore.ts`：新增 updateTodoConfig
- `src/features/input/HomePage.tsx`：待办模式
- `src/features/input/HomePage.css`：待办模式样式
- `src/features/search/SearchPage.tsx`：待办搜索模式
- `src/features/search/SearchPage.css`：模式切换样式
- `src/features/settings/SettingsPage.tsx`：待办配置分区
- `src/app/router.tsx`：新增待办路由

## 待后续实现
- [ ] 回收站页面（查看已删除待办、恢复、彻底删除）
- [ ] 手势反馈动画优化
- [ ] 原生平台 SQLite 迁移测试
- [ ] 倒计时悬浮窗模式实现
- [ ] AI 智能建议待办时间
