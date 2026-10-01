import MarkdownIt from 'markdown-it';
import markdownItCjkFriendly from 'markdown-it-cjk-friendly';
import markdownItTaskLists from 'markdown-it-task-lists';

export interface RenderMarkdownHtmlOptions {
  allowRawHtml?: boolean;
  allowHtmlTables?: boolean;
  enableGfm?: boolean;
}

const rendererCache = new Map<string, MarkdownIt>();

function createMarkdownRenderer(options: Required<RenderMarkdownHtmlOptions>): MarkdownIt {
  const renderer = new MarkdownIt(options.enableGfm ? 'default' : 'commonmark', {
    html: options.allowRawHtml,
    linkify: false,
    typographer: false,
    breaks: false,
  });

  renderer.use(markdownItCjkFriendly);
  // Word 导入的表格可能保留 HTML；单独识别表格，不开启其他原始 HTML。
  if (options.allowHtmlTables && !options.allowRawHtml) {
    renderer.block.ruler.before('html_block', 'document_table', (state, startLine, endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      const start = state.bMarks[startLine] + state.tShift[startLine];
      if (!/^<table(?=\s|>)/i.test(state.src.slice(start, state.eMarks[startLine]))) return false;
      let depth = 0;
      for (let line = startLine; line < endLine; line++) {
        if (state.sCount[line] < state.blkIndent && !state.isEmpty(line)) return false;
        const text = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
        for (const tag of text.matchAll(/<\/?table\b[^>]*>/gi)) depth += /^<\//.test(tag[0]) ? -1 : 1;
        if (depth !== 0 || !/<\/table\s*>\s*$/i.test(text)) continue;
        if (silent) return true;
        const token = state.push('html_block', '', 0);
        token.map = [startLine, line + 1];
        token.content = state.getLines(startLine, line + 1, state.blkIndent, true);
        state.line = line + 1;
        return true;
      }
      return false;
    }, { alt: ['paragraph', 'reference', 'blockquote'] });
  }
  if (options.enableGfm) {
    renderer.use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true });
  }

  return renderer;
}

function getMarkdownRenderer(options: RenderMarkdownHtmlOptions = {}): MarkdownIt {
  const normalized: Required<RenderMarkdownHtmlOptions> = {
    allowRawHtml: options.allowRawHtml === true,
    allowHtmlTables: options.allowHtmlTables === true,
    enableGfm: options.enableGfm !== false,
  };
  const cacheKey = `${normalized.allowRawHtml ? 'html' : 'no-html'}:${normalized.allowHtmlTables ? 'tables' : 'no-tables'}:${normalized.enableGfm ? 'gfm' : 'commonmark'}`;
  const cached = rendererCache.get(cacheKey);
  if (cached) return cached;

  const renderer = createMarkdownRenderer(normalized);
  rendererCache.set(cacheKey, renderer);
  return renderer;
}

export function renderMarkdownHtml(content: string, options: RenderMarkdownHtmlOptions = {}): string {
  return getMarkdownRenderer(options).render(String(content || ''));
}
