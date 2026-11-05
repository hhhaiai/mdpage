let __dynamicScriptPromises = new Map();
let __drawioLibPromise;

function ensureScriptLoaded(src, testFn, errorMessage) {
  if (typeof testFn === 'function' && testFn()) {
    return Promise.resolve();
  }

  if (__dynamicScriptPromises.has(src)) {
    return __dynamicScriptPromises.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);
    const timeout = setTimeout(() => {
      if (!existingScript) script.remove();
      reject(new Error(errorMessage + '（加载超时）'));
    }, 15000);

    const handleLoad = () => {
      clearTimeout(timeout);
      if (typeof testFn !== 'function' || testFn()) {
        resolve();
      } else {
        if (!existingScript) script.remove();
        reject(new Error(errorMessage));
      }
    };

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad, { once: true });
      existingScript.addEventListener('error', () => { clearTimeout(timeout); reject(new Error(errorMessage)); }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = handleLoad;
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error(errorMessage)); };
    document.head.appendChild(script);
  }).catch((error) => {
    __dynamicScriptPromises.delete(src);
    throw error;
  });

  __dynamicScriptPromises.set(src, promise);
  return promise;
}

async function ensureExportLibsLoaded() {
  await ensureScriptLoaded(
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    () => typeof window.html2canvas === 'function',
    'html2canvas 加载失败（请检查网络/CDN）。'
  );

  await ensureScriptLoaded(
    'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
    () => !!window.docx,
    'docx 库加载失败（请检查网络/CDN）。'
  );

  await ensureScriptLoaded(
    'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
    () => typeof window.saveAs === 'function',
    'FileSaver 加载失败（请检查网络/CDN）。'
  );
}

async function ensureDrawioLoaded() {
  const harden = () => {
    if (window.mxStylesheetCodec) window.mxStylesheetCodec.allowEval = false;
    if (window.mxObjectCodec) {
      window.mxObjectCodec.allowEval = false;
      window.mxObjectCodec.prototype.processInclude = function (_decoder, node) {
        if (node?.nodeName === 'include') throw new Error('禁止加载 draw.io 外部引用。');
        return false;
      };
    }
  };
  if (canRenderDrawio()) { harden(); return; }
  if (__drawioLibPromise) return __drawioLibPromise;

  window.mxBasePath = 'https://unpkg.com/mxgraph@4.2.2/javascript/src';
  window.mxImageBasePath = 'https://unpkg.com/mxgraph@4.2.2/javascript/src/images';

  __drawioLibPromise = ensureScriptLoaded(
    'https://unpkg.com/mxgraph@4.2.2/javascript/mxClient.min.js',
    () => canRenderDrawio(),
    'mxGraph 加载失败（请检查网络/CDN）。'
  ).then(harden).catch((error) => {
    __drawioLibPromise = null;
    throw error;
  });

  return __drawioLibPromise;
}

// 初始化 Markdown 渲染器（markdown-it）和 CodeMirror 编辑器
function createMarkdownRenderer() {
  if (!window.markdownit) {
    throw new Error('markdown-it 未加载（请检查网络/CDN）。');
  }

  const md = window.markdownit({
    html: true,
    linkify: true,
    typographer: true
  });

  // 任务列表 / 脚注 / emoji
  if (typeof window.markdownitTaskLists === 'function') {
    md.use(window.markdownitTaskLists, { enabled: false, label: true });
  }
  if (typeof window.markdownitFootnote === 'function') {
    md.use(window.markdownitFootnote);
  }
  const emojiPlugin = window.markdownitEmoji?.full || window.markdownitEmoji;
  if (typeof emojiPlugin === 'function') {
    md.use(emojiPlugin);
  }
  // 常见 Markdown 方言的轻量 inline/block 扩展，基础渲染继续使用 markdown-it。
  if (typeof window.markdownitDeflist === 'function') {
    md.use(window.markdownitDeflist);
  }
  if (typeof window.markdownitAbbr === 'function') {
    md.use(window.markdownitAbbr);
  }
  if (typeof window.markdownitMark === 'function') {
    md.use(window.markdownitMark);
  }
  if (typeof window.markdownitSub === 'function') {
    md.use(window.markdownitSub);
  }
  if (typeof window.markdownitSup === 'function') {
    md.use(window.markdownitSup);
  }
  if (typeof window.markdownitIns === 'function') {
    md.use(window.markdownitIns);
  }

  md.use(window.MarkdownCompat.install, {
    container: window.markdownitContainer,
    normalizeSequence: normalizeLegacySequenceBody,
    normalizeFlow: normalizeLegacyFlowBody,
  });

  return md;
}

const md = createMarkdownRenderer();
const editor = CodeMirror.fromTextArea(document.getElementById("code"), {
  mode: "markdown",
  theme: "neo",
  lineNumbers: true,
  lineWrapping: true
});
const outline = window.MarkdownCompat.createOutline({
  root: document.getElementById('preview'),
  pane: document.getElementById('preview-pane'),
  panel: document.getElementById('floating-toc'),
  list: document.getElementById('floating-toc-list'),
  toggle: document.getElementById('floating-toc-toggle'),
});
const diagrams = window.DiagramRenderer.createController({ loadScript: ensureScriptLoaded });
const imageCdn = window.ImageCdn.createController({ editor, createRenderer: createMarkdownRenderer });

function normalizeLegacySequenceBody(body) {
  const lines = String(body || '').split('\n');
  const output = [];
  let hasHeader = false;

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    if (/^sequenceDiagram\b/i.test(line)) {
      hasHeader = true;
      output.push(line);
      return;
    }

    const titleMatch = /^Title\s*:\s*(.+)$/i.exec(line);
    if (titleMatch) {
      output.push(`title ${titleMatch[1].trim()}`);
      return;
    }

    const noteMatch = /^Note\s+(right of|left of|over)\s+(.+)$/i.exec(line);
    if (noteMatch) {
      output.push(`Note ${noteMatch[1]} ${noteMatch[2]}`);
      return;
    }

    const participantMatch = /^participant\s+(.+)$/i.exec(line);
    if (participantMatch) {
      output.push(`participant ${participantMatch[1]}`);
      return;
    }

    output.push(rawLine);
  });

  const normalized = output.join('\n').trim();
  if (!normalized) return '';
  return hasHeader ? normalized : `sequenceDiagram\n${normalized}`;
}

function normalizeLegacyFlowBody(body) {
  const lines = String(body || '').split('\n');
  const nodeLines = [];
  const edgeLines = [];

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const nodeMatch = /^([A-Za-z0-9_]+)=>(start|end|operation|condition|subroutine|inputoutput):\s*(.+)$/.exec(line);
    if (nodeMatch) {
      const [, id, type, label] = nodeMatch;
      const safeLabel = label.replace(/"/g, '&quot;');
      const shape = type === 'start' ? `("${safeLabel}")`
        : type === 'end' ? `("${safeLabel}")`
          : type === 'operation' ? `["${safeLabel}"]`
            : type === 'condition' ? `{"${safeLabel}"}`
              : type === 'subroutine' ? `[["${safeLabel}"]]`
                : `[/"${safeLabel}"/]`;
      nodeLines.push(`  ${id}${shape}`);
      return;
    }

    if (line.includes('->')) {
      const parts = line
        .split(/->/)
        .map(part => part.replace(/\((yes|no|right|left|top|bottom)\)/gi, '').trim())
        .filter(Boolean);

      if (parts.length >= 2) {
        for (let i = 0; i < parts.length - 1; i++) {
          edgeLines.push(`  ${parts[i]} --> ${parts[i + 1]}`);
        }
      }
    }
  });

  if (!nodeLines.length && !edgeLines.length) return '';
  return ['flowchart TD', ...nodeLines, ...edgeLines].join('\n');
}

