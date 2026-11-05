import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import container from 'markdown-it-container';

const compatSource = await readFile(new URL('../js/markdown-compat.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../js/image-cdn.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const endpoint = 'https://upload.example.test/api/upload';
const cdn = (n) => `https://edit-upload-pic.cdn.bcebos.com/test-${n}.png?authorization=a%2Fb&key=value`;

function setup(t) {
  const dom = new JSDOM(html.replace(/<script\b[^>]*src=[^>]*><\/script>/g, ''), { url: 'https://example.test/mdpage/', runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(compatSource);
  window.eval(source);
  window.document.getElementById('image-cdn-endpoint').value = endpoint;
  const createRenderer = () => new MarkdownIt({ html: true }).use(footnote).use(window.MarkdownCompat.install, { container });
  const scan = window.ImageCdn.createScanner(createRenderer);
  t.after(() => window.close());
  return { window, api: window.ImageCdn, createRenderer, scan };
}

function apply(api, plan) {
  return api.applyResults(plan, new Map(plan.groups.map((group, i) => [group.source, cdn(i + 1)]))).output;
}

test('scanner rewrites only destinations, preserving MWeb alt, titles, parentheses and duplicate links', (t) => {
  const { scan, api } = setup(t);
  const markdown = '# Header\r\n\r\n![*描述*-w140](https://example.com/pic\(1\).png "title")\r\n\r\n![same](<https://example.com/pic(1).png>)\r\n\r\n[普通链接](https://example.com/pic(1).png)';
  const plan = scan(markdown);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].occurrences.length, 2);
  const output = apply(api, plan);
  assert.equal(output, '# Header\r\n\r\n![*描述*-w140](' + cdn(1) + ' "title")\r\n\r\n![same](<' + cdn(1) + '>)\r\n\r\n[普通链接](https://example.com/pic(1).png)');
});

test('scanner ignores fenced, indented and inline code, HTML pre, comments, front matter, and math', (t) => {
  const { scan } = setup(t);
  const markdown = '---\ntitle: "![meta](https://example.com/meta.png)"\n---\n\n'
    + '````md\n```\n![fence](https://example.com/fence.png)\n```\n````\n\n'
    + '~~~md\n![tilde](https://example.com/tilde.png)\n~~~\n\n'
    + '    ![indent](https://example.com/indent.png)\n\n'
    + '`![inline](https://example.com/inline.png)`\n\n'
    + '<pre><img src="https://example.com/pre.png"></pre>\n\n'
    + '<!-- <img src="https://example.com/comment.png"> -->\n\n'
    + '<div>\n<![CDATA[<img src="https://example.com/cdata.png">]]>\n</div>\n\n'
    + 'text <code>![code](https://example.com/code.png)</code>\n\n'
    + '$![math](https://example.com/math.png)$';
  assert.equal(scan(markdown).groups.length, 0);
});

test('table cell image ranges include headers, repeated cells and escaped pipes', (t) => {
  const { scan, api } = setup(t);
  const markdown = '| ![head](https://example.com/h.png) | B |\n|---|---|\n| ![a\\|b](https://example.com/a.png) | ![same](https://example.com/a.png) |\n| `![code](https://example.com/no.png)` | ![last](https://example.com/l.png) |';
  const plan = scan(markdown);
  assert.equal(plan.groups.length, 3);
  assert.equal(plan.groups[1].occurrences.length, 2);
  const output = apply(api, plan);
  assert.ok(output.includes(`![a\\|b](${cdn(2)})`));
  assert.ok(output.includes('`![code](https://example.com/no.png)`'));
  assert.ok(output.includes(`![last](${cdn(3)})`));
  const quoted = '> |a|b|\n> |-|-|\n> |![a](https://example.com/a.png)|![b](https://example.com/b.png)|';
  const quotePlan = scan(quoted);
  assert.equal(quotePlan.groups.length, 2);
  assert.ok(apply(api, quotePlan).includes(`> |![a](${cdn(1)})|![b](${cdn(2)})|`));
});

test('reference images convert usages without modifying shared definitions or ordinary links', (t) => {
  const { scan, api } = setup(t);
  const markdown = '![image][id]\n\n![id][]\n\n![id]\n\n[normal][id]\n\n[id]: https://example.com/a.png "shared title"';
  const plan = scan(markdown);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].occurrences.length, 3);
  assert.equal(apply(api, plan), `![image](${cdn(1)} "shared title")\n\n![id](${cdn(1)} "shared title")\n\n![id](${cdn(1)} "shared title")\n\n[normal][id]\n\n[id]: https://example.com/a.png "shared title"`);
});

