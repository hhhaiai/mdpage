import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import * as emoji from 'markdown-it-emoji';
import container from 'markdown-it-container';
import deflist from 'markdown-it-deflist';
import abbr from 'markdown-it-abbr';
import mark from 'markdown-it-mark';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import ins from 'markdown-it-ins';
import createDOMPurify from 'dompurify';
import JSON5 from 'json5';
import * as pako from 'pako';

const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const compatSource = await readFile(new URL('../js/markdown-compat.js', import.meta.url), 'utf8');
const diagramsSource = await readFile(new URL('../js/diagram-renderer.js', import.meta.url), 'utf8');
const imageCdnSource = await readFile(new URL('../js/image-cdn.js', import.meta.url), 'utf8');
const htmlSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function setup() {
  const dom = new JSDOM(htmlSource.replace(/<script\b[^>]*src=[^>]*><\/script>/g, ''), {
    runScripts: 'outside-only', url: 'https://example.test/mdpage/', pretendToBeVisual: true,
  });
  const { window } = dom;
  Object.assign(window, {
    markdownit: MarkdownIt, markdownitTaskLists: taskLists, markdownitFootnote: footnote,
    markdownitEmoji: emoji, markdownitContainer: container, markdownitDeflist: deflist,
    markdownitAbbr: abbr, markdownitMark: mark, markdownitSub: sub, markdownitSup: sup, markdownitIns: ins,
    DOMPurify: createDOMPurify(window),
    JSON5, pako,
    hljs: { highlightElement() {} },
    mermaid: { initialize(config) { window.mermaidConfig = config; }, init() {}, render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>' }) },
  });
  window.matchMedia = () => ({ matches: true });
  window.CodeMirror = { fromTextArea() {
    let value = '';
    let readOnly = false;
    return { setValue(text) { value = text; }, getValue() { return value; }, on() {}, refresh() {},
      getOption() { return readOnly; }, setOption(_, option) { readOnly = option; },
      getCursor() { return { line: 0, ch: 0 }; }, setCursor() {}, scrollIntoView() {} };
  } };
  window.eval(compatSource);
  window.eval(diagramsSource);
  window.eval(imageCdnSource);
  window.eval(appSource + '\nwindow.testApp = { md, editor, render, outline, toggleWideMode, inlineNodeToDocxRunsAsync, htmlElementToDocxBlocks, prepareExportImages, renderDrawioDiagrams, waitForDrawioRendered, normalizeDrawioXml, ensureDrawioLoaded, svgToPng };');
  const root = window.document.getElementById('preview');
  return { window, dom, root, app: window.testApp,
    render(source) { window.testApp.editor.setValue(source); window.testApp.render(); return root; } };
}

function use(t) {
  const context = setup();
  t.after(() => context.dom.window.close());
  return context;
}

test('all common TOC markers render linked hierarchies and floating outline', (t) => {
  const { render, root, window } = use(t);
  for (const marker of ['[TOC]', '[toc]', '[[toc]]', '[[_TOC_]]']) {
    render(`${marker}\n\n# **开始**\n\n### 跳级\n\n## Second\n\n# Tail`);
    assert.equal(root.querySelectorAll('.md-toc > ol > li').length, 2, marker);
    assert.equal(root.querySelectorAll('.md-toc ol ol li').length, 2, marker);
    const links = root.querySelectorAll('.md-toc a');
    assert.equal(links.length, 4);
    assert.equal(links[0].textContent, '开始');
    for (const link of links) assert.ok(root.querySelectorAll('h1,h2,h3').values().some((h) => h.id === link.dataset.headingId));
    assert.equal(window.document.getElementById('floating-toc').hidden, false);
    assert.equal(window.document.querySelectorAll('#floating-toc-list a').length, 4);
  }
});

test('MWeb screenshot-style Setext title builds the same nested body TOC', (t) => {
  const { render, root } = use(t);
  render('06 | 8 个技巧，帮你做一场漂亮的技术大会演讲\n============================\n\n[toc]\n\n沈剑 2017-12-04\n\n## 一、提前了解听众的诉求\n\n## 二、紧张是正常的');
  assert.equal(root.querySelector('.md-toc > ol > li > a').textContent, root.querySelector('h1').textContent);
  assert.equal(root.querySelectorAll('.md-toc > ol > li > ol > li').length, 2);
});

test('MWeb width modifier applies to images, not code or ordinary alt text', (t) => {
  const { render, root } = use(t);
  render('![图片描述-w140](https://example.test/a.png)\n\n![normal-w0](x.png)\n\n![normal-width](x.png)\n\n`![code-w140](x.png)`');
  const imgs = root.querySelectorAll('img');
  assert.equal(imgs.length, 3);
  assert.equal(imgs[0].getAttribute('width'), '140');
  assert.equal(imgs[0].alt, '图片描述');
  assert.equal(imgs[1].hasAttribute('width'), false);
  assert.equal(imgs[2].alt, 'normal-width');
});

test('draw.io awaiting rejects errors and never silently succeeds after a timeout', async (t) => {
  const { root, app } = use(t);
  root.innerHTML = '<div class="drawio-diagram" data-drawio-rendered="rendering"></div>';
  await assert.rejects(app.waitForDrawioRendered(root, { timeoutMs: 0 }), /仍在加载/);
  root.firstElementChild.innerHTML = '<p class="drawio-error">Invalid XML</p>';
  await assert.rejects(app.waitForDrawioRendered(root, { timeoutMs: 20 }), /渲染失败/);
});

test('draw.io claims pending jobs before awaiting libraries to prevent duplicate graphs', async (t) => {
  const { root, app, window } = use(t);
  let instances = 0;
  let destroyed = 0;
  window.mxGraph = class {
    constructor() { instances++; this.view = { setTranslate() {}, setScale() {} }; }
    setEnabled() {} setConnectable() {} setPanning() {} setTooltips() {} setCellsSelectable() {} setGridEnabled() {} setHtmlLabels() {}
    getModel() { return { beginUpdate() {}, endUpdate() {} }; }
    getGraphBounds() { return { x: 0, y: 0, width: 100, height: 50 }; }
    sizeDidChange() {} destroy() { destroyed++; }
    convertValueToString() { return ''; }
  };
  window.mxCodec = class { decode() {} };
  window.mxUtils = { parseXml() {} };
  root.innerHTML = '<div class="drawio-diagram" data-drawio-rendered="0"><script class="drawio-source" type="text/plain">&lt;unused&gt;</script><div class="drawio-capture"></div></div>';
  root.querySelector('script').textContent = '<mxGraphModel><root/></mxGraphModel>';
  const first = app.renderDrawioDiagrams(root);
  assert.equal(root.firstElementChild.dataset.drawioRendered, 'loading');
  await Promise.all([first, app.renderDrawioDiagrams(root)]);
  await app.waitForDrawioRendered(root);
  assert.equal(instances, 1);
  app.editor.setValue('# New document');
  app.render();
  assert.equal(destroyed, 1);
});

test('TOC markers do not consume code, linked labels or ordinary paragraphs', (t) => {
  const { render, root } = use(t);
  render('````md\n```\n[TOC]\n```\n````\n\n~~~\n[[toc]]\n~~~\n\n    [TOC]\n\n`[TOC]`\n\nA [TOC] example\n\n[TOC](https://example.test)\n\n# Heading');
  assert.equal(root.querySelectorAll('.md-toc').length, 0);
  assert.equal(root.querySelectorAll('pre').length, 3);
  assert.match(root.textContent, /A \[TOC\] example/);
  assert.equal(root.querySelector('a[href="https://example.test"]').textContent, 'TOC');
});

test('standalone TOC handles adjacent text without stealing forward references', (t) => {
  const { render, root } = use(t);
  render('[TOC]\nIntroduction\n\n# Heading');
  assert.ok(root.querySelector('.md-toc'));
  assert.match(root.querySelector('p:not(.md-toc-title)').textContent, /Introduction/);
  for (const source of ['[TOC]\n\n[TOC]: https://example.com', '[TOC]: https://example.com\n\n[TOC]']) {
    render(source);
    assert.equal(root.querySelector('.md-toc'), null);
    assert.equal(root.querySelector('a').href, 'https://example.com/');
  }
});

test('title slugs keep existing punctuation rules and include image alt text', (t) => {
  const { render, root, window } = use(t);
  render('# A.B\n# ![Image only](https://example.test/pic.png)\n# Head ![Icon](https://example.test/icon.png)');
  assert.deepEqual([...root.querySelectorAll('h1')].map((h) => h.id), ['a-b', 'image-only', 'head-icon']);
  assert.deepEqual([...window.document.querySelectorAll('#floating-toc-list a')].map((a) => a.textContent), ['A.B', 'Image only', 'Head Icon']);
});

test('heading attributes work with ATX, Setext, duplicate IDs and no_toc', (t) => {
  const { render, root, window } = use(t);
  render('[TOC]\n\n# A!\n# A\n# A-1\n## 自动\n# Explicit {#自动}\n## Again {#自动}\n## Hidden {.no_toc}\nSetext {#set .no-toc}\n---\n## UI {#preview}\n## Keep {onclick="bad"}\n');
  const headings = [...root.querySelectorAll('h1,h2')];
  const ids = headings.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(headings[4].id, '自动');
  assert.equal(headings[3].id, '自动-2');
  assert.equal(headings[5].id, '自动-1');
  assert.equal(headings[7].id, 'set');
  assert.equal(headings[8].id, 'preview-1');
  assert.match(headings[9].textContent, /\{onclick/);
  assert.equal(root.querySelectorAll('.md-toc a').length, headings.length - 2);
  const allIds = [...window.document.querySelectorAll('[id]')].map((node) => node.id);
  assert.equal(new Set(allIds).size, allIds.length);
});

test('frontmatter is non-executable and does not steal horizontal rules or quotes', (t) => {
  const { render, root } = use(t);
  render('---\ntitle: <img src=x onerror=alert(1)>\ntags: [a]\n---\n\n# Body');
  assert.ok(root.querySelector('.md-frontmatter'));
  assert.equal(root.querySelector('.md-frontmatter img'), null);
  assert.equal(root.querySelector('.md-frontmatter').hasAttribute('open'), false);
  render('+++\ntitle = "Hello"\n+++\n\n# Body');
  assert.match(root.querySelector('.md-frontmatter summary').textContent, /TOML/);
  for (const source of ['---\n\nintro\n\n---', '> ---\n> a: b\n> ---', '---\ntitle: missing ending']) {
    render(source);
    assert.equal(root.querySelector('.md-frontmatter'), null, source);
  }
});

test('GitHub and Obsidian callouts preserve rich bodies and support folding/nesting', (t) => {
  const { render, root } = use(t);
  render('> [!NOTE]\n> A **bold** body\n>\n> - item\n\n> [!faq]- **Question**\n> Answer\n>\n> > [!TIP]+ Child\n> > Nested\n\n> [!unknown] Custom\n> Content');
  assert.equal(root.querySelectorAll('.md-callout').length, 4);
  assert.equal(root.querySelector('.md-callout-note strong').textContent, 'bold');
  assert.equal(root.querySelector('.md-callout li').textContent, 'item');
  const folded = root.querySelector('details.md-callout-question');
  assert.equal(folded.open, false);
  assert.equal(folded.querySelector('summary strong').textContent, 'Question');
  assert.equal(folded.querySelector('details.md-callout-tip').open, true);
  assert.equal(root.querySelectorAll('.md-callout-note').length, 2);
});

test('rendering rich callout titles cannot duplicate the document footnotes', (t) => {
  const { render, root } = use(t);
  render('> [!TIP] **Title**\n> Content[^a]\n\n> [!NOTE] Another\n> Body\n\n[^a]: Single footnote');
  assert.equal(root.querySelectorAll('.footnotes').length, 1);
  assert.equal(root.querySelector('.md-callout .footnotes'), null);
  assert.match(root.querySelector('.footnotes').textContent, /Single footnote/);
  render('Regular[^a]\n\n> [!TIP] [title][id]^[extra]\n> Body\n\n[^a]: Outside footnote\n\n[id]: https://example.test');
  assert.equal(root.querySelectorAll('.footnotes').length, 1);
  assert.equal(root.querySelector('.md-callout .footnotes'), null);
  assert.ok(root.querySelector('.md-callout-title a[href="https://example.test"]'));
  const ids = [...root.querySelectorAll('[id]')].map((el) => el.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('unclosed math delimiters have bounded scanning on a long paragraph', (t) => {
  const { app } = use(t);
  const started = performance.now();
  app.md.render(String.raw`\(a `.repeat(32000));
  app.md.render('\\(a\n'.repeat(16000) + '\\)');
  assert.ok(performance.now() - started < 2000, 'unclosed math must not repeatedly scan the entire tail');
});

test('container variants and existing details preserve Markdown inside', (t) => {
  const { render, root } = use(t);
  render('::: warning 注意\n**Content**\n:::\n\n::: details More\nHidden *body*\n:::\n\n::: collapse Fold\nBody\n:::');
  assert.equal(root.querySelector('.md-callout-warning strong').textContent, 'Content');
  assert.equal(root.querySelectorAll('details.md-details').length, 2);
  assert.equal(root.querySelector('details em').textContent, 'body');
});

test('highlights, sub/sup, insertions, definitions, abbreviations and emoji render', (t) => {
  const { render, root } = use(t);
  render('==亮点== H~2~O x^2^ ++新增++ ~~删除~~ :rocket:\n\nTerm\n: Definition\n\nHTML\n\n*[HTML]: HyperText Markup Language');
  for (const tag of ['mark', 'sub', 'sup', 'ins', 's', 'dl', 'dt', 'dd', 'abbr']) assert.ok(root.querySelector(tag), tag);
  assert.match(root.textContent, /🚀/);
  assert.equal(root.querySelector('abbr').title, 'HyperText Markup Language');
});

test('safe HTML, original GFM table alignment, tasks and footnotes survive sanitization', (t) => {
  const { render, root } = use(t);
  render('<details><summary>HTML</summary>Body</details>\n\n| L | C | R |\n| :--- | :---: | ---: |\n| one | two | three |\n\n- [x] **done**\n- [ ] pending\n\nBody[^a]\n\n[^a]: Note');
  assert.ok(root.querySelector('details'));
  assert.deepEqual([...root.querySelectorAll('th')].map((h) => h.getAttribute('align')), ['left', 'center', 'right']);
  assert.ok(root.querySelector('.task-list-item strong'));
  assert.equal(root.querySelectorAll('input[disabled]').length, 2);
  assert.ok(root.querySelector('.footnote-ref'));
});

test('unsafe pasted HTML and unsafe legacy link destinations cannot execute', (t) => {
  const { render, root } = use(t);
  render('<script>bad()</script><img src=x onerror=bad()><iframe src="https://example.test"></iframe><style>body{display:none}</style>\n\n[x](javascript:alert%281%29){:title="bad"}\n\n[[img:javascript:alert(1)]]\n\n<a href="javascript:bad()" onclick="bad()">x</a>');
  assert.equal(root.querySelector('script,iframe,style,[onerror],[onclick]'), null);
  assert.equal(root.querySelector('a[href^="javascript:"],img[src^="javascript:"]'), null);
});

test('a missing sanitizer fails closed without losing the source document', (t) => {
  const { render, root, app, window } = use(t);
  window.DOMPurify = undefined;
  const source = '# 原文\n\n<img src=x onerror=bad()>';
  render(source);
  assert.equal(app.editor.getValue(), source);
  assert.equal(root.querySelector('img'), null);
  assert.match(root.textContent, /安全渲染库加载失败/);
});

test('legacy images and title attributes obey token boundaries and preserve code', (t) => {
  const { render, root } = use(t);
  render('[[img:https://example.test/a.png]]\n\n[x](#abc){:title="Tooltip"}\n\n[x](#abc) word {:title="ordinary"}\n\n`[[img:x]]`\n\n~~~md\n[x](#abc){:title="literal"}\n~~~');
  assert.equal(root.querySelector('img').src, 'https://example.test/a.png');
  const links = root.querySelectorAll('a');
  assert.equal(links[0].title, 'Tooltip');
  assert.equal(links[1].title, '');
  assert.match(root.textContent, /word \{:title=/);
  assert.match(root.querySelector('pre').textContent, /literal/);
});

test('math tokens protect TeX from Markdown and support four delimiter styles plus math fences', (t) => {
  const { render, root } = use(t);
  render(String.raw`$a_b + c_d$ and \(x^2\) and $$E=mc^2$$

$$
\begin{aligned}
a &= b \\
c &= d
\end{aligned}
$$

\[
x + y
\]

` + '```math\nx^2 + y^2\n```\n\n`$literal$`\n\nPrice $5 and $10');
  const math = root.querySelectorAll('.md-math');
  assert.equal(math.length, 6);
  assert.equal(math[0].textContent, 'a_b + c_d');
  assert.equal(math[0].querySelector('em,sub'), null);
  assert.equal(math[1].textContent, 'x^2');
  assert.equal(math[3].dataset.display, '1');
  assert.match(root.textContent, /Price \$5 and \$10/);
  assert.equal(root.querySelectorAll('p code').length, 1);
});

test('math cannot cross link labels and code fences never undergo legacy diagram conversion', (t) => {
  const { render, root } = use(t);
  render(String.raw`[a \(](https://example.com) \)` + '\n\n````md\n```sequence\nA->B: hello\n```\n````\n\n~~~~sequence\nA->B: hello\n~~~~');
  assert.ok(root.querySelector('a[href="https://example.com"]'));
  assert.equal(root.querySelector('a .md-math'), null);
  assert.match(root.querySelector('pre code').textContent, /```sequence/);
  assert.equal(root.querySelectorAll('.mermaid').length, 1);
  assert.match(root.querySelector('.mermaid').textContent, /sequenceDiagram/);
});

test('floating outline toggles, clears on empty input and links open folded sections', (t) => {
  const { render, root, window } = use(t);
  render('::: details Fold\n## Target\nBody\n:::');
  const panel = window.document.getElementById('floating-toc');
  const toggle = window.document.getElementById('floating-toc-toggle');
  const pane = window.document.getElementById('preview-pane');
  let scrolled = false;
  pane.scrollTo = () => { scrolled = true; };
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  window.document.querySelector('#floating-toc-list a').click();
  assert.equal(root.querySelector('details').open, true);
  assert.equal(scrolled, true);
  assert.equal(window.document.activeElement.tagName, 'H2');
  render('');
  assert.equal(panel.hidden, true);
  assert.equal(window.document.querySelectorAll('#floating-toc-list a').length, 0);
});

test('new inline formatting survives Word run conversion', async (t) => {
  const { render, root, window, app } = use(t);
  window.docx = { TextRun: class { constructor(options) { this.options = options; } } };
  render('==mark== H~2~O x^2^ ++added++');
  const runs = await app.inlineNodeToDocxRunsAsync(root.querySelector('p'));
  assert.ok(runs.some((run) => run.options.highlight === 'yellow'));
  assert.ok(runs.some((run) => run.options.subScript));
  assert.ok(runs.some((run) => run.options.superScript));
  assert.ok(runs.some((run) => run.options.underline));
});

test('Word export promotes whole ECharts/Graphviz containers to block-sized images', async (t) => {
  const { root, window } = use(t);
  root.innerHTML = '<figure class="md-diagram"><div class="md-diagram-capture"><div><svg></svg></div></div><details class="md-diagram-source">source1</details></figure>'
    + '<figure class="md-diagram"><div class="md-diagram-capture"><svg></svg></div><details class="md-diagram-source">source2</details></figure>';
  class Element { constructor(options) { this.options = options; } }
  let exported;
  window.docx = {
    Document: Element, Paragraph: Element, TextRun: Element, ImageRun: Element,
    HeadingLevel: {}, AlignmentType: { LEFT: 'left', CENTER: 'center' },
    Packer: { toBlob(document) { exported = document; return new window.Blob(); } },
  };
  window.saveAs = () => {};
  window.alert = (message) => assert.fail(message);
  window.eval('ensureExportLibsLoaded = async () => {}; svgToPng = async () => ({data:"data:image/png;base64,AA==",width:600,height:360}); getImageSizeFromDataUrl = async () => ({width:600,height:360});');
  await window.exportWord();
  const paragraphs = exported.options.sections[0].children;
  assert.equal(paragraphs.length, 2);
  for (const paragraph of paragraphs) {
    const image = paragraph.options.children[0];
    assert.equal(image.options.transformation.width, 600);
    assert.equal(image.options.transformation.height, 360);
  }
});

function exportStub(window, onSave) {
  class Item { constructor(options) { this.options = options; } }
  window.docx = {
    Document: Item, Paragraph: Item, TextRun: Item, ImageRun: Item, ExternalHyperlink: Item,
    HeadingLevel: {}, AlignmentType: { LEFT: 'left', CENTER: 'center' },
    Packer: { toBlob(document) { onSave(document); return new window.Blob(); } },
  };
  window.saveAs = () => {};
  window.eval('ensureExportLibsLoaded = async () => {};');
}

test('export flushes last typed text and cancels if source changes during async work', async (t) => {
  const { app, window } = use(t);
  let captured;
  exportStub(window, (doc) => { captured = doc; });
  window.alert = (message) => assert.fail(message);
  app.editor.setValue('Latest unscheduled content');
  await window.exportWord();
  assert.match(JSON.stringify(captured), /Latest unscheduled content/);
  let alert;
  window.alert = (message) => { alert = message; };
  window.eval('ensureExportLibsLoaded = async () => { window.testApp.editor.setValue("Changed during export"); };');
  captured = undefined;
  await window.exportWord();
  assert.equal(captured, undefined);
  assert.match(alert, /已变化/);
  assert.equal(app.editor.getOption('readOnly'), false);
});

test('formula failures always remove export sandbox and restore UI state', async (t) => {
  const { root, app, window } = use(t);
  exportStub(window, () => assert.fail('must not pack a failed export'));
  window.alert = () => {};
  app.editor.setValue('Formula snapshot'); app.render();
  root.innerHTML = '<div class="katex-display"><span class="katex"><annotation encoding="application/x-tex">x</annotation></span></div>';
  window.eval('texToPngViaMathJax = async () => { throw new Error("offline"); };');
  await window.exportWord();
  assert.equal(window.document.querySelectorAll('[data-export-sandbox]').length, 0);
  assert.equal(window.document.getElementById('btn-export-word').disabled, false);
});

test('remote image failures refuse silent image omission and list/task/link structure survives', async (t) => {
  const { root, app, window, render } = use(t);
  root.innerHTML = '<img src="https://example.test/unavailable.png">';
  window.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(app.prepareExportImages(root), /停止导出/);
  exportStub(window, () => {});
  render('- [x] done\n- [ ] pending\n\n3. Outer\n   1. Inner\n\n[Link](https://example.test/page)');
  const blocks = await app.htmlElementToDocxBlocks(root);
  const serialized = JSON.stringify(blocks);
  assert.match(serialized, /☑/);
  assert.match(serialized, /☐/);
  assert.match(serialized, /3\. /);
  assert.match(serialized, /https:\/\/example.test\/page/);
  assert.ok(blocks.some((block) => block.options.indent?.left === 360));
});

test('unclosed math blocks and duplicate heading IDs remain bounded', (t) => {
  const { app, root, window } = use(t);
  const started = performance.now();
  app.md.render('\\[\n'.repeat(8000) + 'x');
  root.innerHTML = '<h2>Duplicate</h2>'.repeat(4000);
  window.MarkdownCompat.ensureHeadingIds(root);
  assert.equal(root.lastElementChild.id, 'duplicate-3999');
  assert.ok(performance.now() - started < 3000, 'math and heading allocation must not rescan quadratically');
});

test('repeated TOC markers have a bounded node budget and visible notices', (t) => {
  const { root, render, window } = use(t);
  const started = performance.now();
  render('[TOC]\n\n'.repeat(100) + '# Heading\n'.repeat(1100));
  assert.equal(root.querySelectorAll('.md-toc ol').length, 3);
  assert.equal(root.querySelectorAll('.md-toc a').length, 3000);
  assert.equal(window.document.querySelectorAll('#floating-toc-list a').length, 1000);
  assert.match(root.textContent, /最多展示 3/);
  assert.ok(performance.now() - started < 6000);
});

test('Word list export preserves paragraphs around a nested list', async (t) => {
  const { root, app, window, render } = use(t);
  exportStub(window, () => {});
  render('3. Outer\n   1. Inner\n\n   After nested\n4. Next');
  const blocks = JSON.stringify(await app.htmlElementToDocxBlocks(root));
  assert.ok(blocks.indexOf('Outer') < blocks.indexOf('Inner'));
  assert.ok(blocks.indexOf('Inner') < blocks.indexOf('After nested'));
  assert.ok(blocks.indexOf('After nested') < blocks.indexOf('Next'));
});

test('Word export rejects corrupt image data rather than packaging broken pictures', async (t) => {
  const { root, app, window } = use(t);
  window.Image = class { set src(_) { window.queueMicrotask(() => this.onerror()); } };
  root.innerHTML = '<img src="data:image/png;base64,AAAA" srcset="https://example.test/alternate.png 2x">';
  await assert.rejects(app.prepareExportImages(root), /无法解码/);
});

test('draw.io hardening rejects includes without breaking ordinary codec children', async (t) => {
  const { app, window } = use(t);
  window.mxGraph = function () {};
  window.mxCodec = function () {};
  window.mxUtils = { parseXml() {} };
  window.mxObjectCodec = function () {};
  window.mxStylesheetCodec = { allowEval: true };
  await app.ensureDrawioLoaded();
  assert.equal(window.mxStylesheetCodec.allowEval, false);
  assert.equal(window.mxObjectCodec.allowEval, false);
  assert.equal(window.mxObjectCodec.prototype.processInclude(null, { nodeName: 'mxCell' }), false);
  assert.throws(() => window.mxObjectCodec.prototype.processInclude(null, { nodeName: 'include' }), /禁止/);
});

test('Mermaid configuration preserves secure defaults and native SVG labels', (t) => {
  const { window } = use(t);
  const config = window.mermaidConfig;
  assert.equal(config.htmlLabels, false);
  assert.equal(config.flowchart.htmlLabels, false);
  for (const key of ['secure', 'securityLevel', 'maxTextSize', 'maxEdges', 'themeCSS', 'themeVariables', 'htmlLabels', 'flowchart']) {
    assert.ok(config.secure.includes(key), key);
  }
});

test('SVG export refuses huge canvas allocation before decoding', async (t) => {
  const { window, app } = use(t);
  const svg = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.getBoundingClientRect = () => ({ width: 1000000, height: 1000000 });
  assert.equal(await app.svgToPng(svg), null);
});