// 设置默认内容
editor.setValue(`# Markdown 小助手使用指南事例

欢迎使用 **Markdown 小助手**！这是一个功能强大的在线 Markdown 编辑器。

[TOC]

---

## 🎯 主要功能

### 1. 实时预览
- 左侧编辑，右侧实时预览
- 支持标准 Markdown 语法
- 代码高亮显示

### 2. 预览模式
- 点击顶部 **"👁 预览模式"** 按钮进入全屏预览
- 点击右下角悬浮按钮或顶部按钮退出预览

### 3. 清空编辑器
- 点击左上角 **"🧹 橡皮擦"** 按钮清空内容
- 清空前会弹出确认提示

### 4. 导出 Word
- 点击 **"📄 导出 Word"** 按钮
- 自动将 Markdown 转换为 .docx 文档
- 支持图表导出

---

## 📊 支持的功能

### 表格示例

| 功能 | 说明 | 状态 |
|------|------|------|
| 实时预览 | 编辑即时显示 | ✅ |
| 代码高亮 | 多语言支持 | ✅ |
| Mermaid 图表 | 流程图/时序图 | ✅ |
| Word 导出 | 一键导出文档 | ✅ |

### 更多 Markdown 扩展

==高亮文本==、H~2~O、x^2^、++插入文本++ 和 :rocket:。

> [!TIP] 目录与提示块
> 有标题就会生成右上角悬浮目录；单独一行写 \`[TOC]\`、\`[[toc]]\` 或 \`[[_TOC_]]\` 还会插入正文目录。

> [!WARNING]- 点击展开注意事项
> 支持 GitHub 提示块和 Obsidian 折叠写法；代码块内的示例不会被改写。

TOC
: Table of Contents，文档目录。

### 代码高亮

\`\`\`javascript
function hello() {
  console.log("Hello, Markdown!");
}
\`\`\`

### 公式（KaTeX）

行内公式：$a^2 + b^2 = c^2$
块级公式：

$$
E = mc^2
$$

### Mermaid 流程图

\`\`\`mermaid
graph TD
    A[开始编辑] --> B[实时预览]
    B --> C{满意吗?}
    C -->|是| D[导出 Word]
    C -->|否| A
    D --> E[完成]
\`\`\`

### Mermaid 时序图

\`\`\`mermaid
sequenceDiagram
  participant U as 用户
  participant E as 编辑器
  participant P as 预览区
  U->>E: 输入 Markdown
  E->>P: 渲染 HTML
  P-->>U: 显示预览
\`\`\`

### 折叠块（收缩/展开）

:::details 点击展开查看更多

- 支持 **Markdown** 语法
- 支持公式 \`$...$\` / \`$$...$$\`
- 支持 Mermaid 多种图（流程图/时序图/甘特图等）

:::

---

## 💡 快速开始

1. 在左侧编辑器输入 Markdown 内容
2. 右侧自动显示预览效果
3. 使用工具栏按钮进行操作

**现在就开始编辑吧！** 🚀
`);

// 渲染 Markdown 预览
let timer;
let renderedSource = null;
let renderVersion = 0;
let mermaidJob = Promise.resolve();
const render = () => {
  const preview = document.getElementById('preview');
  const source = editor.getValue();
  if (source === renderedSource) return;
  renderedSource = source;
  const version = ++renderVersion;
  diagrams.dispose();
  preview.querySelectorAll('.drawio-diagram').forEach((node) => {
    try { node.__drawio?.graph.destroy(); } catch { }
  });
  if (typeof window.DOMPurify?.sanitize !== 'function') {
    preview.textContent = '安全渲染库加载失败，请检查网络后刷新。原始 Markdown 未丢失。';
    preview.dataset.renderError = '1';
    renderedSource = null;
    outline.update();
    return;
  }
  if (source.length > 2000000 || (source.match(/^\s{0,3}#{1,6}\s/gm) || []).length > 5000) {
    preview.textContent = '文档超过预览限制（2 MB 或 5000 个标题），请拆分后预览。原文可正常保存。';
    preview.dataset.renderError = '1';
    outline.update();
    return;
  }
  delete preview.dataset.renderError;
  try {
  // 保留安全的 HTML（details、表格、图片等），不执行粘贴内容中的脚本/事件或页面级样式。
  preview.innerHTML = window.DOMPurify.sanitize(md.render(source), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style', 'name'],
  });
  if (preview.querySelectorAll('*').length > 30000 || preview.querySelectorAll('h1,h2,h3,h4,h5,h6').length > 5000) {
    throw new Error('预览节点或标题数量超过限制。');
  }
  window.MarkdownCompat.renderMath(preview, window.katex);
  outline.update();
  diagrams.render(preview);

  let hasMermaid = false;
  let hasDrawio = false;

  // Mermaid：将 ```mermaid 代码块替换成 <div class="mermaid">
  preview.querySelectorAll('pre code').forEach(block => {
    const className = block.className || '';
    const isMermaid = /(^|\s)language-mermaid(\s|$)/.test(className) || /(^|\s)lang-mermaid(\s|$)/.test(className);

    const isDrawio = /(^|\s)language-drawio(\s|$)/.test(className)
      || /(^|\s)lang-drawio(\s|$)/.test(className)
      || /(^|\s)language-mxgraph(\s|$)/.test(className)
      || /(^|\s)lang-mxgraph(\s|$)/.test(className)
      || /(^|\s)language-draw\.io(\s|$)/.test(className)
      || /(^|\s)lang-draw\.io(\s|$)/.test(className);

    if (isMermaid) {
      hasMermaid = true;
      const div = document.createElement('div');
      div.classList.add('mermaid');
      div.textContent = block.textContent;
      div.dataset.mermaidState = 'loading';
      block.parentElement.replaceWith(div);
    } else if (isDrawio) {
      hasDrawio = true;
      const host = document.createElement('div');
      host.classList.add('drawio-diagram');
      host.setAttribute('data-drawio-rendered', '0');

      // 用隐藏节点保存 XML，避免塞进 attribute 造成转义/长度问题
      const source = document.createElement('script');
      source.type = 'text/plain';
      source.className = 'drawio-source';
      source.textContent = block.textContent || '';
      host.appendChild(source);

      // 预览 UI：提示条 + 控件 + 图 + 源码折叠
      const wrap = document.createElement('div');
      wrap.className = 'drawio-wrap';

      const banner = document.createElement('div');

      const toolbar = document.createElement('div');
      toolbar.className = 'drawio-toolbar';
      toolbar.innerHTML = `
        <button type="button" class="drawio-btn" data-action="zoom-out" title="缩小">-</button>
        <button type="button" class="drawio-btn" data-action="zoom-in" title="放大">+</button>
        <button type="button" class="drawio-btn" data-action="zoom-reset" title="重置">Reset</button>
      `;

      const capture = document.createElement('div');
      capture.className = 'drawio-capture';
      capture.innerHTML = '<div class="drawio-placeholder">draw.io 图渲染中...</div>';

      const details = document.createElement('details');
      details.className = 'drawio-xml';
      const summary = document.createElement('summary');
      summary.textContent = '查看 draw.io XML 内容';

      const box = document.createElement('div');
      box.className = 'drawio-xml-box';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'drawio-copy-btn';
      copyBtn.textContent = '复制';
      copyBtn.setAttribute('data-action', 'copy-xml');

      const pre = document.createElement('pre');
      pre.className = 'drawio-xml-pre';
      const code = document.createElement('code');
      code.className = 'language-xml';
      const escaped = (source.textContent || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      code.innerHTML = escaped;
      pre.appendChild(code);

      box.appendChild(copyBtn);
      box.appendChild(pre);
      details.appendChild(summary);
      details.appendChild(box);

      wrap.appendChild(banner);
      wrap.appendChild(toolbar);
      wrap.appendChild(capture);
      wrap.appendChild(details);
      host.appendChild(wrap);

      block.parentElement.replaceWith(host);
    } else {
      if (!block.closest('.md-diagram')) hljs.highlightElement(block);
    }
  });

  if (hasMermaid) {
    const nodes = [...preview.querySelectorAll('.mermaid')];
    mermaidJob = (async () => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const code = node.textContent;
        try {
          if (i >= 20 || code.length > 100000) throw new Error('Mermaid 超过图表数量或大小限制。');
          const result = await mermaid.render(`mermaid-${version}-${i}`, code);
          if (version !== renderVersion || !preview.contains(node)) return;
          node.innerHTML = window.DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'a', 'image'] });
          node.dataset.mermaidState = 'ready';
        } catch {
          if (version !== renderVersion) return;
          node.dataset.mermaidState = 'error';
          const message = document.createElement('p');
          message.textContent = 'Mermaid 渲染失败，请检查原始语法或图表大小。';
          const pre = document.createElement('pre');
          pre.textContent = code;
          node.replaceChildren(message, pre);
        }
      }
    })();
  } else mermaidJob = Promise.resolve();

  // draw.io：渲染 mxGraphModel（异步排队，避免影响当前渲染流畅度）
  if (hasDrawio) {
    queueMicrotask(() => {
      renderDrawioDiagrams(preview).catch(e => {
        console.error('draw.io render error:', e);
      });
    });
  }
  } catch {
    preview.textContent = '预览失败，请检查文档大小或依赖加载。原始内容未修改。';
    preview.dataset.renderError = '1';
    renderedSource = null;
    outline.update();
  }
};