test('scanner handles list/quote/footnote content and linked images without changing labels', (t) => {
  const { scan, api } = setup(t);
  const markdown = '> [!TIP] Hint\n> ![quote](https://example.com/q.png)\n\n- ![list](https://example.com/l.png)\n\n[![linked](https://example.com/i.png)](https://example.com/target)\n\nText[^a]\n\n[^a]: ![footnote](https://example.com/f.png)';
  const plan = scan(markdown);
  assert.equal(plan.groups.length, 4);
  const output = apply(api, plan);
  assert.match(output, /\[!\[linked\]\(https:\/\/edit-upload-pic/);
  assert.match(output, /\]\(https:\/\/example\.com\/target\)/);
  assert.match(output, /\[\^a\]: !\[footnote\]\(https:\/\/edit-upload-pic/);
});

test('inline footnote image ranges never alias a matching code example later in the paragraph', (t) => {
  const { scan, api } = setup(t);
  const markdown = 'Text^[one ![img](https://example.com/a.png)] `one ![img](https://example.com/a.png)`';
  const plan = scan(markdown);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].occurrences.length, 1);
  assert.equal(apply(api, plan), `Text^[one ![img](${cdn(1)})] \`one ![img](https://example.com/a.png)\``);
  assert.equal(scan('Text^[one ![img](https://example.com/a.png)]').groups.length, 1);
});

test('HTML image src and legacy images preserve surrounding formatting and escape CDN query ampersands', (t) => {
  const { scan, api } = setup(t);
  const markdown = '<div>\n<img alt="x" width="140" src=\'https://example.com/a.png?a=1&amp;b=2\'>\n</div>\n\n[[img:https://example.com/legacy.png]]';
  const plan = scan(markdown);
  assert.equal(plan.groups.length, 2);
  assert.equal(plan.groups[0].source, 'https://example.com/a.png?a=1&b=2');
  const output = apply(api, plan);
  assert.ok(output.includes(`alt="x" width="140" src='${cdn(1).replace(/&/g, '&amp;')}'`));
  assert.ok(output.includes(`[[img:${cdn(2)}]]`));
});

test('skip local and private sources, reject oversized data, and avoid reuploading existing CDN', (t) => {
  const { scan, api } = setup(t);
  const data = 'data:image/png;base64,iVBORw0KGgo=';
  const plan = scan(`![data](${data})\n![local](./img.png)\n![private](http://127.0.0.1/a.png)\n![lan](https://x.local/p.png)\n![cdn](${cdn(1)})`);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].type, 'data');
  assert.equal(plan.skipped.length, 3);
  assert.equal(plan.already, 1);
  assert.ok(api.classifySource('data:image/png;base64,' + 'a'.repeat(7 * 1024 * 1024)).reason);
  for (const url of ['http://2130706433/a.png', 'https://user:password@example.com/x', 'file:///tmp/x', 'blob:https://example.com/a', 'http://localhost./a.png', 'https://x.local./a.png']) assert.ok(api.classifySource(url).reason, url);
});

test('upload sends only image source without credentials and validates HTTP and CDN result', async (t) => {
  const { api } = setup(t);
  let sent;
  const url = await api.uploadImage({ type: 'url', source: 'https://example.com/a.png' }, { endpoint, fetchImpl: async (endpoint, options) => {
    sent = { endpoint, options };
    return { ok: true, json: async () => ({ ok: true, data: { url: cdn(1) } }) };
  } });
  assert.equal(url, cdn(1));
  assert.equal(sent.endpoint, endpoint);
  assert.equal(sent.options.credentials, 'omit');
  assert.equal(sent.options.referrerPolicy, 'no-referrer');
  assert.equal(sent.options.body, '{"url":"https://example.com/a.png"}');
  for (const result of [{ ok: false }, { ok: true, url: 'javascript:alert(1)' }, { ok: true, url: 'https://evil.test/x' }, { ok: true, url: cdn(1) + '"' }]) assert.throws(() => api.validateResult(result));
  assert.throws(() => api.validateResult({ ok: false, error: { message: 'private upstream detail' } }), (error) => !error.message.includes('private upstream'));
  await assert.rejects(api.uploadImage({ type: 'data', source: 'x' }, { endpoint, fetchImpl: async () => ({ ok: false, status: 413, json: async () => ({ error: { message: 'sensitive upstream detail' } }) }) }), /HTTP 413/);
});

