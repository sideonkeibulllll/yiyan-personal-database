# Random Cards Stack 改造

## 任务目标
将随机浏览页面从单卡片居中展示改为流式长方形卡片堆叠模式，自动填屏 + 分页刷新。

## 完成情况

### 已改造文件
1. **`src/features/random/RandomPage.tsx`** — 核心逻辑重写
2. **`src/features/random/RandomPage.css`** — 样式调整

### 实现方案（推荐的最简方案）

**批量抽取 + 全量渲染 + 测量裁剪：**
1. 一次抽取 BATCH_SIZE=20 条随机条目（通过多次调用 `weightedRandomSelect`）
2. 全部渲染到 DOM，超出可见区域的卡片用 `card-hidden` CSS 类隐藏（`visibility: hidden; position: absolute; left: -9999px`）
3. 用 `useLayoutEffect` + `useRef` 测量每张卡片实际高度
4. 累加卡片高度，直到超出容器可用高度就停止，只展示整数张
5. 底部"刷新下一屏"按钮点击后重新随机抽取一批

### 关键设计决策

| 需求 | 实现 |
|------|------|
| 卡片宽度 = 屏幕宽度 - padding | `.card-item { width: 100% }` + 父容器 padding |
| 卡片高度自适应 | 不设固定高度，由内容撑开 |
| 垂直堆叠 + 12px 间距 | `flex-direction: column; gap: 12px` |
| 自动填屏 + 整数张 | `useLayoutEffect` 测量 + `displayCount` 控制 |
| 单击复制 + markAsUsed | 每张卡片独立 `onClick={handleCopy(entry)}` |
| 长按弹出 QuickMenu | 每张卡片独立长按计时器 (`Map<id, timer>`) |
| 星标切换 | `handleToggleStar(entryId)` 更新本地状态 |
| 筛选保留 | 筛选面板和标签显示逻辑不变 |
| 避免连续两屏重复 | `lastIdsRef` 记录上屏 id，抽取时排除（条目足够多时） |
| 空状态保留 | `visibleEntries.length === 0` 时显示提示 |

### 状态变化
- `currentEntry: Entry | null` → `currentEntries: Entry[]`
- `displayCount: number` — 实际展示卡片数
- `lastIdsRef: Set<string>` — 上屏 id 集合（ref，不触发重渲染）
- `pressedId: string | null` — 当前按下的卡片 id（替代 `isPressed: boolean`）
- `menuEntry: Entry | null` — QuickMenu 对应的条目（替代直接用 `currentEntry`）
- `longPressTimersRef: Map<string, timer>` — 每张卡片的长按计时器（替代单个 `longPressTimer`）

### 额外修复
- `settingsStore.ts` 的文件编码问题导致 `tsc` 报错（pre-existing），用 UTF-8 BOM 重新编码修复

### 验证结果
- `npx tsc --noEmit` ✅ 零错误
- `npm run build` ✅ 构建成功（RandomPage CSS 10.10 kB, JS 9.88 kB）

### 未改动
- `QuickMenu.tsx` — 接口完全兼容，未修改
- `random.ts` — `weightedRandomSelect` 和 `filterEntries` 函数未修改
- 筛选面板、标签选择器、BottomNav — 均保留
