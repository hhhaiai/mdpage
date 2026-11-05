import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import JSON5 from 'json5';
import * as pako from 'pako';
import * as echarts from 'echarts';
import * as Viz from '@viz-js/viz';
import createDOMPurify from 'dompurify';

const code = await readFile(new URL('../js/diagram-renderer.js', import.meta.url), 'utf8');
const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
const encode = (text) => Buffer.from(pako.deflateRaw(encodeURIComponent(text))).toString('base64');

function setup(t, body = '<div id="root"></div>') {
  const dom = new JSDOM(body, { runScripts: 'outside-only', url: 'https://example.test/mdpage/' });
  Object.assign(dom.window, { JSON5, pako, DOMPurify: createDOMPurify(dom.window) });
  dom.window.eval(code);
  t.after(() => dom.window.close());
  return { window: dom.window, api: dom.window.DiagramRenderer, root: dom.window.document.getElementById('root') };
}

test('MWeb ECharts option assignment accepts data-only JSON5 and prevents unsafe options', (t) => {
  const { api } = setup(t);
  const option = api.parseEchartsOption("option = { xAxis: {type:'category', data:['Mon','Tue',]}, yAxis: {}, series:[{type:'line', data:[1,2]}], }; ");
  assert.equal(option.series[0].type, 'line');
  assert.equal(option.xAxis.data[1], 'Tue');
  assert.equal(option.animation, false);
  assert.equal(option.tooltip.renderMode, 'richText');
  const safe = api.parseEchartsOption('{tooltip:{renderMode:"html",extraCssText:"display:none"},title:{link:"javascript:alert(1)"}}');
  assert.equal(safe.tooltip.renderMode, 'richText');
  assert.equal('extraCssText' in safe.tooltip, false);
  assert.equal('link' in safe.title, false);
  for (const input of [
    'option = {series:[]}; alert(1)', '{formatter: function(){ return 1 }}', '{data: window.x}',
    '{data: (1+2)}', '{__proto__: {polluted:true}}', '{dataView:{}}', '{data:{reg:"(a+)+$"}}',
    '{symbol:"image://https://example.test/a.png"}', '{value:Infinity}', '[]', 'null',
    '{graphic:{type:"rect",style:{fill:"url(https://example.test/leak#g)"}}}',
    '{itemStyle:{color:"url(https://example.test/color)"}}',
  ]) assert.throws(() => api.parseEchartsOption(input), undefined, input);
  for (const paint of ['u\\72l(https://example.test/escape#g)', 'u\\000072l(https://example.test/x)', 'u/**/rl(https://example.test/x)']) {
    assert.throws(() => api.parseEchartsOption(JSON.stringify({ graphic: { type: 'rect', style: { fill: paint } } })), /CSS/);
  }
});

test('native draw.io XML, escaped XML, compressed and multi-page files parse', (t) => {
  const { api } = setup(t);
  assert.equal(api.parseDrawioPages(model)[0].doc.documentElement.tagName, 'mxGraphModel');
  assert.equal(api.parseDrawioPages(`<mxfile><diagram name="Page">${model}</diagram></mxfile>`)[0].name, 'Page');
  const escaped = model.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  assert.equal(api.parseDrawioPages(`<mxfile><diagram>${escaped}</diagram></mxfile>`).length, 1);
  assert.equal(api.parseDrawioPages(escaped)[0].doc.documentElement.tagName, 'mxGraphModel');
  const pages = api.parseDrawioPages(`<mxfile><diagram name="中文">${encode(model)}</diagram><diagram name="Other">${model}</diagram></mxfile>`);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].name, '中文');
  assert.equal(pages[0].doc.querySelectorAll('mxCell').length, 2);
});

test('invalid and oversized draw.io inputs report errors with bounded decompression', (t) => {
  const { api } = setup(t);
  for (const input of ['', '<mxfile/>', '<mxfile><diagram/></mxfile>', '<html/>', '<mxfile><diagram>invalid base64!</diagram></mxfile>',
    '<!DOCTYPE mxGraphModel [<!ENTITY a "x">]><mxGraphModel>&a;</mxGraphModel>',
    `<mxfile><diagram>${encode('<html/>')}</diagram></mxfile>`,
  ]) assert.throws(() => api.parseDrawioPages(input), undefined, input);
  const bomb = `<mxfile><diagram>${encode('a'.repeat(4100000))}</diagram></mxfile>`;
  assert.throws(() => api.parseDrawioPages(bomb), /4 MB/);
  assert.throws(() => api.parseDrawioPages(`<mxfile>${'<diagram>'.concat(model, '</diagram>').repeat(31)}</mxfile>`), /30/);
});

