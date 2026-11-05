(function () {
  'use strict';

  const endpoint = '';
  const cdnHost = 'edit-upload-pic.cdn.bcebos.com';
  const maxImageBytes = 5 * 1024 * 1024;
  const maxImages = 100;
  const timeoutMs = 120000;

  function validateEndpoint(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { throw new Error('请填写本次使用的 HTTPS 上传接口。'); }
    const host = url.hostname.toLowerCase().replace(/\.+$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !host.includes('.') || host.includes(':') || /^\d+(?:\.\d+)*$/.test(host)
      || host === 'localhost' || /\.(?:localhost|local|internal|lan|home)$/.test(host)) {
      throw new Error('上传接口须为公开 HTTPS 地址，不含凭据、查询参数或片段。');
    }
    return url.href;
  }

  function classifySource(raw) {
    const source = String(raw || '').trim();
    if (/^data:/i.test(source)) {
      const match = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,([a-z0-9+/]+={0,2})$/i.exec(source);
      if (!match || match[1].length % 4) return { reason: '图片 Data URL 格式不支持' };
      const bytes = match[1].length * 3 / 4 - (match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0);
      if (bytes > maxImageBytes) return { reason: '图片超过 5 MiB 限制' };
      return { source, type: 'data' };
    }
    let url;
    try { url = new URL(source); } catch { return { reason: '本地或相对路径无法直接读取' }; }
    if (!['http:', 'https:'].includes(url.protocol)) return { reason: '仅支持 HTTP(S) 或 Base64 图片' };
    const host = url.hostname.toLowerCase().replace(/\.+$/, '');
    if (host === cdnHost) return { already: true, source };
    if (url.username || url.password || /^\d+(?:\.\d+)*$/.test(host) || host.includes(':')
      || host === 'localhost' || !host.includes('.') || /\.(?:localhost|local|internal|lan|home)$/.test(host)) {
      return { reason: '不上传内网地址、IP 或含凭据的链接' };
    }
    return { source, type: 'url' };
  }

  function validateResult(result) {
    if (result?.ok !== true) throw new Error('上传服务未确认成功，请检查接口状态。');
    const value = result.url || result.data?.url;
    if (typeof value !== 'string' || /[\s<>"'()\\`]/.test(value)) throw new Error('上传服务返回的图片地址格式不安全');
    let url;
    try { url = new URL(value); } catch { throw new Error('上传服务没有返回有效的 CDN 地址'); }
    if (url.protocol !== 'https:' || url.hostname !== cdnHost || url.username || url.password) {
      throw new Error('上传服务返回的地址不是预期的百度 CDN');
    }
    return value;
  }

  function createScanner(createRenderer) {
    const parser = createRenderer();
    let context;
    let pending;
    let imageDepth = 0;
    let entries;
    const htmlStack = [];
    const tableRule = parser.block.ruler.__rules__.find((item) => item.name === 'table')?.fn;
    if (tableRule) parser.block.ruler.at('table', (state, start, end, silent) => {
      const before = state.tokens.length;
      const ok = tableRule(state, start, end, silent);
      if (ok && !silent) {
        // Capture container-adjusted offsets before blockquotes/lists restore
        // their prefixes. Keep only one number per row, not a full line-map copy.
        for (let i = before; i < state.tokens.length; i++) {
          const token = state.tokens[i];
          if (token.type === 'tr_open') token.cdnLineStart = state.bMarks[token.map[0]] + state.tShift[token.map[0]];
        }
      }
      return ok;
    }, { alt: ['paragraph', 'reference'] });
    const parseInline = parser.inline.parse;
    parser.inline.parse = function (text, md, env, tokens) {
      const parent = context;
      let next = pending;
      pending = null;
      if (!next && parent) {
        // Nested inline parses need an explicitly mapped parent range. Never
        // guess with indexOf: identical code examples could get rewritten.
        next = { text, map: null, ignore: parent.ignore || imageDepth > 0 };
      }
      context = next || { text, map: null };
      try { return parseInline.call(this, text, md, env, tokens); }
      finally { context = parent; }
    };
    const add = (source, from, to, kind, title = '') => {
      if (!context?.map || context.ignore || htmlStack.length) return;
      const start = from === to ? context.map[from - 1] + 1 : context.map[from];
      const end = from === to ? start : context.map[to - 1] + 1;
      if (!Number.isInteger(start) || !Number.isInteger(end)) return;
      entries.push({ source, start, end, kind, title });
    };
    const wrap = (name, callback) => {
      // markdown-it 14 is pinned in both runtime and tests. Wrap its actual
      // successful rules, never search-and-replace image-like code examples.
      const rule = parser.inline.ruler.__rules__.find((item) => item.name === name);
      if (!rule) return;
      const original = rule.fn;
      parser.inline.ruler.at(name, (state, silent) => {
        if (context) context.cursor = state.pos;
        return callback(original, state, silent);
      });
    };
    wrap('image', (original, state, silent) => {
      const start = state.pos;
      imageDepth++;
      let ok;
      try { ok = original(state, silent); } finally { imageDepth--; }
      if (!ok || silent || imageDepth || context?.ignore) return ok;
      const token = state.tokens.at(-1);
      const labelEnd = parser.helpers.parseLinkLabel(state, start + 1, false);
      if (state.src[labelEnd + 1] === '(') {
        let from = labelEnd + 2;
        while (/\s/.test(state.src[from] || '') && from < state.pos) from++;
        const destination = parser.helpers.parseLinkDestination(state.src, from, state.pos);
        if (destination.ok) {
          const angle = state.src[from] === '<';
          add(token.attrGet('src'), from + (angle ? 1 : 0), destination.pos - (angle ? 1 : 0), 'markdown');
        }
      } else {
        // Resolve only this image usage to inline syntax. A shared reference
        // definition may also be used by ordinary links, which must not change.
        add(token.attrGet('src'), labelEnd + 1, state.pos, 'reference', token.attrGet('title') || '');
      }
      return ok;
    });
    wrap('legacy_image', (original, state, silent) => {
      const start = state.pos;
      const ok = original(state, silent);
      if (ok && !silent) add(state.tokens.at(-1).attrGet('src'), start + 6, state.pos - 2, 'markdown');
      return ok;
    });
    wrap('footnote_inline', (original, state, silent) => {
      const parentPending = pending;
      if (!silent && state.src.startsWith('^[', state.pos)) {
        const end = parser.helpers.parseLinkLabel(state, state.pos + 1);
        if (end >= 0) {
          const from = state.pos + 2;
          pending = { text: state.src.slice(from, end), map: context?.map?.slice(from, end), ignore: context?.ignore || imageDepth > 0 };
        }
      }
      try { return original(state, silent); }
      finally { pending = parentPending; }
    });

    function scanHtml(text, offset = 0) {
      const ignored = new Set(['pre', 'code', 'script', 'style', 'textarea', 'xmp', 'iframe']);
      for (let i = 0; i < text.length;) {
        if (text[i] !== '<') { i++; continue; }
        if (text.startsWith('<!--', i)) { const end = text.indexOf('-->', i + 4); i = end < 0 ? text.length : end + 3; continue; }
        if (text.startsWith('<![CDATA[', i)) { const end = text.indexOf(']]>', i + 9); i = end < 0 ? text.length : end + 3; continue; }
        if (text.startsWith('<?', i)) { const end = text.indexOf('?>', i + 2); i = end < 0 ? text.length : end + 2; continue; }
        if (text.startsWith('<!', i)) { const end = text.indexOf('>', i + 2); i = end < 0 ? text.length : end + 1; continue; }
        const start = i;
        const match = /^<(\/?)([a-z][\w:-]*)\b/i.exec(text.slice(i));
        if (!match) { i++; continue; }
        let quote = '';
        i += match[0].length;
        for (; i < text.length; i++) {
          const char = text[i];
          if (quote) { if (char === quote) quote = ''; }
          else if (char === '"' || char === "'") quote = char;
          else if (char === '>') break;
        }
        if (i === text.length) break;
        const tag = match[2].toLowerCase();
        if (match[1]) {
          const at = htmlStack.lastIndexOf(tag);
          if (at >= 0) htmlStack.splice(at);
        } else if (ignored.has(tag)) htmlStack.push(tag);
        else if (tag === 'img' && !htmlStack.length) {
          const attrs = text.slice(start + match[0].length, i);
          const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
          for (const attr of attrs.matchAll(attribute)) {
            if (attr[1].toLowerCase() !== 'src') continue;
            const raw = attr[2] ?? attr[3] ?? attr[4];
            if (raw === undefined) break;
            const eq = attr[0].indexOf('=');
            const valueStart = eq + 1 + /^\s*/.exec(attr[0].slice(eq + 1))[0].length + (attr[2] !== undefined || attr[3] !== undefined ? 1 : 0);
            const from = offset + start + match[0].length + attr.index + valueStart;
            const decode = document.createElement('textarea');
            decode.innerHTML = raw;
            add(decode.value, from, from + raw.length, 'html');
            break;
          }
        }
        i++;
      }
    }
    wrap('html_inline', (original, state, silent) => {
      const start = state.pos;
      const ok = original(state, silent);
      if (ok && !silent && !imageDepth) scanHtml(state.src.slice(start, state.pos), start);
      return ok;
    });

    return (source) => {
      if (source.length > 16000000) throw new Error('文档超过 16 MB，请分批上传图片。');
      entries = [];
      htmlStack.length = 0;
      const offsets = [];
      let normalized = '';
      for (let i = 0; i < source.length; i++) {
        offsets.push(i);
        normalized += source[i] === '\r' ? '\n' : source[i] === '\0' ? '\ufffd' : source[i];
        if (source[i] === '\r' && source[i + 1] === '\n') i++;
      }
      const starts = [0];
      for (let i = 0; i < normalized.length; i++) if (normalized[i] === '\n') starts.push(i + 1);
      const env = {};
      const tokens = [];
      // Only the block pass: keep unmodified source content and maps before
      // callout/heading/typographer core transforms remove source characters.
      parser.block.parse(normalized, parser, env, tokens);
      let row;
      for (const token of tokens) {
        if (token.type === 'tr_open') {
          const from = token.cdnLineStart ?? starts[token.map[0]];
          const to = starts[token.map[0] + 1] === undefined ? normalized.length : starts[token.map[0] + 1] - 1;
          const text = normalized.slice(from, to);
          // Mirror markdown-it's table escaped-pipe normalization, keeping an
          // exact per-character source map, including removed backslashes.
          const cells = [{ text: '', map: [] }];
          for (let i = 0; i < text.length; i++) {
            const cell = cells.at(-1);
            if (text[i] === '|' && text[i - 1] !== '\\') cells.push({ text: '', map: [] });
            else {
              if (text[i] === '|' && text[i - 1] === '\\') { cell.text = cell.text.slice(0, -1); cell.map.pop(); }
              cell.text += text[i];
              cell.map.push(offsets[from + i]);
            }
          }
          if (!cells[0].text.trim()) cells.shift();
          if (cells.length && !cells.at(-1).text.trim()) cells.pop();
          row = { cells, index: 0 };
        }
        if (token.type === 'tr_close') row = null;
        if (token.type === 'inline' && !token.map && row) {
          const cell = row.cells[row.index++];
          if (!cell || cell.text.trim() !== token.content) continue;
          const trimStart = cell.text.length - cell.text.trimStart().length;
          pending = { text: token.content, map: cell.map.slice(trimStart, trimStart + token.content.length) };
          parser.inline.parse(token.content, parser, env, []);
          continue;
        }
        if (!['inline', 'html_block'].includes(token.type) || !token.map) continue;
        const map = [];
        let line = token.map[0];
        let valid = true;
        for (const part of token.content.split('\n')) {
          const from = starts[line] ?? normalized.length;
          const to = starts[line + 1] === undefined ? normalized.length : starts[line + 1] - 1;
          const rawLine = normalized.slice(from, to);
          const at = rawLine.lastIndexOf(part);
          if (at < 0) { valid = false; break; }
          for (let j = 0; j < part.length; j++) map.push(offsets[from + at + j]);
          map.push(offsets[to] ?? source.length);
          line++;
        }
        if (!valid) continue;
        map.pop();
        pending = { text: token.content, map };
        if (token.type === 'inline') parser.inline.parse(token.content, parser, env, []);
        else {
          context = pending;
          pending = null;
          scanHtml(token.content);
          context = null;
        }
      }
      const unique = new Map();
      for (const item of entries) unique.set(`${item.start}:${item.end}`, item);
      const images = [...unique.values()].sort((a, b) => a.start - b.start);
      const groups = new Map();
      const skipped = [];
      let already = 0;
      for (const image of images) {
        const classified = classifySource(image.source);
        if (classified.already) { already++; continue; }
        if (classified.reason) { skipped.push({ ...image, reason: classified.reason }); continue; }
        if (!groups.has(classified.source)) groups.set(classified.source, { ...classified, occurrences: [] });
        groups.get(classified.source).occurrences.push(image);
      }
      if (groups.size > maxImages) throw new Error('每次最多上传 100 张不同图片，请分批处理。');
      return { source, groups: [...groups.values()], skipped, already, imageCount: images.length };
    };
  }

  function applyResults(plan, results) {
    const patches = [];
    for (const group of plan.groups) {
      const url = results.get(group.source);
      if (!url) throw new Error('尚有图片未上传成功，原文保持不变。');
      for (const image of group.occurrences) {
        let value = url;
        if (image.kind === 'html') value = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        if (image.kind === 'reference') {
          const title = image.title ? ` "${image.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : '';
          value = `(${url}${title})`;
        }
        patches.push({ start: image.start, end: image.end, value });
      }
    }
    patches.sort((a, b) => b.start - a.start);
    let output = plan.source;
    let boundary = output.length;
    for (const patch of patches) {
      if (patch.end > boundary) throw new Error('图片语法范围重叠，原文保持不变。');
      output = output.slice(0, patch.start) + patch.value + output.slice(patch.end);
      boundary = patch.start;
    }
    return { output, patches };
  }

  async function uploadImage(group, { signal, endpoint: configuredEndpoint, fetchImpl = window.fetch.bind(window) } = {}) {
    const target = validateEndpoint(configuredEndpoint);
    const abort = new AbortController();
    const cancel = () => abort.abort();
    if (signal?.aborted) throw new Error('已取消上传');
    signal?.addEventListener('abort', cancel, { once: true });
    let timeout = false;
    const timer = setTimeout(() => { timeout = true; abort.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(target, {
        method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(group.type === 'data' ? { image: group.source } : { url: group.source }),
        signal: abort.signal,
      });
      let result;
      try { result = await response.json(); } catch { throw new Error(`上传服务返回非 JSON 响应（HTTP ${response.status}）`); }
      if (!response.ok) throw new Error(`上传失败（HTTP ${response.status}），请检查接口配置或图片大小。`);
      return validateResult(result);
    } catch (error) {
      if (signal?.aborted) throw new Error('已取消上传');
      if (timeout) throw new Error('单张图片上传超时，未自动重试，避免重复上传。');
      if (error instanceof Error && !/https?:|data:|authorization/i.test(error.message)) throw error;
      throw new Error('上传请求失败，请检查接口和网络；原文未修改。');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  function createController({ editor, createRenderer, document = window.document, upload = uploadImage }) {
    const scan = createScanner(createRenderer);
    const button = document.getElementById('btn-upload-cdn');
    const panel = document.getElementById('image-cdn-panel');
    const status = document.getElementById('image-cdn-status');
    const progress = document.getElementById('image-cdn-progress');
    const details = document.getElementById('image-cdn-details');
    const cancelButton = document.getElementById('image-cdn-cancel');
    const closeButton = document.getElementById('image-cdn-close');
    const endpointInput = document.getElementById('image-cdn-endpoint');
    const startButton = document.getElementById('image-cdn-start');
    const cache = new Map();
    let running = false;
    let controller;
    let ownChange = false;
    let edited = false;
    let originalReadOnly;
    const detail = (text) => {
      const item = document.createElement('li');
      item.textContent = text;
      details.append(item);
    };
    const announce = (text) => { status.textContent = text; };
    const saveInMemory = (source, url) => {
      if (cache.size >= maxImages && !cache.has(source)) cache.delete(cache.keys().next().value);
      cache.set(source, url);
    };
    const busy = (value) => {
      button.disabled = value;
      button.textContent = value ? '图片上传中…' : '图片上传CDN';
      cancelButton.hidden = !value;
      closeButton.hidden = value;
      panel.setAttribute('aria-busy', String(value));
      if (endpointInput) endpointInput.disabled = value;
      if (startButton) startButton.disabled = value;
      // Keep the operation transactional even if another action changes the editor.
      if (value) {
        originalReadOnly = editor.getOption('readOnly');
        editor.setOption('readOnly', true);
      } else editor.setOption('readOnly', originalReadOnly);
    };
    editor.on('change', () => {
      if (running && !ownChange) {
        edited = true;
        controller.abort();
      }
    });
    cancelButton.addEventListener('click', () => controller?.abort());
    closeButton.addEventListener('click', () => { panel.hidden = true; button.focus(); });
    const start = async () => {
      if (running) return;
      panel.hidden = false;
      let target;
      try { target = validateEndpoint(endpointInput?.value); }
      catch (error) { announce(error.message); endpointInput?.focus(); return; }
      details.replaceChildren();
      announce('正在扫描 Markdown 图片…');
      progress.value = 0;
      progress.max = 1;
      let plan;
      try { plan = scan(editor.getValue()); }
      catch (error) { announce(String(error.message || error)); return; }
      for (const item of plan.skipped.slice(0, 10)) {
        const line = plan.source.slice(0, item.start).split('\n').length;
        detail(`第 ${line} 行已跳过：${item.reason}`);
      }
      if (plan.skipped.length > 10) detail(`另有 ${plan.skipped.length - 10} 处不支持的图片未列出。`);
      if (plan.already) detail(`${plan.already} 处已是百度 CDN 地址，无需重复上传。`);
      if (!plan.groups.length) {
        announce(plan.imageCount ? '没有需要上传的图片，原文未修改。' : 'Markdown 中没有可上传的图片。');
        return;
      }
      // The button itself is the explicit user action to send these images.
      detail('仅上传图片或图片地址至 imgtool / 百度 CDN，不发送 Markdown 正文。');
      running = true;
      edited = false;
      controller = new AbortController();
      busy(true);
      const results = new Map();
      let completed = 0;
      progress.max = plan.groups.length;
      const started = Date.now();
      try {
        for (const group of plan.groups) {
          if (controller.signal.aborted) throw new Error('已取消上传');
          if (Date.now() - started > 15 * 60 * 1000) throw new Error('本批上传已达 15 分钟，请分批处理；原文未修改。');
          announce(`上传中 ${completed}/${plan.groups.length} · 正在处理第 ${completed + 1} 张`);
          const cached = cache.get(group.source);
          const url = cached || await upload(group, { signal: controller.signal, endpoint: target });
          // A received success is reusable after cancellation, but may not mutate
          // the document once the user has cancelled or another writer edited it.
          validateResult({ ok: true, url });
          saveInMemory(group.source, url);
          results.set(group.source, url);
          if (controller.signal.aborted || edited) throw new Error('已取消上传');
          completed++;
          progress.value = completed;
          announce(`已上传 ${completed}/${plan.groups.length}`);
        }
        if (edited || editor.getValue() !== plan.source) throw new Error('文档已变化，未替换任何链接。');
        const { patches } = applyResults(plan, results);
        ownChange = true;
        try {
          editor.operation(() => {
            for (const patch of patches) {
              editor.replaceRange(patch.value, editor.posFromIndex(patch.start), editor.posFromIndex(patch.end), '+cdn-upload');
            }
          });
        } finally { ownChange = false; }
        announce(`完成：上传 ${completed} 张图片，替换 ${patches.length} 处链接${plan.skipped.length ? `，跳过 ${plan.skipped.length} 处` : ''}。可使用撤销恢复原链接。`);
      } catch (error) {
        announce(edited ? `文档已变化，已停止；原有编辑保留，未替换链接。已收到 ${completed}/${plan.groups.length} 张上传结果。`
          : `${controller.signal.aborted ? '已取消' : '上传中断'}：${String(error.message || error)} 原文链接未修改（已完成 ${completed}/${plan.groups.length} 张）。`);
        if (completed) detail('已成功的上传本页内暂存，重新点击可复用；已发出的上传无法撤回。');
      } finally {
        running = false;
        busy(false);
      }
    };
    button.addEventListener('click', () => {
      panel.hidden = false;
      if (!endpointInput?.value.trim()) { announce('请填写本次使用的上传接口；地址只在当前页面内存中使用。'); endpointInput?.focus(); }
      else start();
    });
    startButton?.addEventListener('click', start);
    return { start, isRunning: () => running };
  }

  window.ImageCdn = { endpoint, validateEndpoint, createScanner, classifySource, validateResult, applyResults, uploadImage, createController };
}());