function fakeEditor(initial) {
  let value = initial;
  let readOnly = false;
  const listeners = [];
  let operations = 0;
  return { getValue: () => value,
    getOption: () => readOnly, setOption: (_, v) => { readOnly = v; },
    on: (_, callback) => listeners.push(callback),
    change(text) { value = text; listeners.forEach((callback) => callback()); },
    operation(callback) { operations++; callback(); }, posFromIndex: (i) => i,
    replaceRange(text, from, to) { value = value.slice(0, from) + text + value.slice(to); listeners.forEach((callback) => callback()); },
    operations: () => operations,
  };
}

test('batch upload shows true counts, deduplicates and applies all replacements as one operation', async (t) => {
  const { api, createRenderer, window } = setup(t);
  const markdown = '![one](https://example.com/1.png) ![same](https://example.com/1.png)\n![two](https://example.com/2.png)';
  const editor = fakeEditor(markdown);
  const statuses = [];
  let calls = 0;
  const controller = api.createController({ editor, createRenderer, upload: async () => {
    statuses.push(window.document.getElementById('image-cdn-status').textContent);
    assert.equal(editor.getOption('readOnly'), true);
    return cdn(++calls);
  } });
  await controller.start();
  assert.equal(calls, 2);
  assert.equal(editor.operations(), 1);
  assert.equal(editor.getOption('readOnly'), false);
  assert.equal((editor.getValue().match(/test-1.png/g) || []).length, 2);
  assert.match(statuses[0], /0\/2/);
  assert.match(statuses[1], /1\/2/);
  assert.equal(window.document.getElementById('image-cdn-progress').value, 2);
  assert.match(window.document.getElementById('image-cdn-status').textContent, /替换 3 处/);
});

test('partial failure keeps all source links and retry reuses known success only', async (t) => {
  const { api, createRenderer, window } = setup(t);
  const markdown = '![one](https://example.com/1.png)\n![two](https://example.com/2.png)';
  const editor = fakeEditor(markdown);
  let calls = 0;
  let fail = true;
  const controller = api.createController({ editor, createRenderer, upload: async () => {
    calls++;
    if (calls === 2 && fail) throw new Error('Connection failed');
    return cdn(calls);
  } });
  await controller.start();
  assert.equal(editor.getValue(), markdown);
  assert.match(window.document.getElementById('image-cdn-status').textContent, /原文链接未修改/);
  fail = false;
  await controller.start();
  assert.equal(calls, 3);
  assert.match(editor.getValue(), /test-1.png/);
  assert.match(editor.getValue(), /test-3.png/);
});

test('cancel or outside edits prevent all link changes and stop later uploads', async (t) => {
  const { api, createRenderer, window } = setup(t);
  const markdown = '![one](https://example.com/1.png)\n![two](https://example.com/2.png)';
  for (const mode of ['cancel', 'edit']) {
    const editor = fakeEditor(markdown);
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    let calls = 0;
    const controller = api.createController({ editor, createRenderer, upload: async () => { calls++; return pending; } });
    const running = controller.start();
    await new Promise((done) => setTimeout(done, 0));
    if (mode === 'cancel') window.document.getElementById('image-cdn-cancel').click();
    else editor.change(markdown + '\nnew edit');
    resolve(cdn(1));
    await running;
    assert.equal(calls, 1);
    assert.equal(editor.getValue(), mode === 'cancel' ? markdown : markdown + '\nnew edit');
    assert.equal(editor.getOption('readOnly'), false);
  }
});

test('upload endpoint is user supplied, validated and never persisted or requested implicitly', async (t) => {
  const { api, createRenderer, window } = setup(t);
  assert.equal(api.endpoint, '');
  for (const value of ['', 'http://example.test/api', 'https://user:password@example.test/api', 'https://localhost./api', 'https://example.test/api?token=secret']) {
    assert.throws(() => api.validateEndpoint(value));
  }
  let calls = 0;
  window.document.getElementById('image-cdn-endpoint').value = '';
  const editor = fakeEditor('![x](https://example.com/x.png)');
  const controller = api.createController({ editor, createRenderer, upload: async () => { calls++; return cdn(1); } });
  await controller.start();
  assert.equal(calls, 0);
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
  assert.match(window.document.getElementById('image-cdn-status').textContent, /填写/);
});
