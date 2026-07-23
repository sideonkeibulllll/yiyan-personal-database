# maimai Design System

A design system reconstruction of **maimai** — an internal data-analytics and user-management admin dashboard built around a warm-orange accent on a tiered neutral surface palette. The system is purpose-built for dense operational screens (仪表盘 / 数据分析 / 用户管理) where glanceable status and quiet chrome matter more than decoration.

> 所有 token 与组件均为重建产物（见 Caveats）；本文件面向加入团队的设计师，以叙事方式说明设计取舍。

## What this design system covers

- **Foundations** — 6 色板（primary/neutral/success/warning/error/info，各 10 阶），主色 `#E8590C`；字体 Inter / Noto Sans SC / JetBrains Mono；4px 间距基线；圆角 2/4/8/9999px；5 级阴影。
- **Components** — 8 个组件：Button、Card、Input、Navigation、Modal、Tag、Menu、Table。
- **UI Kit** — `ui_kits/dashboard/index.html` 可交互仪表盘预览（React 18），串联全部 8 个组件于 3 个真实场景屏幕。
- **Sample kit** — 每个组件一份独立 `preview/component-*.html` 预览卡。

---

## CONTENT FUNDAMENTALS

### Voice & tone

产品说的是一种克制的、运营式的中文：导航与分区用两到四字名词短语（"仪表盘""数据分析""用户管理""系统设置"），状态用单字到双字的形容词或状态词（"草稿""活跃""已完成"），系统消息只用一句陈述句交代事实与范围（"系统运行正常，所有服务可用。"）。没有营销温度、没有 emoji、没有第一人称"我们"；系统以第三人称对操作者说话，把状态当作事实报告。时间是相对且低精度的（"更新于 2 分钟前"），优先照顾扫视而非精确。操作标签是动宾结构（"导出报告""编辑用户"），从不裸用动词。整体语域是一个内部后台工具该有的样子——正因为平直，才显得可信。

### Concrete copy examples (lifted from the bundle)

- 卡片标题 + 幽灵操作：*"数据分析"* 旁挂 *"导出报告"*
- 卡片统计行：*"总访问量"* → *12,847*；*"活跃用户"* → *3,421*
- 描边卡片系统消息：*"系统运行正常，所有服务可用。"* 附 *"更新于 2 分钟前"*
- 高亮卡片用户行：*"李明 / 管理员"*、*"王芳 / 编辑"*、*"赵磊 / 访客"*，头部药丸标签 *"活跃"*
- 输入占位：*"请输入用户名"*；搜索占位 *"搜索…"*
- 标签页：*"概览"* / *"明细"* / *"趋势"* / *"设置"*
- 状态标签：*"草稿"* / *"活跃"* / *"已完成"*
- 下拉菜单项：*"编辑"* / *"复制"* / *"导出"* / *"导入"* / *"设置"*，danger 项 *"删除"*
- 表格表头：*"用户名"* / *"角色"* / *"状态"* / *"注册时间"* / *"访问量"* / *"更新时间"* / *"操作"*
- 模态标题：*"编辑用户"* / *"确认删除"*；模态正文 *"确定要删除该用户吗？此操作无法撤销。"*

### When generating copy

- 导航与分区标签用两到四字名词短语，避免冗长修饰；状态标签用单个状态词，绝不用整句。
- 系统消息为一句陈述句，含"事实 + 范围"（"系统运行正常，所有服务可用。"），不道歉、不加 emoji、不用感叹号。
- 操作按钮用动宾结构（"导出报告""编辑用户"），当宾语能澄清作用域时不要裸用动词。
- 相对时间用"更新于 N 分钟前"格式；占位符用"请输入…"或以省略号收尾（"搜索…"）。

---

## VISUAL FOUNDATIONS

### Color

主色 `--maimai-primary-600` `#E8590C` 是一种偏烤焦的暖橙——接近赤陶而非荧光橙，带一点焦糖底。它承载所有可操作时刻：链接、激活态导航、焦点环、主按钮、状态高亮，是唯一被允许出现在 chrome 上的彩色声音。主色板为 10 阶（50 `#FFF4ED` → 900 `#7A2F12`），语义色板同样各 10 阶：success `#2F9E44`、warning `#FAB005`、error `#FA5252`、info `#228BE6`——严格用于状态，绝不用于装饰。中性色是冷调蓝灰阶（`#F8F9FA` → `#212529`，10 阶），给表面一层淡淡的科技感，使暖橙不至于显得甜腻；日常工作用的中性色集中在 `--muted` `#868E96`、`--muted-foreground` `#495057` 与 `--rule` `#DEE2E6`。链接色 `--link` 直接复用主橙 `#E8590C`，焦点环 `--ring` 同色。整体氛围是"有温度的工具感"——足够亲和以支撑长时使用，又足够克制以读作工具而非玩具。暗色主题（`.dark`）把底色压到炭灰 `#1A1B1E`、表面 `#25262B`，主橙上移到 `#F76707`（primary-500）以在深底上维持对比。

