/**
 * 作品存储垫片（v3.8.0）
 *
 * 问题：预览 iframe 是不透明源（sandbox 不带 allow-same-origin），
 * 作品里的 localStorage/sessionStorage 一碰就抛 SecurityError —— 记账关掉就没了。
 *
 * 方案：往 srcDoc 注入垫片脚本，把 window.localStorage / sessionStorage
 * 换成内存对象（预载数据 + 变更 postMessage 回写 App 侧持久层）。
 * 不开 allow-same-origin，作品依然偷看不了 App 自己的数据喵。
 */

/** 注入脚本位置：head 优先，兜底 body / doctype 后（避免触发怪异模式） */
export function injectScripts(html: string, scripts: string[]): string {
  const joined = scripts.filter(Boolean).join('\n');
  if (!joined) return html;
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, () => `\n${joined}\n</head>`);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, m => `${m}\n${joined}`);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, m => `${m}\n${joined}`);
  }
  const doctype = html.match(/^\s*(<!doctype[^>]*>)/i);
  if (doctype) {
    return html.replace(/^(\s*<!doctype[^>]*>)/i, `$1\n${joined}`);
  }
  return `${joined}\n${html}`;
}

/**
 * 生成存储垫片脚本。
 * data = 该作品上次持久化的键值（预载进内存，同步 API 语义才成立）。
 */
export function buildStorageShimScript(data: Record<string, string> | null | undefined): string {
  // 防 </script> 注入：数据里的 `<` 转成 \u003c
  const json = JSON.stringify(data ?? {}).replace(/</g, '\\u003c');
  return `<script>
(function () {
  var D = ${json};
  var SESSION = {};
  function FakeStorage() { this.__d = {}; }
  FakeStorage.prototype.getItem = function (k) {
    k = String(k);
    return Object.prototype.hasOwnProperty.call(this.__d, k) ? this.__d[k] : null;
  };
  FakeStorage.prototype.setItem = function (k, v) {
    this.__d[String(k)] = String(v);
    this.__notify();
  };
  FakeStorage.prototype.removeItem = function (k) {
    delete this.__d[String(k)];
    this.__notify();
  };
  FakeStorage.prototype.clear = function () {
    this.__d = {};
    this.__notify();
  };
  FakeStorage.prototype.key = function (i) {
    var ks = Object.keys(this.__d);
    return i >= 0 && i < ks.length ? ks[i] : null;
  };
  FakeStorage.prototype.__notify = function () {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ __yiyanAppData: this.__d }, '*');
      }
    } catch (e) { /* ignore */ }
  };
  Object.defineProperty(FakeStorage.prototype, 'length', {
    get: function () { return Object.keys(this.__d).length; }
  });
  var local = new FakeStorage();
  local.__d = D;
  var session = new FakeStorage();
  session.__d = SESSION;
  try {
    Object.defineProperty(window, 'localStorage', { value: local, configurable: true });
    Object.defineProperty(window, 'sessionStorage', { value: session, configurable: true });
  } catch (e) { /* 某些内核不让替换就算了 */ }
})();
</script>`;
}

/** 消息通道类型（父页面 onmessage 用） */
export interface YiyAppDataMessage {
  __yiyanAppData: Record<string, string>;
}

export interface YiyShotMessage {
  __yiyanShot: { dataURL?: string; error?: string };
}
