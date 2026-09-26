const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, relativePath), 'utf8');

test('技术方案 IPC 注册四个正文 AI 编辑通道', () => {
  const source = read('technicalPlanIpc.cjs');
  for (const channel of [
    'technical-plan:ai-edit-content',
    'technical-plan:generate-inline-image',
    'technical-plan:import-inline-image',
    'technical-plan:release-inline-image-candidate',
  ]) {
    assert.match(source, new RegExp(`ipcMain\\.handle\\(['"]${channel}['"]`), channel);
  }
  assert.match(source, /contentAiEditService\.aiEditContent/);
  assert.match(source, /contentAiEditService\.generateInlineImage/);
  assert.match(source, /contentAiEditService\.importInlineImage/);
  assert.match(source, /contentAiEditService\.releaseInlineImageCandidate/);
});

test('preload 和 Renderer 类型暴露正文 AI 编辑协议', () => {
  const preload = read('../preload.cjs');
  const types = read('../../src/shared/types/ipc.ts');
  for (const method of [
    'aiEditContent',
    'generateInlineImage',
    'importInlineImage',
    'releaseInlineImageCandidate',
  ]) {
    assert.match(preload, new RegExp(`${method}:`), method);
    assert.match(types, new RegExp(`${method}:`), method);
  }
  assert.match(types, /interface ContentAiEditRequest/);
  assert.match(types, /interface InlineImageCandidate/);
});
