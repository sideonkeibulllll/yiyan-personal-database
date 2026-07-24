# 构建与发布须知

> **AI 指令**: 本文档是构建与发布流程的权威指南。完成任务前务必对照本文档检查所有要点。完成推送/构建后，**必须更新本文档中 `[...]` 框住的动态字段**。

---

## 项目基本信息

- **项目路径**: `C:\Users\tianming\Desktop\test\yiyan-personal-database`
- **GitHub 仓库**: https://github.com/sideonkeibulllll/yiyan-personal-database.git
- **包名 (applicationId)**: `com.yiyan.memorydb`
- **当前最新版本**: `[v1.7.4]` ← **推送完成后必须更新此项**
- **当前 versionCode**: `[9]` ← **每次发版必须 +1**
- **当前 versionName**: `[1.7.1]` ← **注意：此值目前与 package.json 不一致！每次发版必须同步更新**

---

## 一、版本号管理

### 版本号规则

格式: `MAJOR.MINOR.PATCH` (语义化版本)

| 改动规模 | 版本递增 | 说明 |
|---------|---------|------|
| Bug修复/小改动 (< 500行代码改动) | `+0.0.1` (PATCH) | 默认递增方式 |
| 新功能/大改动 (≥ 500行代码改动) | `+0.1.0` (MINOR) | 用户未指定时的大改动默认 |
| 重大架构变更 | `+1.0.0` (MAJOR) | 需用户明确指示 |

### 版本号同步要点 ⚠️

**三个地方必须同步更新版本号：**

1. **`package.json`** 的 `"version"` 字段
2. **`android/app/build.gradle`** 的 `versionName` 字段
3. **`android/app/build.gradle`** 的 `versionCode` 字段（每次发版 **+1**）

> ⚠️ **血泪教训**: 之前出现过 APK 文件名写着 v1.7.4 但安装后系统显示 v1.7.1 的问题，就是因为只改了 `package.json` 没改 `build.gradle`！

### 版本号检查清单（每次发版必查）

```
□ package.json → "version": "x.y.z"
□ android/app/build.gradle → versionName "x.y.z"  （必须与 package.json 一致）
□ android/app/build.gradle → versionCode N        （比上次 +1）
□ git tag vx.y.z                                  （与版本号一致）
```

---

## 二、GitHub 推送

### 推送流程

```powershell
# 1. 暂存所有改动
git add -A

# 2. 提交（commit message 包含版本号和变更摘要）
git commit -m "vx.y.z: 变更摘要"

# 3. 打标签
git tag vx.y.z

# 4. 推送代码和标签（如果远程有冲突需要 force push）
git push origin master --force
git push origin vx.y.z --force
```

### 推送注意事项

1. **commit message 格式**: `vx.y.z: 简要描述变更内容`
2. **强制推送**: 项目历史中多次使用 `--force`，因为本地可能 rebase。如果普通 push 被拒绝，使用 `--force`
3. **标签必须推送**: `git push origin vx.y.z`，否则 GitHub 上看不到 release tag
4. **不要上传 APK/EXE 到 GitHub Release**: 二进制文件只放在本地 `release/` 目录

### GitHub Release 规则

- ❌ **禁止上传 APK 到 GitHub Release**
- ❌ **禁止上传 EXE 到 GitHub Release**
- ✅ 只推送代码和 tag，不创建带二进制附件的 Release
- ✅ Release Notes 写在本地 `release/` 目录下的 `.md` 文件中

---

## 三、APK 构建

### 前置条件

- Node.js + npm
- Android Studio + Android SDK
- JDK 17+（Gradle 要求）
- 项目依赖已安装（`npm install`）

### 构建步骤

```powershell
# 0. 确认版本号已同步更新（见上方"版本号检查清单"）

# 1. 构建前端
Set-Location "C:\Users\tianming\Desktop\test\yiyan-personal-database"
npm run build

# 2. 同步到 Android 项目
npx cap sync android

# 3. 构建 APK（debug 版本）
Set-Location "android"
.\gradlew.bat assembleDebug

# 4. 构建 APK（release 版本，如需要）
.\gradlew.bat assembleRelease

# 5. 复制到 release 目录（文件名必须包含版本号）
Copy-Item "app\build\outputs\apk\debug\app-debug.apk" "..\release\yiyan-personal-database-vx.y.z-debug.apk" -Force
Copy-Item "app\build\outputs\apk\release\app-release-unsigned.apk" "..\release\yiyan-personal-database-vx.y.z-release.apk" -Force
```

### APK 构建要点 ⚠️

1. **文件名必须包含当前版本号**: `yiyan-personal-database-vx.y.z-debug.apk`
2. **APK 内部版本号必须与文件名一致**:
   - `versionName` → 安装后系统设置中显示的版本
   - `versionCode` → 每次发版必须 +1（整数递增）
   - **每次构建前必须检查 `build.gradle` 中的版本号！**
3. **构建完必须移动到 `release/` 目录**: 不要留在 `android/app/build/outputs/` 里
4. **构建前先 `npx cap sync android`**: 确保前端最新代码同步到 Android assets