function canRenderDrawio() {
  return typeof window.mxGraph === 'function'
    && typeof window.mxCodec === 'function'
    && typeof window.mxUtils?.parseXml === 'function';
}

function normalizeDrawioXml(input) {
  let xml = String(input || '');
  xml = xml.replace(/^\uFEFF/, '').trim();

  // 兜底：有人会把整个 XML 当成“HTML 片段”粘贴，导致根标签是 &lt;mxGraphModel ...
  // 这里做“一次性”HTML 实体解码（非递归），避免把原本合法的 &lt;div&gt; 再解码成 <div>。
  if (/^\s*&lt;\s*(mxgraphmodel|mxfile)\b/i.test(xml)) {
    const ta = document.createElement('textarea');
    ta.innerHTML = xml;
    xml = ta.value.trim();
  }

  const escapeBareAmp = (s) => s.replace(
    /&(?!(?:lt|gt|amp|quot|apos);|#\d+;|#x[0-9a-fA-F]+;)/g,
    '&amp;'
  );

  const escapeForXmlAttr = (s) => {
    // 对属性值进行 XML 合法化：裸 < / > / & 必须转义
    return escapeBareAmp(String(s || ''))
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  // 修复 draw.io 常见粘贴问题：mxCell 的 value="<div>..."（未转义 <）会导致 XML parsererror
  // 只处理 value 属性，避免误伤 style 等其他属性。
  xml = xml.replace(/\bvalue\s*=\s*"([^"]*)"/g, (_m, v) => `value="${escapeForXmlAttr(v)}"`);
  xml = xml.replace(/\bvalue\s*=\s*'([^']*)'/g, (_m, v) => `value='${escapeForXmlAttr(v)}'`);

  return xml;
}

async function renderDrawioDiagrams(root) {
  if (!root) return;
  const nodes = Array.from(root.querySelectorAll('.drawio-diagram'));
  const pendingNodes = nodes.filter(node => {
    const state = node.getAttribute('data-drawio-rendered');
    return state === '0';
  });
  if (!pendingNodes.length) return;
  pendingNodes.forEach((node) => node.setAttribute('data-drawio-rendered', 'loading'));

  try {
    await Promise.all([ensureDrawioLoaded(), diagrams.loadDrawioDecoder()]);
  } catch (e) {
    pendingNodes.forEach(node => {
      const error = document.createElement('div');
      error.className = 'drawio-error';
      error.textContent = String(e.message || e);
      node.replaceChildren(error);
      node.setAttribute('data-drawio-rendered', 'error');
    });
    throw e;
  }

  pendingNodes.forEach(node => {
    if (!root.contains(node) || node.getAttribute('data-drawio-rendered') !== 'loading') return;
    const xml = node.querySelector('.drawio-source')?.textContent
      || node.getAttribute('data-drawio-xml')
      || '';

    if (!xml.trim()) {
      node.innerHTML = '<div class="drawio-error">draw.io 图为空</div>';
      node.setAttribute('data-drawio-rendered', '1');
      return;
    }

    if (!canRenderDrawio()) {
      node.innerHTML = '<div class="drawio-error">mxGraph 未加载（请检查网络/CDN）</div>';
      node.setAttribute('data-drawio-rendered', '0');
      return;
    }

    let pages;
    try {
      pages = window.DiagramRenderer.parseDrawioPages(normalizeDrawioXml(xml));
    } catch (error) {
      const message = document.createElement('div');
      message.className = 'drawio-error';
      message.textContent = String(error.message || error);
      const capture = node.querySelector('.drawio-capture');
      (capture || node).replaceChildren(message);
      node.setAttribute('data-drawio-rendered', 'error');
      return;
    }
    if (pages.length > 1) {
      const children = pages.map((page) => {
        const child = node.cloneNode(true);
        child.setAttribute('data-drawio-rendered', '0');
        child.querySelector('.drawio-source').textContent = new XMLSerializer().serializeToString(page.doc);
        const title = document.createElement('p');
        title.className = 'drawio-page-title';
        title.textContent = page.name;
        child.querySelector('.drawio-wrap').prepend(title);
        return child;
      });
      node.replaceWith(...children);
      renderDrawioDiagrams(root).catch(error => console.error('draw.io render error:', error));
      return;
    }
    node.setAttribute('data-drawio-rendered', 'rendering');

    const capture = node.querySelector('.drawio-capture');
    if (!capture) {
      node.innerHTML = '<div class="drawio-error">draw.io 预览容器缺失</div>';
      node.setAttribute('data-drawio-rendered', '0');
      return;
    }

    // 清理 capture 区，仅重建图容器（保留 banner/toolbar/details/source）
    capture.innerHTML = '';
    const frame = document.createElement('div');
    frame.className = 'drawio-frame';
    capture.appendChild(frame);

    const container = document.createElement('div');
    container.className = 'drawio-canvas';
    frame.appendChild(container);

    // mxGraph 需要节点在 DOM 中才能正确测量
    const graph = new window.mxGraph(container);
    graph.setEnabled(false);
    graph.setConnectable(false);
    graph.setPanning(false);
    graph.setTooltips(false);
    graph.setCellsSelectable(false);
    graph.setGridEnabled(false);
    graph.foldingEnabled = false;

    // 关键：让 html=1 的 label 按 HTML 渲染（否则 <div> 会被当纯文本，导致宽度爆炸、整体被缩得很小）
    graph.setHtmlLabels(true);
    const baseConvertValue = graph.convertValueToString;
    graph.convertValueToString = function (cell) {
      const label = baseConvertValue.call(this, cell);
      return window.DOMPurify.sanitize(label, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
        FORBID_ATTR: ['style', 'name'],
      });
    };
    const baseIsHtmlLabel = graph.isHtmlLabel;
    graph.isHtmlLabel = function (cell) {
      try {
        const style = this.getCurrentCellStyle(cell) || {};
        const htmlFlag = style.html;
        if (htmlFlag === 1 || htmlFlag === '1' || htmlFlag === true || htmlFlag === 'true') return true;
      } catch { }
      return baseIsHtmlLabel ? baseIsHtmlLabel.call(this, cell) : false;
    };

    // 较大图时按预览宽度缩放
    const margin = 10;
    const maxWidth = Math.max(320, Math.min(1000, frame.clientWidth || 840));

    graph.getModel().beginUpdate();
    try {
      const doc = pages[0].doc;
      const codec = new window.mxCodec(doc);
      codec.decode(doc.documentElement, graph.getModel());
    } catch (e) {
      const error = document.createElement('div');
      error.className = 'drawio-error';
      error.textContent = 'draw.io XML 解析失败：' + String(e.message || e);
      node.replaceChildren(error);
      try { graph.destroy(); } catch { }
      node.setAttribute('data-drawio-rendered', 'error');
      return;
    } finally {
      graph.getModel().endUpdate();
    }

    // 让布局稳定后再算 bounds/scale
    requestAnimationFrame(() => {
      if (!root.contains(node)) { graph.destroy(); return; }
      try {
        const bounds = graph.getGraphBounds();
        const rawW = Math.max(1, Math.ceil(bounds.width + margin * 2));
        const rawH = Math.max(1, Math.ceil(bounds.height + margin * 2));
        const baseScale = rawW > maxWidth ? (maxWidth / rawW) : 1;
        const zoom = Number(node.getAttribute('data-drawio-zoom') || '1') || 1;
        const scale = baseScale * zoom;

        graph.view.setTranslate(Math.round(-bounds.x + margin), Math.round(-bounds.y + margin));
        graph.view.setScale(scale);
        graph.sizeDidChange();

        container.style.width = Math.ceil(rawW * scale) + 'px';
        container.style.height = Math.ceil(rawH * scale) + 'px';

        // 给内部 svg 加上响应式约束（不影响导出转 PNG）
        const svg = container.querySelector('svg');
        if (svg) {
          svg.style.maxWidth = '100%';
          svg.style.height = 'auto';
          svg.style.display = 'block';
        }

        // 绑定缩放控件
        node.__drawio = {
          graph,
          container,
          frame,
          margin,
          bounds,
          rawW,
          rawH,
          baseScale,
          maxWidth
        };

        const toolbar = node.querySelector('.drawio-toolbar');
        if (toolbar && !toolbar.__drawioBound) {
          toolbar.__drawioBound = true;
          toolbar.addEventListener('click', (ev) => {
            const btn = ev.target?.closest?.('button[data-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            handleDrawioToolbarAction(node, action);
          });
        }

        const copyBtn = node.querySelector('.drawio-copy-btn');
        if (copyBtn && !copyBtn.__drawioBound) {
          copyBtn.__drawioBound = true;
          copyBtn.addEventListener('click', async () => {
            await copyDrawioXmlToClipboard(node, copyBtn);
          });
        }
      } catch (e) {
        console.error('draw.io post-layout error:', e);
        const error = document.createElement('p');
        error.className = 'drawio-error';
        error.textContent = String(e.message || e);
        capture.replaceChildren(error);
      } finally {
        node.setAttribute('data-drawio-rendered', node.querySelector('.drawio-error') ? 'error' : '1');
      }
    });
  });
}

