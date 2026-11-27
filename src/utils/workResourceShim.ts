/**
 * 作品运行时资源垫片（v4.2.5）
 *
 * 为什么需要它：
 * `buildWorkPreview` 只把 **html 里写死的相对路径** 换成 data URL，
 * 而作品一旦用 JS 拼路径（`img.src = \`pages/p${n}.jpg\``、
 * `d.innerHTML = '<img src="...">'`），静态正则就完全看不见——
 * 沙箱文档又是不透明源，相对路径会解析到 App 自己的 URL 上，必然 404 裂图。
 *
 * 这里在 iframe 里装一层「小型虚拟文件系统」：
 * 1. MutationObserver 盯住 img / source / video / link / svg image 与 style 属性；
 * 2. 发现相对路径 → 先换成透明占位，再 postMessage 跟宿主按需要字节；
 * 3. 宿主读完文件回 data URL，垫片写回元素；同一路径缓存，只问一次；
 * 4. 顺带补上 `<style>` 规则里的 url() 与运行时 fetch()。
 *
 * 相比「起本地 HTTP 服务挂 base」的优势：不动存储、不动沙箱、
 * 不需要混合内容放行，Android/iOS/Web 三端同一套逻辑。
 * 局限：XHR 同步请求、Web Worker 内的请求、`<script src>` 动态插入仍管不到。
 */
import { readWorkBinary } from '@/services/workLibrary';

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml',
  md: 'text/markdown',
};

/** 运行时按需加载不设 6MB 的静态内联上限，但也要挡住疯掉的巨文件 */
export const RESOURCE_MAX_BYTES = 24 * 1024 * 1024;

