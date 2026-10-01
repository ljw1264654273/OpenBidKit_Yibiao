import assert from 'node:assert/strict';
import test from 'node:test';
// Node 类型擦除运行器需要显式扩展名。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { renderMarkdownHtml } from './renderMarkdownHtml.ts';

const table = '<table><tbody><tr><td><p>设备</p></td><td><p>拟投入数量</p></td></tr><tr><td>无人机</td><td>1台</td></tr></tbody></table>';

test('文档表格预览在关闭通用 HTML 时保留导入表格和前后 Markdown', () => {
  const html = renderMarkdownHtml(`## 设备投入\n\n${table}\n\n- 按实际需求配置`, { allowRawHtml: false, allowHtmlTables: true });
  assert.ok(html.includes(table));
  assert.match(html, /<h2>设备投入<\/h2>/);
  assert.match(html, /<li>按实际需求配置<\/li>/);
  assert.doesNotMatch(html, /&lt;table&gt;/);
});

test('文档表格支持多行和合并单元格，表格后正文继续按 Markdown 解析', () => {
  const source = '<table>\n<tbody>\n<tr><td rowspan="2">测量组</td><td colspan="2">设备配置</td></tr>\n<tr><td>无人机</td><td>1台</td></tr>\n</tbody>\n</table>\n## 后续内容';
  const html = renderMarkdownHtml(source, { allowHtmlTables: true });
  assert.match(html, /<td rowspan="2">测量组<\/td>/);
  assert.match(html, /<td colspan="2">设备配置<\/td>/);
  assert.match(html, /<h2>后续内容<\/h2>/);
});

test('表格兼容只在显式开启时生效', () => {
  assert.match(renderMarkdownHtml(table), /&lt;table&gt;/);
  assert.ok(renderMarkdownHtml(table, { allowHtmlTables: true }).includes(table));
  assert.match(renderMarkdownHtml(table), /&lt;table&gt;/);
});

test('表格兼容不把代码示例、缩进代码和其他原始 HTML 当成表格', () => {
  for (const source of [`\`\`\`html\n${table}\n\`\`\``, `    ${table}`]) {
    const html = renderMarkdownHtml(source, { allowHtmlTables: true });
    assert.match(html, /<pre><code/);
    assert.match(html, /&lt;table&gt;/);
  }
  const html = renderMarkdownHtml('<div>普通 HTML</div>', { allowHtmlTables: true });
  assert.match(html, /&lt;div&gt;普通 HTML&lt;\/div&gt;/);
});

test('未闭合表格继续显示原文', () => {
  assert.match(renderMarkdownHtml('<table><tr><td>设备</td></tr>', { allowHtmlTables: true }), /&lt;table&gt;/);
});