async function copyDrawioXmlToClipboard(node, buttonEl) {
  const xml = node?.querySelector?.('.drawio-source')?.textContent || '';
  if (!xml.trim()) return;

  const setBtnText = (text) => {
    if (!buttonEl) return;
    const original = buttonEl.getAttribute('data-original-text') || buttonEl.textContent || '复制';
    buttonEl.setAttribute('data-original-text', original);
    buttonEl.textContent = text;
    clearTimeout(buttonEl.__resetTimer);
    buttonEl.__resetTimer = setTimeout(() => {
      buttonEl.textContent = original;
    }, 900);
  };

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(xml);
      setBtnText('已复制');
      return;
    }
  } catch {
    // fallback below
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = xml;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-10000px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) setBtnText('已复制');
    else setBtnText('复制失败');
  } catch {
    setBtnText('复制失败');
  }
}

function relayoutDrawio(node) {
  const info = node && node.__drawio;
  if (!info?.graph) return;

  const { graph, bounds, rawW, rawH, margin } = info;
  const frame = info.frame;
  const maxWidth = Math.max(320, Math.min(1000, frame?.clientWidth || info.maxWidth || 840));
  const baseScale = rawW > maxWidth ? (maxWidth / rawW) : 1;
  info.baseScale = baseScale;
  info.maxWidth = maxWidth;

  const zoom = Number(node.getAttribute('data-drawio-zoom') || '1') || 1;
  const scale = baseScale * zoom;

  graph.view.setTranslate(Math.round(-bounds.x + margin), Math.round(-bounds.y + margin));
  graph.view.setScale(scale);
  graph.sizeDidChange();

  if (info.container) {
    info.container.style.width = Math.ceil(rawW * scale) + 'px';
    info.container.style.height = Math.ceil(rawH * scale) + 'px';
  }
}

function handleDrawioToolbarAction(node, action) {
  if (!node) return;
  const current = Number(node.getAttribute('data-drawio-zoom') || '1') || 1;
  let next = current;

  switch (action) {
    case 'zoom-in':
      next = Math.min(4, Math.round((current + 0.25) * 100) / 100);
      break;
    case 'zoom-out':
      next = Math.max(0.25, Math.round((current - 0.25) * 100) / 100);
      break;
    case 'zoom-reset':
      next = 1;
      break;
    case 'zoom-fit':
      // fit 表现为：把 zoom 设为 1（baseScale 已按宽度 fit 过）
      next = 1;
      break;
    default:
      return;
  }

  node.setAttribute('data-drawio-zoom', String(next));
  relayoutDrawio(node);
}

async function waitForDrawioRendered(root, { timeoutMs = 20000 } = {}) {
  if (!root) return;

  // 触发一次渲染尝试（如果还没开始）
  renderDrawioDiagrams(root).catch(error => console.error('draw.io render error:', error));

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (root.querySelector('.drawio-error')) throw new Error('draw.io 图表渲染失败，请先修正后导出。');
    const pending = Array.from(root.querySelectorAll('.drawio-diagram'))
      .some(el => el.getAttribute('data-drawio-rendered') !== '1');
    if (!pending) return;
    await new Promise(r => requestAnimationFrame(() => r()));
  }
  throw new Error('draw.io 图表仍在加载，请稍后再导出。');
}

// 监听编辑器变化
editor.on("change", () => {
  clearTimeout(timer);
  timer = setTimeout(render, 300);
});

// 初始化 Mermaid
mermaid.initialize({
  startOnLoad: false, theme: 'default', securityLevel: 'strict',
  htmlLabels: false, flowchart: { htmlLabels: false }, maxTextSize: 100000, maxEdges: 500,
  secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges',
    'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily', 'htmlLabels', 'flowchart', 'dompurifyConfig'],
});
render();

// 清空编辑器功能 - 使用自定义弹窗定位在按钮上方
function clearEditor(event) {
  if (document.getElementById('btn-export-word').disabled) return;
  // 如果已经有弹窗，不再重复创建
  if (document.querySelector('.inline-confirm')) return;

  // 获取点击的按钮元素（确保获取到 button，而不是内部的 SVG）
  const button = event?.currentTarget?.closest?.('button') || event?.currentTarget || event?.target?.closest?.('button') || event?.target;
  if (!button) {
    console.error('No button found');
    return;
  }

  const btnRect = button.getBoundingClientRect();
  const buttonGap = 8;
  const buttonRadius = parseFloat(getComputedStyle(button).borderRadius) || 10;
  const buttonRowWidth = btnRect.width * 2 + buttonGap;
  console.log('Button rect:', { left: btnRect.left, top: btnRect.top, width: btnRect.width, height: btnRect.height });

  // 创建弹窗
  const popup = document.createElement('div');
  popup.className = 'inline-confirm';
  popup.style.width = `${buttonRowWidth + 20}px`;
  popup.style.minWidth = `${buttonRowWidth + 20}px`;
  popup.style.borderRadius = `${buttonRadius + 2}px`;
  popup.innerHTML = `
    <div class="confirm-text">确定要清空编辑器内容吗?</div>
    <div class="confirm-buttons">
      <button class="confirm-btn-no">取消</button>
      <button class="confirm-btn-yes">确定</button>
    </div>
  `;

  // 先添加到 DOM 才能获取尺寸
  popup.style.visibility = 'hidden';
  document.body.appendChild(popup);

  const rect = popup.getBoundingClientRect();
  const popupWidth = rect.width;
  const popupHeight = rect.height;
  console.log('Popup size:', { width: popupWidth, height: popupHeight });

  // 计算位置：弹窗位置调整，使确认按钮覆盖原按钮
  let left = btnRect.left - btnRect.width - buttonGap - 10;
  let top = btnRect.top - 45;
  console.log('Calculated position (before bounds check):', { left, top });

  // 边界检查：确保不超出视口
  if (left < 8) left = 8;
  if (left + popupWidth > window.innerWidth - 8) {
    left = window.innerWidth - popupWidth - 8;
  }
  // 如果上方空间不够，显示在按钮下方
  if (top < -20) {
    console.log('Not enough space above, showing below button');
    top = btnRect.bottom + 8;
  }

  console.log('Final position:', { left, top });
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.style.visibility = 'visible';

  // 点击外部关闭
  const closeOnOutside = (e) => {
    if (!popup.contains(e.target)) {
      cleanup();
    }
  };

  // 清理函数
  const cleanup = () => {
    document.removeEventListener('click', closeOnOutside);
    popup.remove();
  };

  // 绑定按钮事件
  popup.querySelector('.confirm-btn-yes').addEventListener('click', () => {
    editor.setValue('');
    cleanup();
  });

  popup.querySelector('.confirm-btn-no').addEventListener('click', () => {
    cleanup();
  });

  // 延迟绑定外部点击监听，避免立即触发
  setTimeout(() => {
    document.addEventListener('click', closeOnOutside);
  }, 10);
}

