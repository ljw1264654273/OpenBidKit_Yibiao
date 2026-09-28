const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

const typesSource = readSource('types.ts');
const pageSource = readSource('pages/GlobalFactsPage.tsx');
const homeSource = readSource('pages/TechnicalPlanHome.tsx');
const workflowSource = readSource('hooks/useTechnicalPlanWorkflow.ts');

test('Renderer 只公开标准模式和严谨模式', () => {
  assert.match(typesSource, /export type GlobalFactsMode = 'omit' \| 'placeholder';/);
  assert.match(pageSource, /value:\s*'omit',[\s\S]*?title:\s*'标准模式'/);
  assert.match(pageSource, /value:\s*'placeholder',[\s\S]*?title:\s*'严谨模式'/);
  assert.doesNotMatch(pageSource, /value:\s*'fabricate'/);
  assert.doesNotMatch(pageSource, /胡咧咧模式|别招欠模式|放着我来模式/);
});

test('两个模式说明直接描述缺失事实的处理方式', () => {
  assert.match(pageSource, /description: '保留与正文相关的事实项。参考材料未提供具体值时，改写为符合招标要求的通用承诺，不编造人员姓名、时间、地点、业绩、证书、规格型号或实施细节；正文阶段继续使用通用表述。'/);
  assert.match(pageSource, /description: '保留与正文相关的事实项。参考材料未提供具体值时，将该项标记为【待填写】；正文阶段遇到不确定内容也使用【待填写】，用户需要在生成后补充填写。'/);
});

test('页面、主页和工作流均将非 placeholder 值归一化为 omit', () => {
  assert.match(pageSource, /function normalizeGlobalFactsMode\([\s\S]*?return value === 'placeholder' \? 'placeholder' : 'omit';[\s\S]*?\}/);
  assert.match(homeSource, /globalFactsMode:\s*'omit' as GlobalFactsMode/);
  assert.match(homeSource, /globalFactsMode=\{state\.globalFactsMode \|\| 'omit'\}/);
  assert.match(workflowSource, /globalFactsMode:\s*'omit'/);
  assert.match(workflowSource, /function normalizeGlobalFactsMode\([\s\S]*?return value === 'placeholder' \? 'placeholder' : 'omit';[\s\S]*?\}/);
  assert.match(workflowSource, /globalFactsMode:\s*normalizeGlobalFactsMode\(cachedState\.globalFactsMode\)/);
});