test('draw.io rejects executable codecs, includes and prototype object bindings', (t) => {
  const { api } = setup(t);
  for (const payload of [
    '<mxStylesheet as="styles"><add as="test"><add as="test">window.__executed=1</add></add></mxStylesheet>',
    '<include name="/offline.xml"/>', '<mxCell as="__proto__"/>', '<mxCell constructor="evil"/>',
  ]) {
    assert.throws(() => api.parseDrawioPages(`<mxGraphModel><root><mxCell id="0"/>${payload}</root></mxGraphModel>`), /不支持|不安全/);
    assert.throws(() => api.parseDrawioPages(`<mxfile><diagram>${encode(`<mxGraphModel><root><mxCell id="0"/>${payload}</root></mxGraphModel>`)}</diagram></mxfile>`), /不支持|不安全/);
  }
});

test('ECharts bounds data budgets before rendering on the UI thread', (t) => {
  const { api } = setup(t);
  assert.throws(() => api.parseEchartsOption(JSON.stringify({ series: [{ type: 'pie', data: Array.from({ length: 501 }, (_, i) => ({ name: String(i), value: 1 })) }] })), /超过|过多/);
  assert.throws(() => api.parseEchartsOption(JSON.stringify({ series: [{ type: 'line', data: Array(5001).fill(1) }] })), /过多/);
});

test('failed chart renders retain source and block export instead of silently omitting charts', async (t) => {
  const { root, api } = setup(t, '<div id="root"><pre><code class="language-echarts">option = {bad: function(){}}</code></pre></div>');
  const controller = api.createController({ loadScript: async () => { throw new Error('CDN offline'); } });
  controller.render(root);
  await assert.rejects(controller.waitForReady(root), /未成功渲染/);
  assert.equal(root.querySelector('.md-diagram').dataset.diagramState, 'error');
  assert.match(root.querySelector('pre').textContent, /function/);
  assert.match(root.querySelector('.md-diagram-status').textContent, /CDN offline/);
  controller.dispose();
});

test('obsolete async jobs cannot mutate a new render and chart resources are disposed', async (t) => {
  const { root, api, window } = setup(t, '<div id="root"><pre><code class="language-echarts">{series:[]}</code></pre></div>');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let initialized = 0;
  let disposed = 0;
  window.echarts = { init() { initialized++; return { setOption() {}, dispose() { disposed++; }, resize() {} }; } };
  const controller = api.createController({ loadScript: async () => gate });
  controller.render(root);
  controller.dispose();
  root.innerHTML = '<h1>New document</h1>';
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(initialized, 0);
  assert.equal(root.textContent, 'New document');
  root.innerHTML = '<pre><code class="language-echarts">{series:[]}</code></pre>';
  controller.render(root);
  await controller.waitForReady(root);
  assert.equal(initialized, 1);
  controller.dispose();
  assert.equal(disposed, 1);
});

test('PlantUML remains explicitly unsupported and is never sent to a remote renderer', async (t) => {
  const { root, api } = setup(t, '<div id="root"><pre><code class="language-plantuml">@startuml\nA -> B\n@enduml</code></pre></div>');
  let loads = 0;
  const controller = api.createController({ loadScript: async () => { loads++; } });
  controller.render(root);
  await controller.waitForReady(root);
  assert.equal(loads, 0);
  assert.equal(root.querySelector('.md-diagram').dataset.diagramState, 'unsupported');
  assert.match(root.querySelector('.md-diagram-status').textContent, /不会自动/);
  controller.dispose();
});

test('installed ECharts renders a real MWeb data option as SVG', (t) => {
  const { api } = setup(t);
  const option = api.parseEchartsOption("option = {xAxis:{type:'category',data:['Mon','Tue']},yAxis:{type:'value'},series:[{data:[3,7],type:'bar'}]};");
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 600, height: 360 });
  try {
    chart.setOption(option);
    const svg = chart.renderToSVGString();
    assert.match(svg, /<svg/);
    assert.match(svg, /Mon/);
    assert.match(svg, /Tue/);
  } finally { chart.dispose(); }
});

test('installed Graphviz renders real DOT and rejects malformed input', async () => {
  const viz = await Viz.instance();
  assert.match(viz.renderString('digraph { A -> B }', { format: 'svg' }), /<svg/);
  assert.throws(() => viz.renderString('digraph { A ->', { format: 'svg' }));
});