function formatDateForFilename(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

function sanitizeFilename(name) {
  const raw = String(name || '').trim();
  const cleaned = raw
    // macOS/Windows 不允许的字符
    .replace(/[\\/:*?"<>|]/g, '-')
    // 控制字符
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || `markdown_${formatDateForFilename()}`;
}

function ensureMdExtension(name) {
  const base = String(name || '').trim();
  if (!base) return `markdown_${formatDateForFilename()}.md`;
  return /\.md$/i.test(base) ? base : `${base}.md`;
}

function saveMarkdown() {
  try {
    const filename = 'markdown.md';
    const content = editor?.getValue?.() ?? '';

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });

    if (typeof window.saveAs === 'function') {
      window.saveAs(blob, filename);
      return;
    }

    // fallback：不依赖 FileSaver
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('保存失败：' + (e?.message || e));
  }
}

// 切换预览模式
function toggleWideMode() {
  const isWide = document.body.classList.toggle('wide-mode');

  // 获取顶部按钮并更新文字
  const headerBtn = document.getElementById('header-preview-btn');
  if (headerBtn) {
    headerBtn.innerText = isWide ? "❌ 退出预览" : "👁 预览模式";
  }

  const refreshEditorLayout = () => {
    editor.refresh();
    const cursor = editor.getCursor();
    editor.setCursor(cursor);
    editor.scrollIntoView(cursor, 80);
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      refreshEditorLayout();
      outline.refreshLayout();
    });
  });

  if (!isWide) {
    setTimeout(refreshEditorLayout, 180);
  }
  setTimeout(() => outline.refreshLayout(), 320);
}

// SVG 样式内联处理
function inlineStyles(sourceNode, targetNode) {
  const computedStyle = window.getComputedStyle(sourceNode);
  if (computedStyle) {
    let styleStr = "";
    const keys = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'color', 'background-color'];
    keys.forEach(key => {
      styleStr += `${key}:${computedStyle.getPropertyValue(key)};`;
    });
    targetNode.setAttribute('style', styleStr);
  }
  for (let i = 0; i < sourceNode.children.length; i++) {
    if (i < targetNode.children.length) {
      inlineStyles(sourceNode.children[i], targetNode.children[i]);
    }
  }
}

// SVG 转 PNG
function svgToPng(svgElement) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result) => { if (!finished) { finished = true; clearTimeout(timeout); resolve(result); } };
    const timeout = setTimeout(() => {
      finish(null);
    }, 10000);

    try {
      const rect = svgElement.getBoundingClientRect();
      const width = rect.width || 500;
      const height = rect.height || 300;
      if (!Number.isFinite(width * height) || width <= 0 || height <= 0 || width > 8192 || height > 8192 || width * height * 4 > 20000000) {
        finish(null); return;
      }

      const clone = svgElement.cloneNode(true);
      inlineStyles(svgElement, clone);

      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', width);
      clone.setAttribute('height', height);

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);

      const base64Svg = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));

      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const img = new Image();
      img.onload = () => {
        if (finished) return;
        try {
          ctx.drawImage(img, 0, 0, width, height);
          finish({ data: canvas.toDataURL('image/png'), width, height });
        } catch { finish(null); }
      };

      img.onerror = () => finish(null);

      img.src = base64Svg;

    } catch (e) {
      console.error("SVG conversion error", e);
      finish(null);
    }
  });
}

let __mathJaxPromise;

function ensureMathJaxLoaded() {
  if (__mathJaxPromise) return __mathJaxPromise;
  window.MathJax = window.MathJax || {
    tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']] },
    svg: { fontCache: 'none' },
  };
  __mathJaxPromise = ensureScriptLoaded(
    'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js',
    () => typeof window.MathJax?.tex2svg === 'function',
    '公式导出库加载失败，请检查网络后重试。'
  ).catch((error) => { __mathJaxPromise = null; throw error; });
  return __mathJaxPromise;
}

function extractTexFromKatexElement(katexEl) {
  if (!katexEl) return '';
  // KaTeX 默认输出包含 MathML：annotation(encoding="application/x-tex") 存着原始 TeX
  const ann = katexEl.querySelector('annotation[encoding="application/x-tex"]');
  if (ann && ann.textContent) return ann.textContent.trim();
  // 兜底：尝试从可见 HTML 文本取（可能不完整）
  return (katexEl.textContent || '').trim();
}

async function texToPngViaMathJax(tex, { display, sandbox }) {
  if (!tex) return null;
  await ensureMathJaxLoaded();
  if (!window.MathJax?.tex2svg) return null;

  const wrapper = window.MathJax.tex2svg(tex, { display: !!display });
  const svg = wrapper?.querySelector?.('svg');
  if (!svg) return null;

  // 放到 sandbox 里让尺寸可测
  const host = document.createElement('div');
  host.style.display = 'inline-block';
  host.style.padding = '0';
  host.style.margin = '0';
  host.appendChild(svg);
  (sandbox || document.body).appendChild(host);

  try {
    // 等一帧让布局稳定
    await new Promise(r => requestAnimationFrame(() => r()));
    return await svgToPng(svg);
  } finally {
    host.remove();
  }
}

