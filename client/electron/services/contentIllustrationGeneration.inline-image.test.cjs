const assert = require('node:assert/strict');
const test = require('node:test');
const {
  stripGeneratedIllustrationsFromDocument,
} = require('./contentIllustrationGeneration.cjs');

test('automatic illustration stripping preserves manually inserted inline image blocks', () => {
  const inlineBlock = [
    '<!-- yibiao-inline-image:start id="inline-1" -->',
    '![现场部署图](yibiao-asset://generated-images/technical-plan/illustrations/inline-candidates/inline-1.png)',
    '',
    '*<!-- yibiao-figure-caption -->现场部署图*',
    '<!-- yibiao-inline-image:end -->',
  ].join('\n');
  const generatedBlock = [
    '<!-- yibiao-illustration:start id="generated-1" -->',
    '![自动配图](yibiao-asset://generated-images/generated-1.png)',
    '<!-- yibiao-illustration:end -->',
  ].join('\n');
  const content = `正文。\n\n${inlineBlock}\n\n${generatedBlock}`;

  const result = stripGeneratedIllustrationsFromDocument({
    outline: [{ id: '1.1', title: '实施方案', content }],
  }, {
    '1.1': { id: '1.1', status: 'success', content },
  });

  assert.match(result.sections['1.1'].content, /yibiao-inline-image:start/);
  assert.match(result.sections['1.1'].content, /现场部署图/);
  assert.doesNotMatch(result.sections['1.1'].content, /yibiao-illustration:start/);
  assert.match(result.outlineData.outline[0].content, /yibiao-inline-image:end/);
});