function extOf(path: string): string {
  const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/**
 * 包内相对引用 → 作品内路径（与 workPreview.resolveAssetPath 同规则）。
 * 外部链接 / data: / #锚点 返回 null。
 */
function resolveRelative(baseDir: string, ref: string): string | null {
  let clean = (ref || '').trim().split('#')[0].split('?')[0];
  if (!clean) return null;
  if (clean.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  try {
    clean = decodeURIComponent(clean);
  } catch {
    /* 编码不合法就按原样解析 */
  }
  const segs = clean.startsWith('/') ? [] : (baseDir ? baseDir.split('/') : []);
  for (const part of clean.replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      segs.pop();
      continue;
    }
    segs.push(part);
  }
  return segs.length > 0 ? segs.join('/') : null;
}

/**
 * 宿主侧：把一个相对引用读成 data URL。
 * 读不到 / 越界 / 太大都返回 null，垫片那边会自动放弃换回原样（保持可诊断）。
 */
export async function resolveWorkResourceDataUrl(
  work: string,
  baseDir: string,
  ref: string,
): Promise<string | null> {
  const path = resolveRelative(baseDir, ref);
  if (!path) return null;
  let base64: string | null = null;
  try {
    base64 = await readWorkBinary(work, path);
  } catch {
    return null;
  }
  if (!base64) return null;
  if (base64.length * 0.75 > RESOURCE_MAX_BYTES) return null;
  const mime = MIME[extOf(path)] ?? 'application/octet-stream';
  return `data:${mime};base64,${base64}`;
}

/** 宿主侧：给某一页算 baseDir（当前页所在目录） */
export function resourceBaseDirOf(pagePath: string): string {
  return dirOf(pagePath);
}

/**
 * 注入到 iframe 的垫片脚本。
 * 纯 ES5：老 WebView 也能跑；不含 `</script`，可安全内联。
 */
export function buildResourceShimScript(): string {
  return String.raw`<script>
(function () {
  if (window.__yiyanRes) return;
  window.__yiyanRes = true;

  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var seq = 0;
  var pending = {};
  var cache = {};

  function isRel(ref) {
    if (!ref) return false;
    var t = String(ref).trim();
    if (!t) return false;
    if (t.charAt(0) === '#') return false;
    if (t.indexOf('data:') === 0) return false;
    if (t.indexOf('blob:') === 0) return false;
    if (/^(?:https?:|file:|mailto:|javascript:|tel:|about:|capacitor:)/i.test(t)) return false;
    if (t.indexOf('//') === 0) return false;
    if (t.indexOf('{{') === 0) return false;
    return true;
  }

  function ask(ref, cb) {
    if (Object.prototype.hasOwnProperty.call(cache, ref)) { cb(cache[ref]); return; }
    var id = 'r' + (++seq);
    pending[id] = { ref: ref, cb: cb };
    try {
      parent.postMessage({ __yiyanRes: { id: id, ref: ref } }, '*');
    } catch (e) {
      delete pending[id];
      cb(null);
      return;
    }
    setTimeout(function () {
      if (!pending[id]) return;
      delete pending[id];
      cb(null);
    }, 15000);
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || !d.__yiyanResResult) return;
    var r = d.__yiyanResResult;
    var item = pending[r.id];
    if (!item) return;
    delete pending[r.id];
    if (r.dataUrl) {
      cache[item.ref] = r.dataUrl;
      item.cb(r.dataUrl);
    } else {
      item.cb(null);
    }
  });

  /* ---- img / source / video / svg ---- */

  function fixAttr(el, attr, isSvg) {
    var raw;
    try { raw = isSvg ? el.getAttribute(attr) : el.getAttribute(attr); } catch (e) { return; }
    if (!isRel(raw)) return;
    if (raw === BLANK) return;
    if (isSvg) {
      el.setAttribute(attr, BLANK);
    } else {
      try { el.setAttribute(attr, BLANK); } catch (e) { return; }
    }
    ask(raw, function (url) {
      if (!url) return;
      try {
        el.setAttribute(attr, url);
      } catch (e) { /* ignore */ }
    });
  }

  function fixSrcset(el) {
    var raw = el.getAttribute('srcset');
    if (!raw || !/[\w./-]/.test(raw)) return;
    if (raw.indexOf('data:') >= 0) return;
    var items = raw.split(',');
    var jobs = [];
    for (var i = 0; i < items.length; i++) {
      var seg = items[i].trim();
      if (!seg) continue;
      var bits = seg.split(/\s+/);
      if (isRel(bits[0])) jobs.push({ raw: bits[0], descriptor: bits.slice(1).join(' ') });
    }
    if (jobs.length === 0) return;
    for (var j = 0; j < jobs.length; j++) {
      (function (job) {
        ask(job.raw, function (url) {
          if (!url) return;
          var now = el.getAttribute('srcset') || '';
          var next = now.replace(job.raw, url);
          try { el.setAttribute('srcset', next); } catch (e) { /* ignore */ }
        });
      })(jobs[j]);
    }
  }

  function fixElement(el) {
    if (!el || el.nodeType !== 1) return;
    var tag = (el.tagName || '').toLowerCase();

    if (tag === 'img' || tag === 'source' || tag === 'audio' || tag === 'video' || tag === 'track' || tag === 'embed') {
      fixAttr(el, 'src');
      if (tag === 'img' || tag === 'source') fixSrcset(el);
      if (tag === 'video') fixAttr(el, 'poster');
    } else if (tag === 'image' || tag === 'use') {
      fixAttr(el, 'href', true);
      fixAttr(el, 'xlink:href', true);
    } else if (tag === 'link') {
      var rel = (el.getAttribute('rel') || '').toLowerCase();
      if (rel.indexOf('stylesheet') >= 0) return;
      fixAttr(el, 'href');
    } else if (tag === 'object') {
      fixAttr(el, 'data');
    }

    var style = el.getAttribute && el.getAttribute('style');
    if (style && style.indexOf('url(') >= 0) fixInlineStyle(el, style);
  }

  var URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

  function fixInlineStyle(el, css) {
    var m;
    URL_RE.lastIndex = 0;
    var hits = [];
    while ((m = URL_RE.exec(css))) {
      if (isRel(m[2])) hits.push({ full: m[0], ref: m[2] });
    }
    for (var i = 0; i < hits.length; i++) {
      (function (hit) {
        ask(hit.ref, function (url) {
          if (!url) return;
          var now = el.getAttribute('style') || '';
          if (now.indexOf(hit.full) < 0) return;
          try { el.setAttribute('style', now.split(hit.full).join('url(' + url + ')')); } catch (e) { /* ignore */ }
        });
      })(hits[i]);
    }
  }

  /* ---- <style> 规则（背景图、字体） ---- */

  function fixRule(rule) {
    if (!rule) return;
    if (rule.style) {
      var props = [];
      var i;
      for (i = 0; i < rule.style.length; i++) props.push(rule.style[i]);
      for (i = 0; i < props.length; i++) {
        (function (prop) {
          var val = rule.style.getPropertyValue(prop);
          if (!val || val.indexOf('url(') < 0) return;
          if (val.indexOf('data:') >= 0) return;
          var m;
          URL_RE.lastIndex = 0;
          var hits = [];
          while ((m = URL_RE.exec(val))) {
            if (isRel(m[2])) hits.push({ full: m[0], ref: m[2] });
          }
          for (var k = 0; k < hits.length; k++) {
            (function (hit) {
              ask(hit.ref, function (url) {
                if (!url) return;
                var now = rule.style.getPropertyValue(prop);
                if (now.indexOf(hit.full) < 0) return;
                try {
                  rule.style.setProperty(prop, now.split(hit.full).join('url(' + url + ')'), rule.style.getPropertyPriority(prop));
                } catch (e) { /* ignore */ }
              });
            })(hits[k]);
          }
        })(props[i]);
      }
    }
    if (rule.cssRules) {
      for (var j = 0; j < rule.cssRules.length; j++) fixRule(rule.cssRules[j]);
    }
    if (rule.styleSheet) fixSheet(rule.styleSheet);
  }

  function fixSheet(sheet) {
    var rules;
    try { rules = sheet.cssRules; } catch (e) { return; }
    if (!rules) return;
    for (var i = 0; i < rules.length; i++) fixRule(rules[i]);
  }

  function fixAllSheets() {
    var sheets = document.styleSheets || [];
    for (var i = 0; i < sheets.length; i++) {
      try { fixSheet(sheets[i]); } catch (e) { /* ignore */ }
    }
  }

  /* ---- 补 fetch ---- */

  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isRel(url)) {
          return new Promise(function (resolve, reject) {
            ask(url, function (dataUrl) {
              if (!dataUrl) { resolve(nativeFetch.call(window, input, init)); return; }
              nativeFetch.call(window, dataUrl).then(resolve, reject);
            });
          });
        }
      } catch (e) { /* 落到原生 */ }
      return nativeFetch.call(window, input, init);
    };
  }

  /* ---- 扫描 ---- */

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll('img,source,audio,video,track,embed,link,object,image,use,[style]');
    for (var i = 0; i < nodes.length; i++) fixElement(nodes[i]);
  }

  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (rec.type === 'attributes') {
        fixElement(rec.target);
        continue;
      }
      for (var j = 0; j < rec.addedNodes.length; j++) {
        var node = rec.addedNodes[j];
        if (node.nodeType === 1) {
          if ((node.tagName || '').toLowerCase() === 'style') fixAllSheets();
          fixElement(node);
          scan(node);
        }
      }
    }
  });

  function boot() {
    // 不等 DOMContentLoaded：脚本在 head 里执行时 documentElement 已经在了，
    // 立刻 observe 才能抢在浏览器发出 404 请求之前把相对路径换掉。
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'href', 'poster', 'style', 'data']
    });
    scan(document.documentElement);
    fixAllSheets();
  }

  if (document.documentElement) {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
</script>`;
}
