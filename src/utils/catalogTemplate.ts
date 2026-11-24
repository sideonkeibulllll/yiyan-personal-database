/**
 * 目录页模板（TS 版，与电脑端 pack.py 的 INTRO_TEMPLATE 同源）
 *
 * 两边生成的目录页长得一模一样，且都带 <meta name="yiyan-catalog" content="1">，
 * 这样「重新生成目录页」时能认出旧的那张并原地覆盖，不会越堆越多。
 */

export interface CatalogPageEntry {
  /** 作品内相对路径 */
  rel: string;
  /** 页面标题（取不到就用文件名） */
  title: string;
  /** 字节数 */
  size: number;
}

export interface CatalogRenderInput {
  name: string;
  description?: string;
  pages: CatalogPageEntry[];
  cover?: string | null;
  /** 置顶高亮的主推页面（相对路径） */
  featured?: string | null;
  fileCount: number;
  totalBytes: number;
  /** 字节数格式化函数（复用 workLibrary 的实现） */
  formatSize: (bytes: number) => string;
}

const TEMPLATE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<meta name="yiyan-catalog" content="1" />
<title>__NAME__</title>
<style>
:root{
  --bg:#f4f4f7; --fg:#17171c; --dim:#6b6b7a; --card:#fff; --line:#e4e4ec;
  --accent:#3b6cf6; --accent-soft:rgba(59,108,246,.10); --shadow:0 1px 2px rgba(20,20,40,.06),0 8px 24px rgba(20,20,40,.06);
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#101116; --fg:#f1f1f6; --dim:#9494a4; --card:#1a1b22; --line:#282935;
    --accent:#7d9bff; --accent-soft:rgba(125,155,255,.14); --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.28);
  }
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--fg); min-height:100vh;
  font:15px/1.55 system-ui,-apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased;
  padding:20px 16px calc(28px + env(safe-area-inset-bottom));
}
.wrap{max-width:1080px;margin:0 auto}
.hd{display:flex;align-items:flex-start;gap:14px;margin-bottom:14px}
.hd-main{min-width:0;flex:1}
h1{margin:0;font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-.2px;word-break:break-word}
.sub{margin:4px 0 0;font-size:13px;color:var(--dim);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.dot::before{content:"·";margin-right:10px;opacity:.5}
.desc{margin:6px 0 0;font-size:13px;color:var(--dim);line-height:1.5}
.cover{width:56px;height:56px;border-radius:14px;object-fit:cover;flex:none;border:1px solid var(--line);background:var(--card)}
.bar{display:flex;align-items:center;gap:10px;margin:0 0 16px}
#q{
  flex:1;min-width:0;height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--line);
  background:var(--card);color:var(--fg);font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s;
  -webkit-appearance:none;appearance:none;
}
#q:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
#q::-webkit-search-cancel-button{-webkit-appearance:none}
.cnt{font-size:12px;color:var(--dim);white-space:nowrap;font-variant-numeric:tabular-nums}
.grp{margin:0 0 18px}
.grp-t{
  margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--dim);
  text-transform:uppercase;display:flex;align-items:center;gap:8px;
}
.grp-t::after{content:"";flex:1;height:1px;background:var(--line)}
.grp-n{font-weight:500;opacity:.7}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:10px}
.card{
  display:flex;flex-direction:column;gap:5px;padding:12px 13px;border-radius:13px;
  background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);
  text-decoration:none;color:inherit;transition:transform .12s ease,border-color .12s ease;
  min-height:66px;justify-content:center;
}
.card:hover,.card:focus-visible{transform:translateY(-2px);border-color:var(--accent);outline:none}
.card:active{transform:translateY(0)}
.card-t{font-size:14px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.card-f{font-size:11.5px;color:var(--dim);display:flex;gap:8px;align-items:baseline;min-width:0}
.card-f .fname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-f .fsize{flex:none;font-variant-numeric:tabular-nums;opacity:.85}
.card.hero{
  grid-column:1/-1;flex-direction:row;align-items:center;gap:12px;min-height:0;padding:13px 16px;
  border-color:var(--accent);background:linear-gradient(90deg,var(--accent-soft),transparent 72%);
}
.card.hero .hero-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.card.hero .card-t{-webkit-line-clamp:1;font-size:15px}
.card.hero .card-f{flex:none}
.card.hero .card-f .fname{flex:0 1 auto}
.card.hero .go{flex:none;font-size:13px;font-weight:600;color:var(--accent);white-space:nowrap}
.empty{margin:24px 0;text-align:center;color:var(--dim);font-size:14px}
.ft{margin:26px 0 0;text-align:center;font-size:11.5px;color:var(--dim);opacity:.7}
@media (max-width:520px){
  body{padding:16px 12px 24px}
  h1{font-size:19px}
  .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
  .card{padding:11px;min-height:62px}
}
</style>
</head>
<body>
<div class="wrap">
  <header class="hd">
    <div class="hd-main">
      <h1>__NAME__</h1>
      <p class="sub">__STATS__</p>
      __DESC__
    </div>
    __COVER__
  </header>
  <div id="yiyan-slot-resume"></div>
  <div class="bar">
    <input id="q" type="search" placeholder="搜索页面…" autocomplete="off" autocapitalize="off" spellcheck="false" />
    <span class="cnt" id="cnt"></span>
  </div>
  <main id="list">
    __GROUPS__
    <p class="empty" id="empty" hidden>没有匹配的页面</p>
  </main>
  <footer class="ft">__FOOTER__</footer>
</div>
<script>
(function(){
  var q=document.getElementById('q'),list=document.getElementById('list'),
      cnt=document.getElementById('cnt'),empty=document.getElementById('empty');
  var cards=[].slice.call(list.querySelectorAll('.card')),
      grps=[].slice.call(list.querySelectorAll('.grp'));
  function apply(){
    var k=q.value.trim().toLowerCase(),shown=0;
    cards.forEach(function(c){
      var hit=!k||c.getAttribute('data-k').indexOf(k)>=0;
      c.hidden=!hit; if(hit)shown++;
    });
    grps.forEach(function(g){
      g.hidden=![].slice.call(g.querySelectorAll('.card')).some(function(c){return !c.hidden;});
    });
    cnt.textContent=k?shown+' / '+cards.length:'';
    empty.hidden=!(k&&shown===0);
  }
  q.addEventListener('input',apply);
  q.addEventListener('keydown',function(e){if(e.key==='Escape'){q.value='';apply();}});
})();
</script>
</body>
</html>
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 包内相对路径 → href（逐段百分号编码，保留 `/`） */
function encodeHref(rel: string): string {
  return rel.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

function cardHtml(page: CatalogPageEntry, featured: boolean, formatSize: (n: number) => string): string {
  const base = page.rel.split('/').pop() ?? page.rel;
  const stem = base.replace(/\.html?$/i, '');
  const title = page.title || stem;
  const fname = title === stem || title === base ? '' : base;
  const href = encodeHref(page.rel);
  const key = escapeHtml(`${title} ${page.rel}`.toLowerCase());

  if (featured) {
    const meta = fname || base;
    return (
      `<a class="card hero" href="${href}" data-k="${key}">`
      + '<span class="hero-body">'
      + `<span class="card-t">${escapeHtml(title)}</span>`
      + `<span class="card-f"><span class="fname">${escapeHtml(meta)}</span>`
      + `<span class="fsize">${formatSize(page.size)}</span></span>`
      + '</span>'
      + '<span class="go">打开 →</span>'
      + '</a>'
    );
  }

  return (
    `<a class="card" href="${href}" data-k="${key}">`
    + `<span class="card-t">${escapeHtml(title)}</span>`
    + '<span class="card-f">'
    + (fname ? `<span class="fname">${escapeHtml(fname)}</span>` : '')
    + `<span class="fsize">${formatSize(page.size)}</span>`
    + '</span></a>'
  );
}

export function renderCatalogHtml(input: CatalogRenderInput): string {
  const { name, description, pages, cover, featured, fileCount, totalBytes, formatSize } = input;

  const featuredPage = featured ? pages.find(p => p.rel === featured) ?? null : null;
  const groups = new Map<string, CatalogPageEntry[]>();
  for (const page of pages) {
    const group = page.rel.includes('/') ? page.rel.slice(0, page.rel.lastIndexOf('/')) : '';
    const list = groups.get(group);
    if (list) list.push(page);
    else groups.set(group, [page]);
  }

  const sections: string[] = [];
  if (featuredPage) {
    sections.push(
      '<section class="grp"><h2 class="grp-t">从这里开始</h2>'
      + `<div class="grid">${cardHtml(featuredPage, true, formatSize)}</div></section>`,
    );
  }

  // 用码点序而不是 localeCompare：要跟电脑端 pack.py 的 Python sorted() 完全一致，
  // 否则同一个作品两边生成的目录页分组顺序会不一样。
  const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    if (a[0] === b[0]) return 0;
    if (a[0] === '') return -1;
    if (b[0] === '') return 1;
    return byCodePoint(a[0], b[0]);
  });

  for (const [group, members] of sortedGroups) {
    const cards = members
      .filter(p => !featuredPage || p.rel !== featuredPage.rel)
      .sort((a, b) => byCodePoint(a.rel, b.rel));
    if (cards.length === 0) continue;
    const label = group || '独立页面';
    sections.push(
      `<section class="grp"><h2 class="grp-t">${escapeHtml(label)} <span class="grp-n">${cards.length}</span></h2>`
      + `<div class="grid">${cards.map(p => cardHtml(p, false, formatSize)).join('')}</div></section>`,
    );
  }

  const stats = [
    `<span>${pages.length} 个页面</span>`,
    `<span class="dot">${fileCount} 个文件</span>`,
    `<span class="dot">${formatSize(totalBytes)}</span>`,
  ].join('');

  const descHtml = description ? `<p class="desc">${escapeHtml(description)}</p>` : '';
  const coverHtml = cover
    ? `<img class="cover" src="${encodeHref(cover)}" alt="" />`
    : '';

  // ⚠️ 不能用 String.replace：模板里 __NAME__ 出现两次（<title> 和 <h1>），
  // JS 的 replace 只换第一处，Python 的 str.replace 是全换——两边行为不一样。
  // split/join 等价于「全量替换」，而且不会解释替换内容里的 `$&`。
  let out = TEMPLATE;
  const fill = (token: string, value: string) => {
    out = out.split(token).join(value);
  };
  fill('__NAME__', escapeHtml(name));
  fill('__STATS__', stats);
  fill('__DESC__', descHtml);
  fill('__COVER__', coverHtml);
  fill('__GROUPS__', sections.join('\n    '));
  fill('__FOOTER__', `记忆库 · 作品包 · ${pages.length} 个页面`);
  return out;
}

/** 这张 html 是不是我们生成的目录页 */
export function looksLikeCatalog(html: string): boolean {
  return /<meta\s+name=["']yiyan-catalog["']/i.test(html);
}
