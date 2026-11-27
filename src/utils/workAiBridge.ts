/**
 * 作品内 AI 桥（注入到沙箱 iframe 的脚本）
 *
 * 作品只认识 `window.yiyanAI` 这几个函数，请求通过 postMessage 交给宿主。
 * 这里**不判断授权**——未授权也让请求飞出去，由宿主弹一次授权卡；
 * 否则作品检测到「不可用」就永远不会触发授权，用户也找不到开关。
 */
export interface WorkAiBridgeConfig {
  /** 今天还剩几次（仅用于展示，真正判断在宿主） */
  remaining: number;
  /** 作品是否被允许联网 */
  allowSearch: boolean;
}

export function buildWorkAiBridgeScript(config: WorkAiBridgeConfig): string {
  const remaining = Number.isFinite(config.remaining) ? Math.max(0, Math.floor(config.remaining)) : 0;
  const allowSearch = config.allowSearch === true;
  return `<script>
(function () {
  if (window.yiyanAI) return;
  var CFG = { remaining: ${remaining}, allowSearch: ${allowSearch ? 'true' : 'false'} };
  var seq = 0;
  var pending = {};

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || !d.__yiyanAIResult) return;
    var r = d.__yiyanAIResult;
    var item = pending[r.id];
    if (!item) return;
    delete pending[r.id];
    clearTimeout(item.timer);
    if (typeof r.remaining === 'number' && r.remaining >= 0) CFG.remaining = r.remaining;
    if (r.ok) {
      item.resolve(item.kind === 'json' ? r.data : r.text);
      return;
    }
    var err = new Error(r.error || 'AI 调用失败');
    err.code = r.code || 'failed';
    item.reject(err);
  });

  function call(kind, prompt, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var id = 'a' + (++seq);
      pending[id] = {
        resolve: resolve,
        reject: reject,
        kind: kind,
        timer: setTimeout(function () {
          delete pending[id];
          var e = new Error('AI 响应超时');
          e.code = 'timeout';
          reject(e);
        }, 45000)
      };
      try {
        parent.postMessage({
          __yiyanAI: {
            id: id,
            kind: kind,
            prompt: String(prompt == null ? '' : prompt),
            system: opts.system ? String(opts.system) : '',
            thinking: opts.thinking === true,
            search: opts.search === true
          }
        }, '*');
      } catch (err) {
        clearTimeout(pending[id].timer);
        delete pending[id];
        reject(err);
      }
    });
  }

  window.yiyanAI = {
    version: 1,
    available: function () { return true; },
    quota: function () { return CFG.remaining; },
    canSearch: function () { return CFG.allowSearch === true; },
    ask: function (prompt, opts) { return call('ask', prompt, opts); },
    json: function (prompt, opts) { return call('json', prompt, opts); }
  };
})();
</script>`;
}

/** 给写作品的 AI 看的用法手册（会拼进 MCP 工具回执里） */
export const WORK_AI_GUIDE = [
  '这个网页内可以调用 AI：window.yiyanAI。',
  '- await yiyanAI.ask(prompt, { system?, thinking?, search? }) → 纯文本',
  '- await yiyanAI.json(prompt, opts) → 直接拿到对象（内部已解析 JSON）',
  '- yiyanAI.quota() → 今天还剩几次；yiyanAI.canSearch() → 有没有联网权限',
  '',
  '写业务时注意（很重要，不然配额几下就烧完）：',
  '1. 一次拿够：要 10 道题就一次请求 10 道，不要循环调 10 次。',
  '2. 结果要留住：AI 返回的内容立刻存进 localStorage，刷新/切页先读缓存，别重新问。',
  '3. 给 AI 明确格式：用 json() 并写清字段名，比反复追问省事得多。',
  '4. 失败要兜底：调用可能因未授权/额度用完/超时失败，try/catch 后给用户一句人话提示。',
  '5. 默认别开 thinking，也别默认开 search —— 慢、贵，且需要用户单独授权联网。',
  '',
  '【引用图片/资源 · 最容易翻车的一条】',
  'a. 只用 list_files 里**真实存在**的相对路径，逐字一致（Android 区分大小写，Cover.jpg ≠ cover.jpg）。',
  'b. 不要写 `/assets/a.png` 这种绝对路径，也不要想当然猜目录：图在 pages/ 下就写 `pages/p01.jpg`。',
  'c. JS 里拼路径（`pages/p${n}.jpg`）是可以的——预览有运行时垫片会去读文件；',
  '   但拼出来的结果必须和真实文件名完全一致，否则照样裂。',
  'd. 拿不准就先跑 check_work_assets：它会把「引用了但找不到」的路径一次列全。',
].join('\n');
