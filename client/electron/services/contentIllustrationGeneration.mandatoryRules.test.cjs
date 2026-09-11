const assert = require('node:assert/strict');
const test = require('node:test');

const { __mandatoryBidContentRulesTestRuntime: runtime } = require('./contentIllustrationGeneration.cjs');

const execution = {
  planItem: { item_id: 'I1', title: '项目进度图', image_type: 'process' },
  reference: '最终正文：合同生效后第1日至第30日完成实施、验收和交付。',
};

function assertIllustrationScheduleRule(prompt) {
  assert.match(prompt, /只能复制最终正文/);
  assert.match(prompt, /时间边界/);
  assert.match(prompt, /里程碑/);
  assert.match(prompt, /不得自行推算/);
  assert.match(prompt, /绝对日期/);
  assert.match(prompt, /紧凑/);
  assert.match(prompt, /并行/);
}

test('AI, Mermaid-AI, HTML, and HTML-Agent image prompts preserve final schedule facts', () => {
  const prompts = [
    runtime.buildAiImagePrompt(execution),
    runtime.buildMermaidAiImagePrompt(execution, 'flowchart TD\nA["启动"] --> B["交付"]'),
    runtime.buildHtmlImagePrompt(execution),
    `${runtime.buildHtmlAgentPrompt(execution)}\n${execution.reference}`,
  ];
  prompts.forEach(assertIllustrationScheduleRule);
});

test('Mermaid generation and syntax repair cannot invent schedule dates', () => {
  const generation = runtime.buildMermaidGenerationMessages(execution).map((message) => message.content).join('\n');
  const repair = runtime.buildMermaidRepairMessages(
    execution,
    { code: 'flowchart TD\nA["启动"] --> B["交付"]' },
    'syntax error',
    1,
  ).map((message) => message.content).join('\n');
  assertIllustrationScheduleRule(generation);
  assertIllustrationScheduleRule(repair);
});

test('HTML layout repair keeps schedule bounds and milestones unchanged', () => {
  const prompt = `${runtime.buildHtmlLayoutRepairPrompt(execution, '<html><body>进度</body></html>', ['拥挤'], 1)}\n${execution.reference}`;
  assertIllustrationScheduleRule(prompt);
});
