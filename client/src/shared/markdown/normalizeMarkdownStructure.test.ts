import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOrderedListMarkers } from './normalizeMarkdownStructure';

test('nested ordered lists restart at one for each parent list item', () => {
  assert.equal(
    normalizeOrderedListMarkers([
      '4. 一级分项',
      '   7. 二级分项',
      '   8. 另一个二级分项',
      '5. 另一个一级分项',
      '   9. 新的二级分项',
    ].join('\n')),
    [
      '1. 一级分项',
      '   1. 二级分项',
      '   2. 另一个二级分项',
      '2. 另一个一级分项',
      '   1. 新的二级分项',
    ].join('\n'),
  );
});

test('fenced code ordered markers remain unchanged', () => {
  const source = ['```text', '4. 代码示例', '```', '1. 正文'].join('\n');
  assert.equal(
    normalizeOrderedListMarkers(source),
    ['```text', '4. 代码示例', '```', '1. 正文'].join('\n'),
  );
});