// 导出 Word 文档
async function exportWord() {
  const btn = document.getElementById('btn-export-word');
  if (btn.disabled || imageCdn.isRunning()) return;
  const originalText = btn.innerText;
  const source = editor.getValue();
  const previousReadOnly = editor.getOption('readOnly');
  const uploadButton = document.getElementById('btn-upload-cdn');
  const previousUploadDisabled = uploadButton.disabled;
  const configureButton = document.getElementById('image-cdn-start');
  let sandbox;
  const check = () => {
    if (editor.getValue() !== source) throw new Error('导出期间文档已变化，已取消，请重新导出。');
  };
  btn.disabled = true;
  uploadButton.disabled = true;
  if (configureButton) configureButton.disabled = true;
  editor.setOption('readOnly', true);
  try {
    clearTimeout(timer);
    render();
    if (document.getElementById('preview').dataset.renderError) throw new Error('文档未能正常预览，不能导出。');
    await ensureExportLibsLoaded();
    check();
    const previewEl = document.getElementById('preview');
    // 防止 draw.io 图尚未渲染就导出导致丢图
    btn.innerText = '等待图表渲染...';
    await diagrams.waitForReady(previewEl);
    let mermaidTimeout;
    try {
      await Promise.race([mermaidJob, new Promise((_, reject) => {
        mermaidTimeout = setTimeout(() => reject(new Error('Mermaid 尚未渲染完成。')), 20000);
      })]);
    } finally { clearTimeout(mermaidTimeout); }
    if (previewEl.querySelector('.mermaid[data-mermaid-state="error"], .mermaid[data-mermaid-state="loading"]')) throw new Error('Mermaid 图表未成功渲染。');
    await waitForDrawioRendered(previewEl);
    check();
    if (previewEl.querySelector('.drawio-error')) throw new Error('draw.io 图表未成功渲染，请先修正再导出。');

    const mermaidSvgs = Array.from(previewEl.querySelectorAll('.mermaid svg, .md-diagram-capture > svg, .md-diagram-capture > div > svg'));
    const drawioEls = Array.from(previewEl.querySelectorAll('.drawio-diagram'));
    const mermaidReplacements = [];
    const drawioReplacements = [];

    const totalImages = mermaidSvgs.length + drawioEls.length;
    let doneImages = 0;

    for (let i = 0; i < mermaidSvgs.length; i++) {
      doneImages++;
      btn.innerText = `处理图片 ${doneImages}/${totalImages}...`;
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

      const pngData = await svgToPng(mermaidSvgs[i]);
      if (pngData) {
        mermaidReplacements.push({ index: i, ...pngData });
      } else {
        throw new Error('图表转为 Word 图片失败，请检查图表后重试。');
      }
    }

    for (let i = 0; i < drawioEls.length; i++) {
      doneImages++;
      btn.innerText = `处理图片 ${doneImages}/${totalImages}...`;
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));

      // draw.io 同时包含 SVG（线框）+ HTML label（div）。
      // foreignObject 方案可能出现“只截到文字，不截到 SVG”的情况，因此优先用 html2canvas。
      // 截图目标：.drawio-canvas（尺寸由 relayoutDrawio 设置，紧凑且无滚动条）
      const target = drawioEls[i].querySelector('.drawio-canvas')
        || drawioEls[i].querySelector('.drawio-frame')
        || drawioEls[i].querySelector('.drawio-capture')
        || drawioEls[i];

      let pngData = await domToPngViaHtml2Canvas(target, { scale: 2 });

      if (!pngData) {
        // fallback：至少把 SVG 主体导出
        const svg = target.querySelector?.('svg') || drawioEls[i].querySelector?.('svg');
        pngData = svg ? await svgToPng(svg) : null;
      }

      if (!pngData) {
        // 最后兜底：旧方案
        pngData = await htmlElementToPng(target, { scale: 2, timeoutMs: 2500 });
      }

      if (pngData) {
        drawioReplacements.push({ index: i, ...pngData });
      } else {
        throw new Error('draw.io 转为 Word 图片失败，请检查图表后重试。');
      }
    }

    btn.innerText = "生成文档...";
    await new Promise(r => setTimeout(r, 50));

    check();
    const contentClone = previewEl.cloneNode(true);

    const cloneMermaidSvgs = contentClone.querySelectorAll('.mermaid svg, .md-diagram-capture > svg, .md-diagram-capture > div > svg');
    mermaidReplacements.forEach(item => {
      if (cloneMermaidSvgs[item.index]) {
        const img = document.createElement('img');
        img.src = item.data;
        img.width = item.width;
        img.setAttribute('data-docx-block-image', '1');
        if (item.height) img.height = item.height;
        const diagram = cloneMermaidSvgs[item.index].closest('.md-diagram');
        if (diagram) diagram.replaceWith(img);
        else cloneMermaidSvgs[item.index].parentNode.replaceChild(img, cloneMermaidSvgs[item.index]);
      }
    });

    const cloneDrawioEls = contentClone.querySelectorAll('.drawio-diagram');
    drawioReplacements.forEach(item => {
      if (cloneDrawioEls[item.index]) {
        const img = document.createElement('img');
        img.src = item.data;
        img.setAttribute('width', String(item.width));
        if (item.height) img.setAttribute('height', String(item.height));
        img.setAttribute('data-docx-block-image', '1');
        cloneDrawioEls[item.index].replaceWith(img);
      }
    });

    contentClone.querySelectorAll('.md-diagram-source, .md-diagram-status[hidden]').forEach(el => el.remove());
    contentClone.querySelectorAll('svg').forEach(el => el.remove());

    // KaTeX：导出到 Word 时将公式转为图片，避免变成源码文本
    sandbox = document.createElement('div');
    sandbox.dataset.exportSandbox = '1';
    sandbox.style.position = 'fixed';
    sandbox.style.left = '-10000px';
    sandbox.style.top = '0';
    sandbox.style.width = '900px';
    sandbox.style.opacity = '0';
    sandbox.style.pointerEvents = 'none';
    sandbox.style.background = '#ffffff';
    document.body.appendChild(sandbox);
    sandbox.appendChild(contentClone);

    try {
      const displayEls = Array.from(contentClone.querySelectorAll('.katex-display'));
      const inlineEls = Array.from(contentClone.querySelectorAll('.katex')).filter(el => !el.closest('.katex-display'));
      const total = displayEls.length + inlineEls.length;
      let done = 0;

      // Display math
      for (const el of displayEls) {
        done++;
        btn.innerText = `处理公式 ${done}/${total}...`;
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 10)));
        const tex = extractTexFromKatexElement(el);
        const png = await texToPngViaMathJax(tex, { display: true, sandbox }) || await htmlElementToPng(el);
        if (!png) throw new Error('公式转图片失败，已停止导出以免丢失内容。');
        const img = document.createElement('img');
        img.setAttribute('src', png.data);
        img.setAttribute('width', String(png.width));
        img.setAttribute('height', String(png.height));
        img.setAttribute('data-math', '1');
        el.replaceWith(img);
      }

      // Inline math
      for (const el of inlineEls) {
        done++;
        btn.innerText = `处理公式 ${done}/${total}...`;
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 10)));
        const tex = extractTexFromKatexElement(el);
        const png = await texToPngViaMathJax(tex, { display: false, sandbox }) || await htmlElementToPng(el);
        if (!png) throw new Error('公式转图片失败，已停止导出以免丢失内容。');
        const img = document.createElement('img');
        img.setAttribute('src', png.data);
        img.setAttribute('width', String(png.width));
        img.setAttribute('height', String(png.height));
        img.setAttribute('data-math', '1');
        img.setAttribute('data-inline', '1');
        el.replaceWith(img);
      }
    } finally {
      // sandbox 会在 blocks 生成完后统一移除
    }

    if (!window.docx) {
      throw new Error('docx 库未加载（请检查网络/CDN）。');
    }

    btn.innerText = '转换内容...';
    await new Promise(r => setTimeout(r, 30));

    await prepareExportImages(contentClone);
    check();
    const blocks = await htmlElementToDocxBlocks(contentClone);
    check();

    if (sandbox && sandbox.parentNode) {
      sandbox.parentNode.removeChild(sandbox);
    }
    if (!blocks.length) {
      blocks.push(new window.docx.Paragraph({ text: '' }));
    }

    btn.innerText = '打包文档...';
    await new Promise(r => setTimeout(r, 30));

    const doc = new window.docx.Document({
      sections: [{
        properties: {},
        children: blocks,
      }],
    });

    const blob = await window.docx.Packer.toBlob(doc);
    check();
    saveAs(blob, 'markdown_export.docx');

  } catch (e) {
    alert("导出出错: " + e.message);
  } finally {
    sandbox?.remove();
    __imageSizeCache.clear();
    editor.setOption('readOnly', previousReadOnly);
    uploadButton.disabled = previousUploadDisabled;
    if (configureButton) configureButton.disabled = false;
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

function isElement(node) {
  return node && node.nodeType === Node.ELEMENT_NODE;
}

async function prepareExportImages(root) {
  const images = [...root.querySelectorAll('img')];
  if (images.length > 100) throw new Error('图片超过 100 张，请拆分后导出。');
  const loaded = new Map();
  const verified = new Set();
  let totalBytes = 0;
  for (const image of images) {
    const src = image.getAttribute('src') || '';
    let data = src;
    if (!/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(src)) {
      if (!/^https?:\/\//i.test(src)) throw new Error('存在无法嵌入的本地或不支持图片，请先改为可访问的网络图片。');
      if (!loaded.has(src)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(src, { signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok || !/^image\/(?:png|jpe?g|gif|webp)(?:;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('unavailable');
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('too large'); }
          chunks.push(value);
        }
        const downloaded = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('image read failed'));
          reader.readAsDataURL(new Blob(chunks, { type: response.headers.get('content-type').split(';')[0] }));
        });
        loaded.set(src, downloaded);
      } catch { throw new Error('网络图片读取失败、跨域不许可或超过 5 MiB；已停止导出，避免生成缺图文档。'); }
      finally { clearTimeout(timer); }
      }
      data = loaded.get(src);
    }
    if (!verified.has(data)) {
      const match = /^data:image\/(?:png|jpe?g|gif|webp);base64,([a-z0-9+/]+={0,2})$/i.exec(data);
      if (!match || match[1].length % 4 || match[1].length > Math.ceil(5 * 1024 * 1024 / 3) * 4) {
        throw new Error('图片数据无效或超过 5 MiB，已停止导出。');
      }
      totalBytes += match[1].length * 3 / 4;
      if (totalBytes > 50 * 1024 * 1024) throw new Error('图片总量超过 50 MiB，请拆分后导出。');
      const size = await getImageSizeFromDataUrl(data);
      if (!size?.width || !size?.height || size.width > 16384 || size.height > 16384 || size.width * size.height > 20000000) {
        throw new Error('图片无法解码或像素尺寸过大，已停止导出。');
      }
      verified.add(data);
    }
    image.src = data;
    image.removeAttribute('srcset');
  }
}

