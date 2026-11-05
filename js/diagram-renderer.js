(function () {
  'use strict';

  const workerUrl = new URL('diagram-worker.js', document.currentScript?.src || document.baseURI).href;
  const libraries = {
    echarts: ['https://cdn.jsdelivr.net/npm/echarts@6.1.0/dist/echarts.min.js', () => !!window.echarts?.init],
    json5: ['https://cdn.jsdelivr.net/npm/json5@2.2.3/dist/index.min.js', () => !!window.JSON5?.parse],
    pako: ['https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako_inflate.min.js', () => !!window.pako?.Inflate],
  };

  function parseEchartsOption(source) {
    let text = String(source || '').trim();
    if (text.length > 500000) throw new Error('ECharts 配置超过 500 KB，请拆分图表。');
    text = text.replace(/^(?:(?:const|let|var)\s+)?option\s*=\s*/, '').replace(/;\s*$/, '');
    let option;
    try { option = window.JSON5.parse(text); }
    catch { throw new Error('ECharts 需要 JSON/JSON5 数据对象或 option = {...}；不执行函数、表达式或其他 JavaScript。'); }
    if (!option || Array.isArray(option) || typeof option !== 'object') throw new Error('ECharts 配置必须是对象。');
    const clean = (value, depth = 0) => {
      if (depth > 60) throw new Error('ECharts 配置嵌套过深。');
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('图表数据必须是有限数值。');
      if (!value || typeof value !== 'object') {
        if (typeof value === 'string') {
          // SVG paint values follow CSS, including escaped function names.
          const css = value.replace(/\\(?:\r\n|[\n\r\f])/g, '')
            .replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex, char) => {
              const point = hex ? parseInt(hex, 16) : 0;
              return hex ? String.fromCodePoint(point > 0 && point <= 0x10ffff ? point : 0xfffd) : char;
            }).replace(/\/\*[\s\S]*?\*\//g, '');
          if (/^(?:image|javascript):/i.test(value.trim()) || /url\s*\(/i.test(css)) {
            throw new Error('图表不加载外部图片、CSS 资源或脚本。');
          }
        }
        return value;
      }
      if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor', 'reg', 'image', 'dataView'].includes(key)) {
          throw new Error(`安全预览不支持配置项 ${key}。`);
        }
        // Do not permit links, raw HTML/CSS tooltips or externally loaded imagery.
        if (['link', 'sublink', 'href', 'url', 'extraCssText'].includes(key)) continue;
        result[key] = clean(item, depth + 1);
        if (key === 'tooltip') {
          const tooltips = Array.isArray(result[key]) ? result[key] : [result[key]];
          tooltips.forEach((tooltip) => { if (tooltip && typeof tooltip === 'object') tooltip.renderMode = 'richText'; });
        }
        if (key === 'renderMode') result[key] = 'richText';
        if (key === 'animation') result[key] = false;
      }
      return result;
    };
    const safe = clean(option);
    safe.animation = false;
    safe.tooltip = safe.tooltip || { renderMode: 'richText' };
    return safe;
  }

  function parseXml(source) {
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('不支持含 DOCTYPE 或实体声明的 draw.io 文件。');
    const doc = new DOMParser().parseFromString(source, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('draw.io XML 无效，请检查引号、标签和转义字符。');
    return doc;
  }

  function inflateDiagram(source) {
    if (!window.pako?.Inflate) throw new Error('draw.io 解压库未加载。');
    let bytes;
    try { bytes = Uint8Array.from(atob(source.replace(/\s/g, '')), (char) => char.charCodeAt(0)); }
    catch { throw new Error('draw.io 压缩页的 Base64 内容无效。'); }
    const decoder = new window.pako.Inflate({ raw: true, chunkSize: 16384 });
    const chunks = [];
    let length = 0;
    decoder.onData = (chunk) => {
      length += chunk.length;
      if (length > 4000000) throw new Error('draw.io 解压内容超过 4 MB 限制。');
      chunks.push(String.fromCharCode(...chunk));
    };
    try {
      decoder.push(bytes, true);
      if (decoder.err || !decoder.ended) throw new Error('invalid');
      return decodeURIComponent(chunks.join(''));
    } catch (error) {
      if (length > 4000000) throw error;
      throw new Error('draw.io 压缩页无法解码，请粘贴完整文件或未压缩 XML。');
    }
  }

  function parseDrawioPages(source) {
    let xml = String(source || '').replace(/^\uFEFF/, '').trim();
    if (xml.length > 4000000) throw new Error('draw.io 文件超过 4 MB，请拆分图表。');
    if (/^&lt;\s*(?:mxgraphmodel|mxfile)\b/i.test(xml)) {
      const text = document.createElement('textarea');
      text.innerHTML = xml;
      xml = text.value.trim();
    }
    const doc = parseXml(xml);
    const root = doc.documentElement;
    if (root.tagName.toLowerCase() === 'mxgraphmodel') return [{ name: '', doc }];
    if (root.tagName.toLowerCase() !== 'mxfile') throw new Error('draw.io 需要 mxGraphModel 或 mxfile 根节点。');
    const pages = [...root.children].filter((child) => child.tagName.toLowerCase() === 'diagram');
    if (!pages.length) throw new Error('draw.io 文件中没有 diagram 页面。');
    if (pages.length > 30) throw new Error('draw.io 超过 30 页，请拆分文件。');
    let total = 0;
    return pages.map((page, index) => {
      const model = [...page.children].find((child) => child.tagName.toLowerCase() === 'mxgraphmodel');
      let body = model ? new XMLSerializer().serializeToString(model) : page.textContent.trim();
      if (!body) throw new Error(`draw.io 第 ${index + 1} 页为空。`);
      if (!body.startsWith('<')) body = inflateDiagram(body);
      total += body.length;
      if (total > 8000000) throw new Error('draw.io 页面总内容超过 8 MB，请拆分文件。');
      const modelDoc = parseXml(body);
      if (modelDoc.documentElement.tagName.toLowerCase() !== 'mxgraphmodel') throw new Error(`draw.io 第 ${index + 1} 页不是 mxGraphModel。`);
      return { name: page.getAttribute('name') || `第 ${index + 1} 页`, doc: modelDoc };
    });
  }

  function createController({ loadScript }) {
    let generation = 0;
    let jobs = [];
    let charts = [];
    let workers = new Set();
    let observer;
    let observedRoot;
    const load = async (name) => {
      const [url, ready] = libraries[name];
      await loadScript(url, ready, `${name} 加载失败，请检查网络后重试。`);
    };
    const dispose = () => {
      generation++;
      observer?.disconnect();
      observedRoot?.removeEventListener('toggle', resize, true);
      charts.forEach(({ chart }) => chart.dispose());
      charts = [];
      [...workers].forEach((cancel) => cancel());
      workers = new Set();
      jobs = [];
    };
    const resize = () => {
      charts.forEach(({ chart, capture }) => {
        if (capture.getBoundingClientRect().width > 0) chart.resize();
      });
    };
    const graphviz = (source) => new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl);
      const finish = (error, result) => {
        clearTimeout(timeout);
        worker.terminate();
        workers.delete(cancel);
        if (error) reject(error); else resolve(result);
      };
      const cancel = () => finish(new Error('图表渲染已取消。'));
      const timeout = setTimeout(() => finish(new Error('Graphviz 渲染超过 15 秒，请简化图表。')), 15000);
      workers.add(cancel);
      worker.onerror = () => finish(new Error('Graphviz Worker 加载或执行失败，请检查网络。'));
      worker.onmessage = (event) => event.data.error ? finish(new Error(event.data.error)) : finish(null, event.data.svg);
      worker.postMessage(source);
    });
    const render = (root) => {
      const version = generation;
      const active = (host) => version === generation && root.contains(host);
      let count = 0;
      for (const code of root.querySelectorAll('pre > code')) {
        const type = /(?:^|\s)(?:language|lang)-(echarts|graphviz|dot|plantuml|puml)(?:\s|$)/i.exec(code.className)?.[1].toLowerCase();
        if (!type || code.closest('.md-diagram')) continue;
        const source = code.textContent;
        const host = document.createElement('figure');
        host.className = `md-diagram md-diagram-${type}`;
        host.dataset.diagramState = 'loading';
        const capture = document.createElement('div');
        capture.className = 'md-diagram-capture';
        const status = document.createElement('p');
        status.className = 'md-diagram-status';
        status.setAttribute('role', 'status');
        status.textContent = '图表渲染中…';
        const details = document.createElement('details');
        details.className = 'md-diagram-source';
        const summary = document.createElement('summary');
        summary.textContent = `查看 ${type} 原始语法`;
        details.append(summary);
        const pre = code.parentElement;
        pre.replaceWith(host);
        details.append(pre);
        host.append(status, capture, details);
        if (type === 'plantuml' || type === 'puml') {
          host.dataset.diagramState = 'unsupported';
          status.textContent = 'PlantUML 暂不渲染：不会自动将文档发送到公共服务器。请先导出 PNG/SVG 后插入。';
          continue;
        }
        const job = (async () => {
          try {
            if (++count > 20) throw new Error('每篇最多同时渲染 20 个 ECharts/Graphviz 图表。');
            if (type === 'echarts') {
              await Promise.all([load('json5'), load('echarts')]);
              if (!active(host)) return;
              const option = parseEchartsOption(source);
              const chart = window.echarts.init(capture, null, { renderer: 'svg', height: 360 });
              charts.push({ chart, capture });
              chart.setOption(option);
            } else {
              if (source.length > 100000) throw new Error('DOT 内容超过 100 KB 限制。');
              const svg = await graphviz(source);
              if (!active(host)) return;
              capture.innerHTML = window.DOMPurify.sanitize(svg, {
                USE_PROFILES: { svg: true, svgFilters: true },
                FORBID_TAGS: ['foreignObject', 'a', 'image', 'style', 'animate', 'set'],
              });
              if (!capture.querySelector('svg')) throw new Error('Graphviz 未生成有效 SVG。');
            }
            if (!active(host)) return;
            host.dataset.diagramState = 'ready';
            status.hidden = true;
          } catch (error) {
            if (!active(host)) return;
            host.dataset.diagramState = 'error';
            capture.replaceChildren();
            status.textContent = String(error.message || error);
            status.classList.add('is-error');
          }
        })();
        jobs.push(job);
      }
      observedRoot = root;
      root.addEventListener('toggle', resize, true);
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(resize);
        observer.observe(root);
      }
    };
    return {
      dispose, render,
      loadDrawioDecoder: () => load('pako'),
      async waitForReady(root) {
        const version = generation;
        let timeout;
        try {
          await Promise.race([Promise.all(jobs), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('图表仍在加载，请稍后再导出。')), 20000);
          })]);
        } finally { clearTimeout(timeout); }
        if (version !== generation) throw new Error('内容已更新，请等待预览完成后重新导出。');
        if (root.querySelector('.md-diagram[data-diagram-state="error"]')) throw new Error('存在未成功渲染的图表，请先修正图表语法再导出。');
      },
    };
  }

  window.DiagramRenderer = { parseEchartsOption, parseDrawioPages, createController };
}());
