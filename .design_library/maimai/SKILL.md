---
name: maimai-design
description: Use this skill to generate well-branded interfaces for maimai. Contains colors, type, fonts, assets, and UI kit for prototyping dashboard UIs.
user-invocable: true
---
# maimai Design Skill

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts, copy assets out and create static HTML files. If working on production code, read the rules here to become an expert in designing with this brand.

## Quick map

- `README.md` — brand context, content fundamentals, visual foundations (read first)
- `colors_and_type.css` — drop-in CSS variables for colors, type, radius, shadow, spacing
- `css.json` — structured token understanding source
- `components.css` — aggregated component CSS from previews
- `library-consumption.json` — recommended downstream read order
- `preview/` — small HTML cards illustrating foundations and components
- `components/index.json` — component index + cross-component patterns
- `uikit-plan.json` — component whitelist and UIKit planner output
- `ui_kits/dashboard/` — full click-thru recreation

## Essentials at a glance

- Brand primary `#E8590C` (maimai-primary-600) — warm, energetic orange; dark-first palette (charcoal `#1A1B1E` bg, `#25262B` surface), `:root` holds the light baseline.
- Radius is **2 / 4 / 8 / 9999** — sharp by default: 2px on controls and status tags, 4px on cards/inputs, 8px for large surfaces; pill (9999) reserved for removable chips and avatars only.
- Density first: 40px default control height (buttons + inputs), 32px small, 48px large; 4px-based spacing (4/8/12/16/24/32/48/64).
- Type: **Inter** for display + Latin headings, **Noto Sans SC** for body (Chinese-first), **JetBrains Mono** for stat values and code.
- Voice: Chinese-first, professional, data-oriented — "导出报告", "数据分析", "仪表盘"; no emoji in product UI.
- Shadows: 5 whisper-quiet levels — at-rest cards use shadow-1 (`0 1px 2px rgba(0,0,0,.08)`), modals step to shadow-4, overlays to shadow-5; flat controls cast no shadow.
- Stat values render in JetBrains Mono to signal data precision; active nav items use a 3px left-border accent in primary orange.

## Components

| Slug | Name | Key Insight |
|------|------|-------------|
| button | Button | 40px height, 2px radius (sharp); 4 variants — primary (orange `#E8590C`), secondary (outlined), ghost, danger; active state darkens via `brightness(.88)`. |
| card | Card | 4px radius, 1px hairline border; header pairs title with a ghost action button; stat values set in JetBrains Mono. |
| input | Input | 40px height, 4px radius; focus paints a `rgba(232,89,12,.2)` ring tinted by primary; search variant insets a left icon. |
| navigation | Navigation | 220px sidebar + 56px topbar + tabs; active item = 3px primary left-border + `--color-primary-container` tint. |
| modal | Modal | 480px width, shadow-4 elevation; header/body/footer divided by 1px borders; sm variant 400px. |
| tag | Tag | 2px radius for status tags (sharp); pill (9999) only for removable chips with a 14px close affordance. |
| menu | Menu | Flat dropdown + shadow-3 + hairline border; selected = primary-container bg + orange text + check icon; danger items use error color; dividers separate action groups. |
| table | Table | Full-width hairline table, 40px rows; header = container-low bg + caption font + uppercase; numeric cells use JetBrains Mono; hover = container-low tint (never orange); row actions are ghost links. |