function dataUrlToUint8Array(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) return null;
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const __imageSizeCache = new Map();

function getImageSizeFromDataUrl(dataUrl) {
  if (!dataUrl) return Promise.resolve(null);
  if (__imageSizeCache.has(dataUrl)) return __imageSizeCache.get(dataUrl);

  const p = new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 5000);
    img.onload = () => { clearTimeout(timer); resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height }); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = dataUrl;
  });

  if (__imageSizeCache.size >= 100) __imageSizeCache.delete(__imageSizeCache.keys().next().value);
  __imageSizeCache.set(dataUrl, p);
  return p;
}

function guessImageType(dataUrl) {
  const match = /^data:([^;]+);base64,/.exec(dataUrl || '');
  if (!match) return undefined;
  const mime = match[1].toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpeg';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  return undefined;
}

function inlineAllComputedStyles(sourceEl, targetEl) {
  if (!sourceEl || !targetEl) return;
  if (sourceEl.nodeType !== Node.ELEMENT_NODE || targetEl.nodeType !== Node.ELEMENT_NODE) return;

  const style = window.getComputedStyle(sourceEl);
  if (style) {
    let cssText = '';
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      cssText += `${prop}:${style.getPropertyValue(prop)};`;
    }
    targetEl.setAttribute('style', cssText);
  }

  const srcChildren = Array.from(sourceEl.children || []);
  const dstChildren = Array.from(targetEl.children || []);
  for (let i = 0; i < srcChildren.length && i < dstChildren.length; i++) {
    inlineAllComputedStyles(srcChildren[i], dstChildren[i]);
  }
}

function htmlElementToPng(el, options = {}) {
  const scale = Number.isFinite(options.scale) ? options.scale : 2;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 1200;

  return new Promise((resolve) => {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return resolve(null);

    let finished = false;
    const finish = (result) => { if (!finished) { finished = true; clearTimeout(timeout); resolve(result); } };
    const timeout = setTimeout(() => finish(null), timeoutMs);

    try {
      const rect = el.getBoundingClientRect();
      const width = Math.max(1, Math.ceil(rect.width || 1));
      const height = Math.max(1, Math.ceil(rect.height || 1));
      if (!Number.isFinite(width * height * scale) || scale <= 0 || width * scale > 16384 || height * scale > 16384 || width * height * scale * scale > 20000000) {
        finish(null); return;
      }

      const clone = el.cloneNode(true);
      inlineAllComputedStyles(el, clone);

      const foreign = document.createElement('div');
      foreign.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      foreign.appendChild(clone);
      const serialized = foreign.outerHTML;

      const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
        `<foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject>` +
        `</svg>`;

      const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const img = new Image();
      img.onload = () => {
        if (finished) return;
        try {
        const canvas = document.createElement('canvas');
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        finish({ data: canvas.toDataURL('image/png'), width, height });
        } catch { finish(null); }
      };
      img.onerror = () => finish(null);
      img.src = svgUrl;
    } catch (e) {
      console.error('HTML->PNG conversion error', e);
      finish(null);
    }
  });
}

async function domToPngViaHtml2Canvas(el, options = {}) {
  const scale = Number.isFinite(options.scale) ? options.scale : 2;
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
  if (typeof window.html2canvas !== 'function') return null;

  try {
    const canvas = await window.html2canvas(el, {
      backgroundColor: '#ffffff',
      scale,
      useCORS: true,
      logging: false,
      removeContainer: true,
      scrollX: 0,
      scrollY: 0,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
    });

    const rect = el.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(rect.width || canvas.width / scale || 1));
    const height = Math.max(1, Math.ceil(rect.height || canvas.height / scale || 1));
    return { data: canvas.toDataURL('image/png'), width, height };
  } catch (e) {
    console.error('html2canvas capture error:', e);
    return null;
  }
}

function splitTextToRuns(text, options = {}) {
  const { TextRun } = window.docx;
  const normalized = (text ?? '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const runs = [];
  lines.forEach((line, idx) => {
    runs.push(new TextRun({ text: line, ...options }));
    if (idx < lines.length - 1) {
      runs.push(new TextRun({ break: 1 }));
    }
  });
  return runs;
}

async function inlineNodeToDocxRunsAsync(node, inherited = {}) {
  const { TextRun, ImageRun } = window.docx;
  if (!node) return [];

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return splitTextToRuns(text, inherited);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];

  const tag = (node.tagName || '').toUpperCase();
  if (tag === 'BR') return [new TextRun({ break: 1 })];
  if (tag === 'INPUT' && node.type === 'checkbox') return [new TextRun({ text: node.checked ? '☑ ' : '☐ ' })];
  if (tag === 'A' && /^(?:https?:|mailto:)/i.test(node.getAttribute('href') || '') && window.docx.ExternalHyperlink) {
    return [new window.docx.ExternalHyperlink({ link: node.getAttribute('href'), children: await inlineContainerToDocxRunsAsync(node, inherited) })];
  }

  // KaTeX 的 MathML/annotation 里会带原始 TeX，必须跳过，否则会在 Word 里出现 \times 等源码
  if (tag === 'MATH' || tag === 'SEMANTICS' || tag === 'ANNOTATION') return [];

  if (tag === 'IMG') {
    const src = node.getAttribute('src') || '';
    const bytes = dataUrlToUint8Array(src);
    if (!bytes) throw new Error('图片未能嵌入 Word，已停止导出。');

    const natural = await getImageSizeFromDataUrl(src);
    const widthAttr = parseInt(node.getAttribute('width') || '', 10);
    const heightAttr = parseInt(node.getAttribute('height') || '', 10);
    const naturalWidth = natural?.width || (Number.isFinite(widthAttr) ? widthAttr : 120);
    const naturalHeight = natural?.height || (Number.isFinite(heightAttr) ? heightAttr : 24);

    // Inline: constrain height for baseline alignment
    const isMath = node.getAttribute('data-math') === '1';
    const MAX_H = isMath ? 28 : 22;
    const ratio = naturalHeight > 0 ? (naturalWidth / naturalHeight) : 5;
    const targetHeight = Math.max(12, Math.min(MAX_H, naturalHeight));
    const targetWidth = Math.max(16, Math.round(targetHeight * ratio));

    const imageType = guessImageType(src);
    return [new ImageRun({ data: bytes, transformation: { width: targetWidth, height: targetHeight }, type: imageType })];
  }

  const next = { ...inherited };
  if (tag === 'STRONG' || tag === 'B') next.bold = true;
  if (tag === 'EM' || tag === 'I') next.italics = true;
  if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') next.strike = true;
  if (tag === 'SUB') next.subScript = true;
  if (tag === 'SUP') next.superScript = true;
  if (tag === 'MARK') next.highlight = 'yellow';
  if (tag === 'INS' || tag === 'U') next.underline = {};
  if (tag === 'CODE') next.font = next.font || 'Courier New';

  const runs = [];
  const children = Array.from(node.childNodes || []);
  for (const child of children) {
    runs.push(...await inlineNodeToDocxRunsAsync(child, next));
  }
  return runs;
}

async function inlineContainerToDocxRunsAsync(container, inherited = {}) {
  const { TextRun } = window.docx;
  if (!container) return [new TextRun({ text: '' })];
  const runs = [];
  const children = Array.from(container.childNodes || []);
  for (const child of children) {
    runs.push(...await inlineNodeToDocxRunsAsync(child, inherited));
  }
  if (!runs.length) runs.push(new TextRun({ text: '' }));
  return runs;
}

