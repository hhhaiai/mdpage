/* Graphviz runs off the UI thread; the caller terminates slow or obsolete jobs. */
let vizPromise;
self.onmessage = async (event) => {
  try {
    if (typeof event.data !== 'string' || event.data.length > 100000) throw new Error('DOT 内容超过 100 KB 限制。');
    if (!vizPromise) {
      importScripts('https://cdn.jsdelivr.net/npm/@viz-js/viz@3.31.0/dist/viz-global.js');
      vizPromise = Viz.instance();
    }
    const viz = await vizPromise;
    const svg = viz.renderString(event.data, { format: 'svg', engine: 'dot' });
    if (svg.length > 8000000) throw new Error('生成的图形过大，请拆分图表。');
    self.postMessage({ svg });
  } catch (error) {
    self.postMessage({ error: String(error.message || error) });
  }
};