### 常见构建问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| TypeScript 编译失败 | 类型错误 | 根据报错修复类型，常见：`BlobPart` 类型不匹配用 `new Uint8Array()` 包裹 |
| Gradle 构建失败 | SDK 版本不匹配 | 检查 `android/variables.gradle` 中的 SDK 版本 |
| APK 安装后版本号不对 | `build.gradle` 未同步更新 | 修改 `versionName` 和 `versionCode` |
| Capacitor 插件未生效 | 未执行 `cap sync` | 构建前执行 `npx cap sync android` |
| `cap sync` 报插件冲突 | 插件版本不兼容 | 检查 `package.json` 中 Capacitor 插件版本均为 `^6.x` |

### release 目录结构

```
release/
├── yiyan-personal-database-v1.7.4-debug.apk          # debug 版本
├── yiyan-personal-database-v1.7.4-release.apk        # release 版本（签名版）
├── yiyan-personal-database-v1.7.4-stream-fix-debug.apk  # 特定修复版本
├── v1.7.4_release_notes.md                            # 发布说明
├── stream_fix_notes.md                                # 修复记录
└── export_fix_notes.md                                # 修复记录
```

---

## 四、EXE 构建（Electron）

### 构建时机

⚠️ **未明确要求请不要构建 EXE！** 只有用户明确说"构建 exe"或"打包桌面版"时才执行。

### 构建步骤

```powershell
Set-Location "C:\Users\tianming\Desktop\test\yiyan-personal-database"

# 一键构建（前端 + Electron 编译 + 打包 + electron-builder）
npm run electron:build

# 构建产物在 release-electron/ 目录
# 安装包: release-electron/记忆库 Setup x.y.z.exe
# 免安装版: release-electron/win-unpacked/记忆库.exe
```

### electron:build 流程详解

`npm run electron:build` 实际执行以下步骤：

1. `npm run build` — 构建前端到 `dist/`
2. `npm run electron:compile` — 编译 Electron 主进程 TypeScript 到 `dist-electron/`
3. `npm run electron:pack-app` — 手动打包 app 目录到 `release-electron/win-unpacked/resources/app/`
   - 使用 `electron/build-app.cjs` 脚本
   - 递归收集依赖树（包括嵌套依赖）
   - 复制 `dist/`、`dist-electron/`、`package.json` 到 app 目录
   - 重命名 `electron.exe` → `记忆库.exe` 并注入图标
4. `npx electron-builder --win --prepackaged release-electron/win-unpacked` — 生成 NSIS 安装包

### EXE 构建要点

1. **安装包命名**: electron-builder 自动命名为 `记忆库 Setup x.y.z.exe`（取自 `package.json` 的 `version`）
2. **应用图标**: `electron/build/icon.ico`
3. **安装程序配置**: `package.json` 中的 `"build"` 字段 + `electron/build/installer.nsh`
4. **sql.js WASM 文件**: 需要作为 `extraResources` 打包，路径 `resources/sql-wasm.wasm`
5. **不要上传到 GitHub Release**: EXE 只保留在本地 `release-electron/` 目录

### 常见 EXE 构建问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| electron-builder EPERM rename | 文件被占用 | 关闭正在运行的 exe，删除 `release-electron/` 重试 |
| 依赖缺失运行时报错 | 依赖未正确收集 | 检查 `build-app.cjs` 中 `rootProdDeps` 列表 |
| sql.js wasm 找不到 | 未复制到 extraResources | 检查 `build-app.cjs` 步骤5的 wasm 复制逻辑 |
| 图标未应用 | rcedit 路径未找到 | 检查 electron-builder 缓存中的 rcedit-x64.exe |

---

## 五、发布后必做清单

### AI 完成推送/构建后，必须更新本文档以下字段：

```
□ 更新 "当前最新版本": [v1.7.4] → [v新版本号]
□ 更新 "当前 versionCode": [9] → [新versionCode]
□ 更新 "当前 versionName": [1.7.1] → [新versionName]
```

### 更新位置（本文档内）

1. 第一节"项目基本信息"中的三个 `[...]` 字段
2. 确保字段值与实际推送的版本一致

---

## 六、快速参考

### 关键文件路径

| 文件 | 用途 |
|------|------|
| `package.json` | 项目配置 + 版本号 + Electron 构建配置 |
| `android/app/build.gradle` | Android APK 版本号 + 构建配置 |
| `capacitor.config.ts` | Capacitor 配置 |
| `electron/build-app.cjs` | Electron 手动打包脚本 |
| `electron/build/icon.ico` | 应用图标 |
| `electron/build/installer.nsh` | NSIS 安装程序自定义脚本 |

### 关键命令速查

| 操作 | 命令 |
|------|------|
| 构建前端 | `npm run build` |
| 同步 Android | `npx cap sync android` |
| 构建 APK debug | `cd android; .\gradlew.bat assembleDebug` |
| 构建 APK release | `cd android; .\gradlew.bat assembleRelease` |
| 构建 EXE | `npm run electron:build` |
| 启动 dev 服务器 | `npm run dev` |
| Electron 开发模式 | `npm run electron:dev` |

### Git 推送速查

```powershell
git add -A
git commit -m "vx.y.z: 变更描述"
git tag vx.y.z
git push origin master --force
git push origin vx.y.z --force
```