function headingLevelForTag(tagName) {
  const { HeadingLevel } = window.docx;
  switch ((tagName || '').toUpperCase()) {
    case 'H1': return HeadingLevel.HEADING_1;
    case 'H2': return HeadingLevel.HEADING_2;
    case 'H3': return HeadingLevel.HEADING_3;
    case 'H4': return HeadingLevel.HEADING_4;
    case 'H5': return HeadingLevel.HEADING_5;
    case 'H6': return HeadingLevel.HEADING_6;
    default: return undefined;
  }
}

async function htmlElementToDocxBlocks(rootEl) {
  const { Paragraph, Table, TableRow, TableCell, WidthType, ImageRun, AlignmentType, BorderStyle, TableLayoutType, TextRun } = window.docx;
  const blocks = [];

  const walkChildren = async (container, listContext = null) => {
    const children = Array.from(container.childNodes || []);
    for (const node of children) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) {
          blocks.push(new Paragraph({
            alignment: AlignmentType.LEFT,
            children: [new window.docx.TextRun({ text })],
            spacing: { after: 120 },
          }));
        }
        continue;
      }

      if (!isElement(node)) continue;

      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') {
        blocks.push(new Paragraph({ text: '' }));
        continue;
      }

      if (/^H[1-6]$/.test(tag)) {
        const heading = headingLevelForTag(tag);
        blocks.push(new Paragraph({
          children: await inlineContainerToDocxRunsAsync(node),
          heading,
          alignment: AlignmentType.LEFT,
          spacing: { after: 180 },
        }));
        continue;
      }

      if (tag === 'P' || tag === 'DIV') {
        // 这里必须按“行内节点”生成 runs，否则会丢失 strong/em 等格式
        const hasBlockChildren = Array.from(node.children || []).some(el => {
          const t = (el.tagName || '').toUpperCase();
          if (t === 'IMG') {
            // 允许行内公式图片不强制拆成块级
            return el.getAttribute('data-inline') !== '1';
          }
          return ['DIV', 'FIGURE', 'ASIDE', 'DETAILS', 'TABLE', 'PRE', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(t);
        });

        if (!hasBlockChildren) {
          blocks.push(new Paragraph({
            alignment: AlignmentType.LEFT,
            children: await inlineContainerToDocxRunsAsync(node),
            spacing: { after: 120 },
          }));
        } else {
          // 可能包含图片/表格等块级元素
          await walkChildren(node, listContext);
        }
        continue;
      }

      if (tag === 'PRE') {
        const code = (node.innerText || node.textContent || '').replace(/^\n+|\n+$/g, '');
        if (code) {
          blocks.push(new Paragraph({
            alignment: AlignmentType.LEFT,
            children: splitTextToRuns(code, { font: 'Courier New' }),
            spacing: { after: 180 },
          }));
        }
        continue;
      }

      if (tag === 'UL' || tag === 'OL') {
        const isOrdered = tag === 'OL';
        const items = Array.from(node.children).filter(c => isElement(c) && c.tagName.toUpperCase() === 'LI');
        let idx = parseInt(node.getAttribute('start') || '1', 10);
        const depth = listContext?.depth || 0;
        for (const li of items) {
          const hasAnyText = (li.innerText || li.textContent || '').trim();
          if (!hasAnyText) continue;

          let first = true;
          const own = document.createElement('div');
          const flush = async (force = false) => {
            if (!force && !own.textContent.trim() && !own.querySelector('img,input')) { own.replaceChildren(); return; }
            const prefixRuns = first && isOrdered ? [new TextRun({ text: `${idx++}. ` })] : [];
            blocks.push(new Paragraph({
              children: [...prefixRuns, ...await inlineContainerToDocxRunsAsync(own)],
              bullet: !isOrdered && first ? { level: Math.min(8, depth) } : undefined,
              indent: (!first || (isOrdered && depth)) ? { left: (depth + (first ? 0 : 1)) * 360 } : undefined,
              alignment: AlignmentType.LEFT, spacing: { after: 60 },
            }));
            first = false;
            own.replaceChildren();
          };
          for (const child of li.childNodes) {
            if (isElement(child) && ['UL', 'OL'].includes(child.tagName)) {
              await flush(first);
              const holder = document.createElement('div'); holder.append(child.cloneNode(true));
              await walkChildren(holder, { depth: depth + 1 });
            } else if (isElement(child) && child.tagName === 'P') {
              await flush();
              own.append(child.cloneNode(true));
              await flush();
            } else own.append(child.cloneNode(true));
          }
          await flush(first);
        }
        continue;
      }

      if (tag === 'IMG') {
        const src = node.getAttribute('src') || '';
        const bytes = dataUrlToUint8Array(src);
        if (bytes) {
          const natural = await getImageSizeFromDataUrl(src);
          const widthAttr = parseInt(node.getAttribute('width') || '', 10);
          const heightAttr = parseInt(node.getAttribute('height') || '', 10);

          const naturalWidth = natural?.width || (Number.isFinite(widthAttr) ? widthAttr : 800);
          const naturalHeight = natural?.height || (Number.isFinite(heightAttr) ? heightAttr : 450);

          // 约等于文档可用宽度（考虑左右页边距）。
          const MAX_WIDTH = 620;
          const isMath = node.getAttribute('data-math') === '1';
          const isBlockImage = node.getAttribute('data-docx-block-image') === '1';
          const MIN_WIDTH = isMath ? 1 : (isBlockImage ? 1 : 120);
          let targetWidth = Number.isFinite(widthAttr) ? widthAttr : naturalWidth;
          targetWidth = Math.min(Math.max(targetWidth, MIN_WIDTH), MAX_WIDTH);

          const ratio = naturalWidth > 0 ? (naturalHeight / naturalWidth) : 0.6;
          const targetHeight = Math.max(60, Math.round(targetWidth * ratio));
          const imageType = guessImageType(src);

          blocks.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: bytes,
                transformation: { width: targetWidth, height: targetHeight },
                type: imageType,
              }),
            ],
            spacing: { after: 180 },
          }));
        }
        continue;
      }

      if (tag === 'TABLE') {
        // iOS Pages 对百分比宽度/自动布局兼容较差，容易把列挤到极窄导致中文逐字换行。
        // 这里改用固定表格布局 + 固定列宽（DXA/twips）。
        // Letter(8.5in) 宽 12240 twips；左右各 1in 边距(1440*2)后可用宽约 9360。
        const TABLE_WIDTH_DXA = 9360;
        const rows = [];
        const trEls = Array.from(node.querySelectorAll('tr'));

        const firstRowCells = trEls.length
          ? Array.from(trEls[0].children).filter(c => ['TD', 'TH'].includes(c.tagName.toUpperCase()))
          : [];
        const tableColCount = Math.max(firstRowCells.length, 1);
        const tableColWidth = Math.floor(TABLE_WIDTH_DXA / tableColCount);
        const columnWidths = new Array(tableColCount).fill(tableColWidth);

        for (const tr of trEls) {
          const cellEls = Array.from(tr.children).filter(c => ['TD', 'TH'].includes(c.tagName.toUpperCase()));
          const normalizedCells = [];

          for (let i = 0; i < tableColCount; i++) {
            const cellEl = cellEls[i];
            const isHeader = cellEl ? (cellEl.tagName.toUpperCase() === 'TH') : false;
            const cellRuns = cellEl
              ? await inlineContainerToDocxRunsAsync(cellEl, isHeader ? { bold: true } : {})
              : [new TextRun({ text: '' })];

            normalizedCells.push(new TableCell({
              width: { size: columnWidths[i], type: WidthType.DXA },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
                left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
                right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
              },
              children: [
                new Paragraph({
                  alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
                  children: cellRuns,
                  spacing: { after: 60 },
                }),
              ],
            }));
          }

          const cells = normalizedCells;
          if (cells.length) rows.push(new TableRow({ children: cells }));
        }

        if (rows.length) {
          blocks.push(new Table({
            // 多数渲染器（Pages/WPS）对表格整体宽度更偏好百分比；列宽用 tblGrid 明确指定。
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            columnWidths,
            rows,
          }));
          blocks.push(new Paragraph({ text: '' }));
        }
        continue;
      }

      // 兜底：继续向下找
      await walkChildren(node, listContext);
    }
  };

  await walkChildren(rootEl);
  return blocks;
}