### Typography

主字面为 **Noto Sans SC**（正文与中文 UI），与 **Inter**（标题、Display、拉丁/数字）配对，**JetBrains Mono** 承载所有数值数据（统计值、计数）与代码。活跃字重：400（body/lead/caption/mono）、500（按钮、标签、激活标签页）、600（h2/h3/h4、头像）、700（display/h1）。Display 收紧字距 `-0.02em`，其余走字面自然间距。字号阶梯紧凑且偏后台尺寸：display 40/1.2、h1 32/1.3、h2 24/1.35、h3 20/1.4、h4 16/1.5、lead 16/1.6、body 14/1.6、caption 12/1.5、mono 13/1.6——14px/1.6 的正文是主力，最小不下 12px。行高从紧凑的 display（1.2）逐步放宽到舒展的正文（1.6），让标题收得住、正文读得喘。拉丁与数字字形回退到 Inter（数字到 JetBrains Mono），中英数混排时纵向基线对齐。

### Spacing

4px 基线，8 个 token 从 `--space-1` 4px 倍增至 `--space-8` 64px：4 / 8 / 12 / 16 / 24 / 32 / 48 / 64。工作节奏偏密——8 与 12 承担大部分内部间隙，16 与 24 框定卡片内边距（默认卡片 24px、描边卡片 16px），32 及以上留给布局级分隔。组件高度锚在同一栅格：按钮 32 / 40 / 48（sm/md/lg），输入 40px，控件行因此在 8px 子栅格上对齐。侧边栏 240px，顶栏 56px。

### Radius

四个值，刻意偏紧。**2px（radius-sm）**——按钮、幽灵操作、状态标签、关闭按钮热区，是"控件"圆角，让交互 chrome 保持利落。**4px（radius-md）**——卡片、输入、模态、顶栏、搜索框、标签页容器，是"表面"圆角，几乎方角，读起来更接近直角而非柔和。**8px（radius-lg）**——已定义但用得轻，留给需要多一点呼吸的大容器。**9999px（radius-full）**——仅用于药丸：头像、可关闭的 chip 标签、卡片高亮标签。整套系统抗拒柔软，连"圆"元素都贴着正交。

### Shadow / Elevation

5 级，全部是单向自上而下的投影、无 spread，是一种安静的环境式抬升。Level 1 `0 1px 2px rgba(0,0,0,.08)` 是卡片静息态；Level 2 `0 2px 6px rgba(0,0,0,.10)` 在 hover 时抬起；Level 3 `0 6px 16px rgba(0,0,0,.14)` 浮起菜单与 popover；Level 4 `0 12px 28px rgba(0,0,0,.18)` 锚定模态；Level 5 `0 20px 48px rgba(0,0,0,.24)` 留给全屏遮罩。哲学是"静息低语、交互发声"——默认卡片只带近乎不可见的 1px 阴影或无阴影，抬升由交互挣得（hover → shadow-2，modal → shadow-4）。暗色模式下同样 5 级但加深 alpha（.40–.72），因为炭灰表面会吞掉轻阴影。

### Borders, Backgrounds

- 边框一律 1px 发丝线，色用 `--rule`（亮色 `#DEE2E6` / 暗色 `#3A3C42`），用于分隔卡片头、模态头/底、导航项与输入描边；没有粗边框、没有双线。
- 背景是三段表面坡道：container-low `#F8F9FA`（页面 chrome）、container `#F1F3F5`（内嵌区、搜索框）、container-high `#E9ECEF`（凹陷区）。白 `#FFFFFF` 是默认卡片/模态表面；页面本身坐在 container-low 上，让卡片靠对比而非阴影读出抬升感。
- 焦点用 2px 主橙环（`--ring` `#E8590C`，按钮偏移 2px），或输入上的 `0 0 0 2px rgba(232,89,12,.2)` 辉光——橙色是唯一的焦点信号。

---

## Component Patterns

