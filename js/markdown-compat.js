(function () {
  'use strict';

  const tocMarker = /^(?:\[toc\]|\[\[toc\]\]|\[\[_toc_\]\])$/i;
  const calloutAliases = {
    note: 'note', info: 'info', todo: 'info', abstract: 'info', summary: 'info', tldr: 'info',
    tip: 'tip', hint: 'tip', important: 'important', success: 'success', check: 'success', done: 'success',
    question: 'question', help: 'question', faq: 'question', warning: 'warning', attention: 'warning',
    caution: 'caution', danger: 'danger', error: 'danger', failure: 'danger', fail: 'danger',
    missing: 'danger', bug: 'danger', example: 'example', quote: 'quote', cite: 'quote',
  };

  function headingAttributes(state) {
    if (state.inlineMode) return;
    for (let i = 0; i < state.tokens.length; i++) {
      const heading = state.tokens[i];
      const inline = state.tokens[i + 1];
      if (heading.type !== 'heading_open' || inline?.type !== 'inline') continue;
      const match = /\s+\{([^{}]+)\}\s*$/.exec(inline.content);
      if (!match) continue;
      const attributes = match[1].trim().split(/\s+/);
      // Only IDs and classes are accepted, never arbitrary HTML/event attributes.
      if (!attributes.every((attr) => /^[#.][\p{L}\p{N}_][\p{L}\p{N}_.:-]*$/u.test(attr))) continue;
      const ids = attributes.filter((attr) => attr[0] === '#');
      if (ids.length > 1) continue;
      if (ids.length) heading.attrSet('id', ids[0].slice(1));
      const classes = attributes.filter((attr) => attr[0] === '.').map((attr) => attr.slice(1));
      if (classes.length) heading.attrJoin('class', classes.join(' '));
      if (classes.some((name) => /^(?:no_toc|notoc|no-toc)$/i.test(name))) heading.attrSet('data-no-toc', '1');
      inline.content = inline.content.slice(0, match.index);
    }
  }

  function callouts(state) {
    if (state.inlineMode) return;
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      if (open.type !== 'blockquote_open' || tokens[i + 1]?.type !== 'paragraph_open'
        || tokens[i + 2]?.type !== 'inline') continue;
      const inline = tokens[i + 2];
      const match = /^\[!([\w-]+)\]([+-]?)(?:[ \t]+([^\n]*))?(?:\n|$)/.exec(inline.content);
      if (!match) continue;
      let depth = 1;
      let end = i + 1;
      for (; end < tokens.length; end++) {
        if (tokens[end].type === 'blockquote_open') depth++;
        if (tokens[end].type === 'blockquote_close' && --depth === 0) break;
      }
      if (end === tokens.length) continue;
      const type = match[1].toLowerCase();
      open.type = 'callout_open';
      open.tag = match[2] ? 'details' : 'aside';
      open.attrJoin('class', `md-callout md-callout-${calloutAliases[type] || 'note'}`);
      open.meta = { title: match[3] || type.toUpperCase(), foldable: !!match[2] };
      if (match[2] === '+') open.attrSet('open', '');
      tokens[end].type = 'callout_close';
      tokens[end].tag = open.tag;
      inline.content = inline.content.slice(match[0].length);
      if (!inline.content) tokens.splice(i + 1, 3);
      // Title tokens participate in the document's normal inline pass. Calling
      // renderInline here would run core plugins again and duplicate footnotes.
      const titleTag = open.meta.foldable ? 'summary' : 'p';
      const titleOpen = new state.Token('callout_title_open', titleTag, 1);
      titleOpen.attrSet('class', 'md-callout-title');
      const titleInline = new state.Token('inline', '', 0);
      titleInline.content = open.meta.title;
      titleInline.children = [];
      const titleClose = new state.Token('callout_title_close', titleTag, -1);
      tokens.splice(i + 1, 0, titleOpen, titleInline, titleClose);
    }
  }

  function frontMatter(state, startLine, endLine, silent) {
    if (startLine !== 0 || state.blkIndent !== 0 || state.parentType !== 'root') return false;
    const first = state.src.slice(state.bMarks[0], state.eMarks[0]);
    if (first !== '---' && first !== '+++') return false;
    let nextLine = 1;
    while (nextLine < endLine) {
      const line = state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]);
      if (line === first || (first === '---' && line === '...')) break;
      nextLine++;
    }
    if (nextLine === endLine) return false;
    const content = state.getLines(1, nextLine, 0, false);
    // A leading horizontal rule or Setext heading is not metadata.
    const property = first === '---' ? /^[\p{L}\p{N}_.'"-]+\s*:/mu : /^[\p{L}\p{N}_.'"-]+\s*=/mu;
    if (!property.test(content)) return false;
    if (silent) return true;
    const token = state.push('front_matter', '', 0);
    token.content = content;
    token.info = first === '---' ? 'YAML' : 'TOML';
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  }

  function tocBlock(state, startLine, endLine, silent) {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trim();
    if (!tocMarker.test(line)) return false;
    // A defined reference named TOC remains a normal Markdown link.
    const references = state.env.references || {};
    if (references.TOC || references._TOC_) return false;
    if (silent) return true;
    const token = state.push('toc_placeholder', '', 0);
    token.content = line;
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }

  function mathInline(state, silent) {
    const start = state.pos;
    let delimiter;
    if (state.src.startsWith('\\(', start)) delimiter = ['\\(', '\\)', false];
    else if (state.src.startsWith('\\[', start)) delimiter = ['\\[', '\\]', true];
    else if (state.src[start] === '$') {
      const double = state.src[start + 1] === '$';
      delimiter = double ? ['$$', '$$', true] : ['$', '$', false];
      if (!double && (/\s/.test(state.src[start + 1] || ' ') || /[\d\\]/.test(state.src[start - 1] || ''))) return false;
    } else return false;
    const contentStart = start + delimiter[0].length;
    let searchMax = state.posMax;
    if (!delimiter[2]) {
      if (state.mdMathLineEnd === undefined || start >= state.mdMathLineEnd) {
        const newline = state.src.indexOf('\n', start);
        state.mdMathLineEnd = newline < 0 ? state.src.length : newline;
      }
      searchMax = Math.min(searchMax, state.mdMathLineEnd);
    }
    const cacheKey = delimiter[1] + ':' + searchMax;
    state.mdMathNoEnd ??= new Map();
    const noEndAt = state.mdMathNoEnd.get(cacheKey);
    if (noEndAt !== undefined && start >= noEndAt) return false;
    state.mdMathNextEnd ??= new Map();
    const findEnd = (from) => {
      const cached = state.mdMathNextEnd.get(delimiter[1]);
      if (cached && from >= cached.from && (cached.end < 0 || from <= cached.end)) return cached.end;
      const end = state.src.indexOf(delimiter[1], from);
      state.mdMathNextEnd.set(delimiter[1], { from, end });
      return end;
    };
    let end = contentStart;
    while ((end = findEnd(end)) !== -1 && end < searchMax) {
      let slashes = 0;
      for (let i = end - 1; i >= contentStart && state.src[i] === '\\'; i--) slashes++;
      if (slashes % 2 || (delimiter[1] === '$' && state.src[end + 1] === '$')) { end++; continue; }
      if (delimiter[1] === '$' && (/\s/.test(state.src[end - 1] || ' ') || /\d/.test(state.src[end + 1] || ''))) return false;
      break;
    }
    if (end === -1 || end + delimiter[1].length > searchMax) {
      state.mdMathNoEnd.set(cacheKey, start);
      return false;
    }
    if (end === contentStart) return false;
    const content = state.src.slice(contentStart, end);
    if (!delimiter[2] && content.includes('\n')) return false;
    // Link-label lookahead runs before posMax is narrowed to the label. Never
    // skip a closing link bracket while searching for an unmatched math end.
    if (silent && /(?<!\\)\]\s*(?:\(|\[)/.test(content)) return false;
    if (!silent) {
      const token = state.push('math_inline', '', 0);
      token.content = content;
      token.meta = { display: delimiter[2] };
    }
    state.pos = end + delimiter[1].length;
    return true;
  }

  function mathBlock(state, startLine, endLine, silent) {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trim();
    const delimiter = line === '$$' ? '$$' : line === '\\[' ? '\\]' : '';
    if (!delimiter) return false;
    const cacheKey = `${delimiter}:${endLine}:${state.blkIndent}`;
    state.mdMathNoBlockEnd ??= new Map();
    if ((state.mdMathNoBlockEnd.get(cacheKey) ?? Infinity) <= startLine) return false;
    let nextLine = startLine + 1;
    while (nextLine < endLine) {
      const text = state.src.slice(state.bMarks[nextLine] + state.tShift[nextLine], state.eMarks[nextLine]).trim();
      if (state.sCount[nextLine] < state.blkIndent && text) return false;
      if (text === delimiter) break;
      nextLine++;
    }
    if (nextLine === endLine) { state.mdMathNoBlockEnd.set(cacheKey, startLine); return false; }
    if (silent) return true;
    const token = state.push('math_block', '', 0);
    token.content = state.getLines(startLine + 1, nextLine, state.blkIndent, false).trim();
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  }

  function legacyImage(state, silent) {
    const match = /^\[\[img:([^\]\n]+)\]\]/i.exec(state.src.slice(state.pos));
    if (!match || state.pos + match[0].length > state.posMax) return false;
    const src = state.md.normalizeLink(match[1].trim());
    if (!state.md.validateLink(src)) return false;
    if (!silent) {
      const token = state.push('image', 'img', 0);
      token.attrs = [['src', src], ['alt', '']];
      token.children = [];
    }
    state.pos += match[0].length;
    return true;
  }

  function linkTitle(state, silent) {
    if (state.pending || state.tokens.at(-1)?.type !== 'link_close') return false;
    const match = /^\{:\s*title\s*=\s*(?:"([^"]*)"|'([^']*)')\s*\}/.exec(state.src.slice(state.pos));
    if (!match || state.pos + match[0].length > state.posMax) return false;
    if (!silent) {
      for (let i = state.tokens.length - 2; i >= 0; i--) {
        if (state.tokens[i].type === 'link_open') {
          state.tokens[i].attrSet('title', match[1] ?? match[2]);
          break;
        }
      }
    }
    state.pos += match[0].length;
    return true;
  }

  function install(md, { container, normalizeSequence, normalizeFlow } = {}) {
    const image = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, idx, options, env, renderer) => {
      const token = tokens[idx];
      // MWeb: ![description-w140](url). Match the terminal modifier only;
      // leave code, normal alt text and non-positive values untouched.
      const alt = renderer.renderInlineAsText(token.children || [], options, env);
      const width = /-w([1-9]\d{0,4})$/.exec(alt);
      if (width) {
        token.attrSet('width', width[1]);
        const cleanAlt = alt.slice(0, width.index);
        token.attrSet('alt', cleanAlt);
        return `<img${renderer.renderAttrs(token)}${options.xhtmlOut ? ' /' : ''}>`;
      }
      return image(tokens, idx, options, env, renderer);
    };
    for (const name of ['th_open', 'td_open']) {
      md.renderer.rules[name] = (tokens, idx, options, env, renderer) => {
        const token = tokens[idx];
        const alignment = /^text-align:(left|center|right)$/.exec(token.attrGet('style') || '');
        if (alignment) {
          token.attrSet('align', alignment[1]);
          token.attrs = token.attrs.filter(([attr]) => attr !== 'style');
        }
        return renderer.renderToken(tokens, idx, options);
      };
    }
    md.block.ruler.before('hr', 'front_matter', frontMatter);
    md.block.ruler.before('paragraph', 'toc_block', tocBlock, { alt: ['paragraph', 'blockquote', 'list'] });
    md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'blockquote', 'list'] });
    md.inline.ruler.before('escape', 'math_inline', mathInline);
    md.inline.ruler.before('link', 'legacy_image', legacyImage);
    md.inline.ruler.before('text', 'link_title', linkTitle);
    md.core.ruler.before('inline', 'heading_attributes', headingAttributes);
    md.core.ruler.before('inline', 'callouts', callouts);
    md.core.ruler.after('inline', 'toc_markers', (state) => {
      if (state.inlineMode) return;
      // References can be defined after their use; restore normal Markdown links
      // only after the entire block pass has collected all definitions.
      for (let i = 0; i < state.tokens.length; i++) {
        const token = state.tokens[i];
        if (token.type !== 'toc_placeholder' || !/^\[toc\]$/i.test(token.content)
          || !state.env.references?.TOC) continue;
        token.type = 'paragraph_open';
        token.tag = 'p';
        token.nesting = 1;
        const inline = new state.Token('inline', '', 0);
        inline.content = token.content;
        inline.children = [];
        state.md.inline.parse(inline.content, state.md, state.env, inline.children);
        const close = new state.Token('paragraph_close', 'p', -1);
        state.tokens.splice(i + 1, 0, inline, close);
      }
      for (let i = 0; i < state.tokens.length - 2; i++) {
        const [open, inline, close] = state.tokens.slice(i, i + 3);
        if (open.type !== 'paragraph_open' || inline.type !== 'inline' || close.type !== 'paragraph_close'
          || !tocMarker.test(inline.content.trim()) || inline.children.some((t) => t.type === 'link_open')) continue;
        open.type = 'toc_placeholder';
        open.tag = '';
        open.nesting = 0;
        state.tokens.splice(i + 1, 2);
      }
    });
    md.renderer.rules.toc_placeholder = () => '<nav class="md-toc" data-md-toc="1" aria-label="文档目录"></nav>\n';
    md.renderer.rules.front_matter = (tokens, idx) => {
      const token = tokens[idx];
      return `<details class="md-frontmatter"><summary>文档元数据（${token.info}）</summary><pre><code>${md.utils.escapeHtml(token.content)}</code></pre></details>\n`;
    };
    const mathMarkup = (content, block, display) => {
      const tag = block ? 'div' : 'span';
      return `<${tag} class="md-math" data-display="${display ? '1' : '0'}">${md.utils.escapeHtml(content)}</${tag}>${block ? '\n' : ''}`;
    };
    md.renderer.rules.math_inline = (tokens, idx) => mathMarkup(tokens[idx].content, false, tokens[idx].meta.display);
    md.renderer.rules.math_block = (tokens, idx) => mathMarkup(tokens[idx].content, true, true);
    const fence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, renderer) => {
      const token = tokens[idx];
      const type = token.info.trim().toLowerCase();
      if (type === 'math') return mathMarkup(token.content.trim(), true, true);
      const normalized = type === 'sequence' ? normalizeSequence?.(token.content)
        : type === 'flow' ? normalizeFlow?.(token.content) : '';
      if (!normalized) return fence(tokens, idx, options, env, renderer);
      return `<pre><code class="language-mermaid">${md.utils.escapeHtml(normalized)}\n</code></pre>\n`;
    };
    if (typeof container === 'function') {
      for (const type of ['details', 'collapse', 'info', 'note', 'tip', 'important', 'warning', 'caution', 'danger', 'success', 'question', 'example']) {
        md.use(container, type, {
          validate: (params) => params.trim() === type || params.trim().startsWith(type + ' '),
          render: (tokens, idx) => {
            const foldable = type === 'details' || type === 'collapse';
            const tag = foldable ? 'details' : 'aside';
            if (tokens[idx].nesting === -1) return `</${tag}>\n`;
            const title = tokens[idx].info.trim().slice(type.length).trim() || (foldable ? '详情' : type.toUpperCase());
            const className = foldable ? 'md-details' : `md-callout md-callout-${calloutAliases[type]}`;
            const titleTag = foldable ? 'summary' : 'p';
            return `<${tag} class="${className}"><${titleTag} class="md-callout-title">${md.utils.escapeHtml(title)}</${titleTag}>\n`;
          },
        });
      }
    }
  }

  function headingText(heading) {
    const clone = heading.cloneNode(true);
    clone.querySelectorAll('.katex').forEach((math) => {
      math.replaceWith(math.querySelector('annotation[encoding="application/x-tex"]')?.textContent || math.textContent);
    });
    clone.querySelectorAll('.footnote-ref').forEach((ref) => ref.remove());
    clone.querySelectorAll('img').forEach((img) => img.replaceWith(img.alt));
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  function slugify(text) {
    // Keep existing document anchors stable; the outline reuses exactly these IDs.
    return text.trim().toLowerCase().replace(/[\s\u00A0]+/g, '-')
      .replace(/[“”"'‘’]/g, '').replace(/[()（）\[\]【】{}<>《》]/g, '')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'section';
  }

  function ensureHeadingIds(root) {
    const headings = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const headingSet = new Set(headings);
    const used = new Set([...root.ownerDocument.querySelectorAll('[id]')].filter((el) => !headingSet.has(el)).map((el) => el.id));
    const suffixes = new Map();
    const allocate = (base) => {
      let id = base;
      let suffix = suffixes.get(base) || 1;
      while (used.has(id)) id = `${base}-${suffix++}`;
      suffixes.set(base, suffix);
      used.add(id);
      return id;
    };
    // Reserve explicit IDs before automatic slugs, including IDs declared later in the file.
    headings.filter((h) => h.id).forEach((h) => { h.id = allocate(h.id); });
    headings.filter((h) => !h.id).forEach((h) => { h.id = allocate(slugify(headingText(h))); });
    return headings.filter((h) => !h.hasAttribute('data-no-toc') && headingText(h));
  }

  function buildToc(headings, document) {
    const root = document.createElement('ol');
    const stack = [];
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1));
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      let list = root;
      if (stack.length) {
        const parent = stack.at(-1).item;
        list = parent.querySelector(':scope > ol');
        if (!list) { list = document.createElement('ol'); parent.appendChild(list); }
      }
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = '#' + encodeURIComponent(heading.id);
      link.dataset.headingId = heading.id;
      link.textContent = headingText(heading);
      item.appendChild(link);
      list.appendChild(item);
      stack.push({ level, item });
    }
    return root;
  }

  function renderMath(root, katex) {
    if (typeof katex?.render !== 'function') return;
    root.querySelectorAll('.md-math').forEach((node) => {
      if (node.closest('pre, code, .md-toc')) return;
      katex.render(node.textContent, node, { displayMode: node.dataset.display === '1', throwOnError: false, trust: false });
    });
  }

  function createOutline({ root, pane, panel, list, toggle }) {
    const document = root.ownerDocument;
    const window = document.defaultView;
    let headings = [];
    let links = [];
    let frame = 0;
    let userToggled = false;
    const setCollapsed = (collapsed) => {
      panel.classList.toggle('is-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.title = collapsed ? '展开目录' : '折叠目录';
      toggle.textContent = collapsed ? '目录 ☰' : '收起';
      document.getElementById('floating-toc-nav').hidden = collapsed;
    };
    const updatePosition = () => {
      const rect = pane.getBoundingClientRect();
      panel.style.top = `${rect.top + 12}px`;
      panel.style.right = `${Math.max(12, window.innerWidth - rect.right + 12)}px`;
      panel.style.setProperty('--toc-max-height', `${Math.max(80, rect.height - 24)}px`);
      if (!userToggled) setCollapsed(!document.body.classList.contains('wide-mode') || rect.width < 1000);
    };
    const updateActive = () => {
      frame = 0;
      const visible = headings.filter((h) => h.getClientRects().length);
      let active = visible[0];
      const threshold = pane.getBoundingClientRect().top + 40;
      for (const h of visible) {
        if (h.getBoundingClientRect().top <= threshold) active = h;
        else break;
      }
      for (const link of links) {
        if (link.dataset.headingId === active?.id) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(updateActive); };
    const navigate = (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || event.button || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      let id;
      try { id = decodeURIComponent(link.getAttribute('href').slice(1)); } catch { return; }
      const target = [...root.querySelectorAll('[id]')].find((node) => node.id === id);
      if (!target) return;
      event.preventDefault();
      for (let parent = target.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
      }
      pane.scrollTo({ top: pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 20,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      schedule();
    };
    toggle.addEventListener('click', () => { userToggled = true; setCollapsed(toggle.getAttribute('aria-expanded') === 'true'); });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { setCollapsed(true); toggle.focus(); }
    });
    list.addEventListener('click', navigate);
    root.addEventListener('click', navigate);
    root.addEventListener('toggle', schedule, true);
    pane.addEventListener('scroll', schedule, { passive: true });
    pane.addEventListener('transitionend', () => { updatePosition(); schedule(); });
    window.addEventListener('resize', () => { updatePosition(); schedule(); });
    return {
      update() {
        const allHeadings = ensureHeadingIds(root);
        headings = allHeadings.slice(0, 1000);
        list.replaceChildren(...buildToc(headings, document).childNodes);
        if (allHeadings.length > headings.length) {
          const notice = document.createElement('li');
          notice.textContent = '目录仅展示前 1000 个标题，请拆分长文。';
          list.appendChild(notice);
        }
        root.querySelectorAll('[data-md-toc]').forEach((placeholder, index) => {
          if (index >= 3) {
            placeholder.textContent = '正文最多展示 3 处目录，请使用右上角目录导航。';
            return;
          }
          const title = document.createElement('p');
          title.className = 'md-toc-title';
          title.textContent = headings.length ? (allHeadings.length > headings.length ? '目录（前 1000 个标题）' : '目录') : '暂无标题';
          placeholder.replaceChildren(title, buildToc(headings, document));
        });
        links = [...list.querySelectorAll('a'), ...root.querySelectorAll('.md-toc a')];
        panel.hidden = !headings.length;
        pane.classList.toggle('has-outline', !!headings.length);
        updatePosition();
        schedule();
      },
      refreshLayout() { updatePosition(); schedule(); },
    };
  }

  window.MarkdownCompat = { install, createOutline, ensureHeadingIds, renderMath, headingText };
}());
