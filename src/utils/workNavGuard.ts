/**
 * 沙箱内的链接守卫（v4.2.2 从 workPreview.ts 抽出来，方便单测）
 *
 * 两件事：
 * 1. 纯锚点（`href="#c01"`）**自己滚，绝不交给浏览器**。
 *    原因：`sandbox`（没有 allow-same-origin）+ `srcDoc` 的 iframe 里，点锚点会触发
 *    fragment 导航 —— 浏览器把 `about:srcdoc#c01` 当成新文档重新加载，srcdoc 内容
 *    不会重新灌进去，结果整页白屏（脚本也一起丢，滚动高亮跟着失效）。
 *    改成 `scrollIntoView` 手动滚动：`scroll-padding-top` 照样生效，页面自己的
 *    滚动高亮也不受影响。
 * 2. 包内其它相对链接 → preventDefault + postMessage 给宿主，由宿主切页重渲染。
 */
export function buildNavGuardScript(): string {
  return `<script>
(function () {
  if (window.__yiyanNavGuard) return;
  window.__yiyanNavGuard = true;

  function scrollToId(rawId) {
    var id = String(rawId == null ? '' : rawId).replace(/^#/, '');
    if (!id) {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
      return true;
    }
    var target = null;
    try { target = document.getElementById(id) || document.getElementsByName(id)[0]; } catch (e) { target = null; }
    if (!target) return false;
    // 先记上 #id：有些页面用 :target 做高亮。replaceState 不触发导航，
    // 沙箱里万一被拒也没关系（滚动才是主需求）
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
    try { window.dispatchEvent(new Event('hashchange')); } catch (e) {}
    try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch (e) { try { target.scrollIntoView(); } catch (e2) {} }
    // 兜底校正：平滑滚动在 WebView 里可能被节流/中断（后台、省电、长距离动画），
    // 1.2 秒后还没停在 scroll-padding-top 的位置就瞬时补一次，保证「点了就到」。
    setTimeout(function () {
      try {
        var pad = 0;
        try { pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0; } catch (e) {}
        var delta = target.getBoundingClientRect().top - pad;
        if (Math.abs(delta) <= 8) return;
        var root = document.documentElement;
        var prev = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(0, (window.scrollY || 0) + delta);
        root.style.scrollBehavior = prev;
      } catch (e) {}
    }, 1200);
    return true;
  }

  // 宿主切页后带过来的锚点（目录页链接写成 page.html#sec2 时用）
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d.__yiyanScrollTo !== 'string') return;
    setTimeout(function () { scrollToId(d.__yiyanScrollTo); }, 60);
  });

  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document && el.nodeName !== 'A') el = el.parentNode;
    if (!el || el.nodeName !== 'A') return;
    var raw = el.getAttribute('href');
    if (!raw) return;
    // ① 纯锚点：只滚，绝不交给浏览器（否则白屏，见文件头注释）
    if (/^\\s*#/.test(raw)) {
      e.preventDefault();
      scrollToId(raw);
      return;
    }
    if (/^\\s*(javascript:|mailto:|tel:|data:|blob:)/i.test(raw)) return;
    if (raw.slice(0, 2) === '//') return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return;
    e.preventDefault();
    parent.postMessage({ __yiyanNav: raw }, '*');
  }, true);
})();
</script>`;
}
