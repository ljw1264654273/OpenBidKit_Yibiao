import test from 'node:test';
import assert from 'node:assert/strict';
// Node 的类型擦除测试运行器需要显式扩展名，产品代码仍使用标准无扩展名导入。
// @ts-expect-error allowImportingTsExtensions 仅影响测试运行方式
import { applyContentAiTextCandidate, createContentAiEditSnapshot, findProtectedInlineImageRanges, insertInlineImageBlock, selectionIntersectsProtectedRange, validateContentAiEditSnapshot } from './contentAiEdit.ts';

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
