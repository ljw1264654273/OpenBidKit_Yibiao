import test from 'node:test';
import assert from 'node:assert/strict';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { applyContentAiTextCandidate, createContentAiEditSnapshot, createContentLengthEditSnapshot, findProtectedContentRanges, findProtectedInlineImageRanges, insertInlineImageBlock, selectionIntersectsProtectedRange, validateContentAiEditSnapshot } from './contentAiEdit.ts';

test('选区改写只替换选中的字符', () => {
  const content = '项目团队将定期沟通进展，及时处理问题。';
  const start = content.indexOf('定期');
  const end = content.indexOf('，及时');
  const snapshot = createContentAiEditSnapshot({
    nodeId: '4.2',
    content,
    selectionStart: start,
    selectionEnd: end,
    surface: 'inline',
  });

  const result = applyContentAiTextCandidate({
    currentNodeId: '4.2',
    currentContent: content,
    snapshot,
    mode: 'rewrite',
    candidateText: '每周组织项目例会',
  });

  assert.equal(result.content, '项目团队将每周组织项目例会，及时处理问题。');
  assert.deepEqual(result.selection, {
    start,
    end: start + '每周组织项目例会'.length,
  });
});

test('光标续写在当前位置插入独立段落并移动光标', () => {
  const content = '第一段。\n\n第三段。';
  const offset = content.indexOf('第三段');
  const snapshot = createContentAiEditSnapshot({
    nodeId: '4.2',
    content,
    selectionStart: offset,
    selectionEnd: offset,
    surface: 'inline',
  });

  const result = applyContentAiTextCandidate({
    currentNodeId: '4.2',
    currentContent: content,
    snapshot,
    mode: 'continue',
    candidateText: '第二段。',
  });

  assert.equal(result.content, '第一段。\n\n第二段。\n\n第三段。');
  assert.deepEqual(result.selection, {
    start: '第一段。\n\n第二段。'.length,
    end: '第一段。\n\n第二段。'.length,
  });
});

test('草稿变化后拒绝应用旧候选', () => {
  const snapshot = createContentAiEditSnapshot({
    nodeId: '4.2',
    content: '原正文',
    selectionStart: 0,
    selectionEnd: 1,
    surface: 'inline',
  });

  assert.deepEqual(validateContentAiEditSnapshot({
    currentNodeId: '4.2',
    currentContent: '已变化正文',
    snapshot,
  }), {
    valid: false,
    message: '正文已发生变化，请重新选择位置并生成',
  });
});

test('识别手工插图保护块并拒绝交叉选区', () => {
  const content = [
    '前文。',
    '<!-- yibiao-inline-image:start id="img-1" -->',
    '![实施图](yibiao-asset://generated-images/test.png)',
    '',
    '*<!-- yibiao-figure-caption -->实施图*',
    '<!-- yibiao-inline-image:end -->',
    '后文。',
  ].join('\n');
  const ranges = findProtectedInlineImageRanges(content);

  assert.equal(ranges.length, 1);
  assert.equal(content.slice(ranges[0].start, ranges[0].end).includes('实施图'), true);
  assert.equal(selectionIntersectsProtectedRange({
    start: ranges[0].start - 2,
    end: ranges[0].start + 2,
  }, ranges), true);
  assert.equal(selectionIntersectsProtectedRange({ start: 0, end: 2 }, ranges), false);
});

test('手工图片块插入光标位置并保留图题', () => {
  const content = '前文。\n\n后文。';
  const offset = content.indexOf('后文');
  const result = insertInlineImageBlock({
    content,
    insertionOffset: offset,
    markdown: [
      '<!-- yibiao-inline-image:start id="img-1" -->',
      '![实施阶段图](yibiao-asset://generated-images/test.png)',
      '',
      '*<!-- yibiao-figure-caption -->实施阶段图*',
      '<!-- yibiao-inline-image:end -->',
    ].join('\n'),
  });

  assert.match(result.content, /^前文。\n\n<!-- yibiao-inline-image:start/);
  assert.match(result.content, /<!-- yibiao-inline-image:end -->\n\n后文。$/);
  assert.equal(result.selection.start, result.selection.end);
});

test('扩写和缩写有选区时处理选区，无选区时处理整章', () => {
  const content = '第一段内容。\n\n第二段内容。';
  const selected = createContentLengthEditSnapshot({
    nodeId: '5.1',
    content,
    selectionStart: 0,
    selectionEnd: 6,
    surface: 'inline',
  });
  const whole = createContentLengthEditSnapshot({
    nodeId: '5.1',
    content,
    selectionStart: 4,
    selectionEnd: 4,
    surface: 'inline',
  });

  assert.equal(selected.selectedText, '第一段内容。');
  assert.equal(whole.selectedText, content);
  assert.equal(whole.selectionStart, 0);
  assert.equal(whole.selectionEnd, content.length);

  const expanded = applyContentAiTextCandidate({
    currentNodeId: '5.1',
    currentContent: content,
    snapshot: selected,
    mode: 'expand',
    candidateText: '第一段扩写后的实施内容。',
  });
  const shortened = applyContentAiTextCandidate({
    currentNodeId: '5.1',
    currentContent: content,
    snapshot: whole,
    mode: 'shrink',
    candidateText: '精简后的整章。',
  });

  assert.equal(expanded.content, '第一段扩写后的实施内容。\n\n第二段内容。');
  assert.equal(shortened.content, '精简后的整章。');
});

test('选区扩缩写拒绝内联图片、普通 Markdown 图片或 Mermaid，整章范围仍可交给服务保护', () => {
  const content = [
    '前文。',
    '<!-- yibiao-inline-image:start id="img-1" -->',
    '![实施图](yibiao-asset://generated-images/test.png)',
    '<!-- yibiao-inline-image:end -->',
    '![现场照片](https://example.com/site_(1).png)',
    '```mermaid',
    'flowchart LR',
    'A --> B',
    '```',
    '后文。',
  ].join('\n');
  const ranges = findProtectedContentRanges(content);
  assert.equal(ranges.length, 3);
  assert.equal(content.slice(ranges[1].start, ranges[1].end), '![现场照片](https://example.com/site_(1).png)');
  assert.throws(() => createContentLengthEditSnapshot({
    nodeId: '5.1',
    content,
    selectionStart: ranges[1].start,
    selectionEnd: ranges[1].end,
    surface: 'inline',
  }), /图片或 Mermaid/);
  assert.throws(() => createContentLengthEditSnapshot({
    nodeId: '5.1',
    content,
    selectionStart: ranges[2].start,
    selectionEnd: ranges[2].end,
    surface: 'inline',
  }), /图片或 Mermaid/);

  const whole = createContentLengthEditSnapshot({
    nodeId: '5.1',
    content,
    selectionStart: 0,
    selectionEnd: 0,
    surface: 'inline',
  });
  assert.equal(whole.selectedText, content);
});
