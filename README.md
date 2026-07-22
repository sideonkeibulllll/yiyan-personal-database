# 记忆库 (Yiyan Personal Database)

> 一个有记忆、会思考的私人收藏夹：所有碎片化的文字信息存入后，既能通过搜索一键取出，也能在加权随机的"抽卡"浏览中被意外串联，还能在 AI 的陪伴下不断生长出关联和理解。

## ✨ 功能特性

### 🔍 核心功能
- **极速录入**: 快速保存文字片段，支持粘贴和手动输入
- **智能搜索**: 多维度检索，支持关键词、标签、星标组合筛选
- **随机浏览**: 加权随机"抽卡"体验，让信息意外串联
- **AI 辅助**: 标签建议、关系发现、对话探索

### 📊 数据管理
- **本地优先**: SQLite 本地存储，数据完全掌控
- **灵活标签**: 手动添加 + AI 智能建议
- **星标系统**: 重要的信息倍受关注
- **关系网络**: 条目间关联可视化

## 🛠 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18 + TypeScript | 类型安全，组件化开发 |
| 构建工具 | Vite 5 | 快速 HMR，优化构建 |
| 移动端容器 | Capacitor 6 | Web 转 Android，访问原生能力 |
| 本地存储 | SQLite (`@capacitor-community/sqlite`) | 关系型数据，支持复杂查询 |
| UI 组件库 | Ant Design Mobile 5 | 移动端交互成熟 |
| 状态管理 | Zustand | 轻量，适合个人项目 |

## 📦 安装与运行

### 前置要求
- Node.js 18+
- npm 或 yarn
- Android Studio (用于 Android 构建)

### 开发环境

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

### Android 打包

```bash
# 添加 Android 平台
npm run cap:add:android

# 同步资源到 Android
npm run cap:sync

# 打开 Android Studio 进行打包
npm run cap:open
```

## 📱 功能模块

### 1. 录入套件 (InputKit)
- 极速输入框
- 标签选择栏
- 信息附加面板
- AI 标签建议

### 2. 随机浏览套件 (RandomBrowser)
- 加权随机算法
- 范围筛选
- 快捷菜单

### 3. 搜索套件 (SearchKit)
- 关键词搜索
- 标签筛选
- 星标状态筛选

### 4. 标签套件 (TagKit)
- 手动/AI 标签管理
- 标签合并与重命名

### 5. 设置套件 (SettingsKit)
- AI API 配置
- 上下文管理
- 数据备份与导出

## 🗂 项目结构

```
src/
├── app/              # 应用入口与路由
├── components/       # 通用组件
├── features/         # 功能模块
│   ├── input/        # 录入功能
│   ├── random/       # 随机浏览
│   ├── search/       # 搜索功能
│   └── settings/     # 设置页面
├── services/         # 业务服务
├── stores/           # 状态管理
└── types/            # TypeScript 类型定义
```

## 📄 许可证

本项目采用 CC BY-NC 4.0 许可证，仅限非商业用途。

详见 [LICENSE](LICENSE) 文件。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📝 更新日志

### v0.1.0 (2026-07-22)
- ✅ 初始版本发布
- ✅ 实现基础录入功能
- ✅ 实现随机浏览功能
- ✅ 实现搜索功能
- ✅ 实现 SQLite 本地存储

---

**开发者**: yiyan-personal-database team  
**创建时间**: 2026-07-22