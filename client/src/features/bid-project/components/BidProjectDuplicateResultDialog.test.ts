import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('改写工作区不重复展示整段原文，并为草稿提供明确标签', async () => {
  const dialog = await readFile(new URL('./BidProjectDuplicateResultDialog.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(dialog, /bid-project-rewrite-preview/);
  assert.doesNotMatch(dialog, /<span>当前目标原文<\/span>/);
  assert.doesNotMatch(dialog, /<span>参考文本<\/span>/);
  assert.match(dialog, /<span>改写后文本<\/span>[\s\S]*<textarea/);
  assert.match(dialog, /另一侧仅用于帮助 AI 识别重复表达，不会被修改/);
});

test('AI 改写请求携带当前重复组识别出的完整重复句', async () => {
  const ipc = await readFile(
    new URL('../../../../electron/ipc/bidProjectIpc.cjs', import.meta.url),
    'utf8',
  );

  assert.match(ipc, /exactSentences:\s*match\.exactSentences/);
});