| Component | File | Key Insight |
|---|---|---|
| Button | `preview/component-button.html` | 暖橙主 CTA（"导出报告"），secondary/ghost 扁平、无静息阴影；尺寸 32/40/48，radius-sm 2px 让 chrome 利落。 |
| Card | `preview/component-card.html` | 模块化分区（统计行/用户行/备注+时间）；头部把标题与幽灵操作或药丸标签配对；`elevated` 仅在高亮时才上 shadow-2。 |
| Input | `preview/component-input.html` | 40px 扁平字段、发丝描边、橙色焦点辉光（`rgba(232,89,12,.2)`）；error 把描边换成 `--color-error`，disabled 落到 container-low。 |
| Navigation | `preview/component-navigation.html` | 侧栏 240px + 顶栏 56px + 标签页；激活态 = 橙字 + primary-container 底 + 3px 左边框，三个信号共用一个强调色。 |
| Modal | `preview/component-modal.html` | 480/400px 表面 + shadow-4，覆 `rgba(0,0,0,.6)` 遮罩；头/底以发丝线分隔，body 独立滚动。 |
| Tag | `preview/component-tag.html` | 12px 扁平标签用 radius-sm 表状态（"草稿/活跃/已完成"）；radius-full 药丸仅留给可关闭 chip——标签 vs. chip 是一个圆角决策。 |
| Menu | `preview/component-menu.html` | 扁平浮层菜单 + shadow-3 + 发丝边框；选中项用 primary-container 底色 + 橙字 + 右侧 check 图标；danger 项走 error 色，分组用发丝分隔线。 |
| Table | `preview/component-table.html` | 全宽发丝表格，40px 行高，表头 container-low 底 + caption 字号 + uppercase；数值列走 JetBrains Mono；行 hover 用 container-low 微调底色——绝不用橙色。 |

---

## Index

- `README.md` — 本品牌叙事文档
- `colors_and_type.css` — 全部 CSS 变量（color/type/radius/shadow/spacing/sizing/layout）+ 亮/暗双主题
- `css.json` — CSS 的结构化 JSON token 镜像
- `components.css` — 从 preview 页面自动抽取的聚合组件 CSS
- `components/index.json` — 组件索引与 keyInsightSeed
- `components/{button,card,input,navigation,modal,tag,menu,table}.json` — 逐组件契约（from-scratch，medium 置信度）
- `preview/component-{button,card,input,navigation,modal,tag,menu,table}.html` — 独立 HTML 预览卡
- `ui_kits/dashboard/index.html` — 可交互仪表盘 UI Kit（React 18，3 个场景屏幕）

---

## Caveats / known substitutions

1. **BrandFile 数据缺失** — `phase2-brand-analyst.json` 在生成时为空，品牌人格、语言基调、uiCopySamples 与 kitType 未从规范源获得。本文件的产品定位、语气描述与文案样例均从 token-gen 报告备注及 `preview/`、`components.css` 中提取的真实字符串重建；kitType 依据"仪表盘/数据分析/用户管理"等后台域推断为 `dashboard`。
2. **暗色优先但预览为亮色** — token-gen 标注 `.dark`（炭灰 `#1A1B1E` 底 / `#25262B` 面）为"主要设计意图"，但全部组件预览在 `:root` 亮色基线（白底）上呈现。两套主题 token 完备；请以亮色为已验证渲染，暗色为已声明但未预览。
3. **字体走 CDN** — Inter / Noto Sans SC / JetBrains Mono 经 Google Fonts `@import` 加载；离线需自托管，回退仅为 `sans-serif` / `monospace`，离线时 CJK 字形会退化为系统字体。
4. **图标经 CDN 加载** — navigation 与 menu 预览及 UI Kit 均经 lucide CDN 引用图标（`data-lucide`），本库未附带 SVG 资产目录；离线或生产请替换为内联 `<symbol>` SVG。
5. **Token 均为重建值** — CSS 源注释将所有色板标记为 `AI-generated`，组件置信度为 medium；数值为重建而非原生 Figma 提取，遇精确像素争议以 `colors_and_type.css` 为准。
6. **UI Kit 经 CDN 加载 React** — `ui_kits/dashboard/index.html` 通过 CDN 引入 React 18 + Babel Standalone + Lucide，离线环境无法运行；该文件为设计验证展示，非生产代码。
7. **Menu / Table 为扩展补充** — 两个组件在初次生成时缺失，本次基于既有 token 与组件风格从零重建；契约置信度为 medium，与原始 6 个组件一致。
