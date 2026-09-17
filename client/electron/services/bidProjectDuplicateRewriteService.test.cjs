const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BID_PROJECT_DUPLICATE_REWRITE_RESPONSE_SCHEMA,
  buildBidProjectDuplicateRewriteRequest,
  normalizeBidProjectDuplicateRewriteResponse,
  createBidProjectDuplicateRewriteService,
} = require('./bidProjectDuplicateRewriteService.cjs');

const rewriteInput = {
  leftProjectName: '智慧园区项目技术标',
  rightProjectName: '数字园区项目技术标',
  leftText: '本项目建立统一的项目管理机制，明确责任边界，确保建设任务按期完成。',
  rightText: '本项目建立完善的项目管理机制，明确各方责任，确保建设任务按计划完成。',
  targetSide: 'left',
  signal: { aborted: false },
};

test('builds a structured rewrite request with target, reference, facts, and anti-copying rules', () => {
  const request = buildBidProjectDuplicateRewriteRequest(rewriteInput);

  assert.equal(request.progressLabel, '标书重复内容 AI 改写');
  assert.equal(request.failureMessage, 'AI 改写失败，请检查模型配置后重试');
  assert.deepEqual(request.response_format, { type: 'json_object' });
  assert.equal(request.signal, rewriteInput.signal);

  const systemMessage = request.messages.find((message) => message.role === 'system').content;
  const userMessage = request.messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n');

  assert.match(systemMessage, /目标文本/);
  assert.match(systemMessage, /参考文本/);
  assert.match(systemMessage, /保留事实/);
  assert.match(systemMessage, /不得照搬/);
  assert.match(systemMessage, /连续表达/);
  assert.match(systemMessage, /段落结构/);
  assert.match(userMessage, /智慧园区项目技术标/);
  assert.match(userMessage, /数字园区项目技术标/);
  assert.match(userMessage, /targetSide.*left|改写左侧/);
  assert.match(userMessage, /本项目建立统一的项目管理机制/);
  assert.match(userMessage, /本项目建立完善的项目管理机制/);
});

test('builds a right-target request without swapping the submitted project texts', () => {
  const request = buildBidProjectDuplicateRewriteRequest({
    ...rewriteInput,
    targetSide: 'right',
  });
  const userMessage = request.messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n');

  assert.match(userMessage, /targetSide.*right|改写右侧/);
  assert.match(userMessage, /左侧项目正文[\s\S]*本项目建立统一的项目管理机制/);
  assert.match(userMessage, /右侧项目正文[\s\S]*本项目建立完善的项目管理机制/);
});

test('normalizes a valid rewrite response to the public result shape', () => {
  assert.deepEqual(normalizeBidProjectDuplicateRewriteResponse({
    rewrittenText: '本项目将构建清晰的管理体系，划分职责边界，并保障建设工作按期推进。',
    reason: '调整了句式和表达顺序，同时保留项目管理事实。',
    riskNote: '请人工核对责任边界和工期承诺。',
  }), {
    rewrittenText: '本项目将构建清晰的管理体系，划分职责边界，并保障建设工作按期推进。',
    reason: '调整了句式和表达顺序，同时保留项目管理事实。',
    riskNote: '请人工核对责任边界和工期承诺。',
  });
});

test('rejects empty input text with an actionable error before calling AI', async () => {
  let called = false;
  const service = createBidProjectDuplicateRewriteService({
    aiService: {
      requestJson: async () => {
        called = true;
        return {};
      },
    },
  });

  await assert.rejects(
    service.rewriteMatch({
      ...rewriteInput,
      leftText: '   ',
    }),
    /目标文本不能为空/,
  );
  assert.equal(called, false);
});

test('rejects incomplete model output with an actionable error', async () => {
  const service = createBidProjectDuplicateRewriteService({
    aiService: {
      requestJson: async () => ({
        rewrittenText: '   ',
        reason: '已改写',
        riskNote: '',
      }),
    },
  });

  await assert.rejects(
    service.rewriteMatch(rewriteInput),
    /AI 改写结果缺少有效的 rewrittenText/,
  );
});

test('returns normalized AI output and forwards the complete request', async () => {
  let received;
  const response = {
    rewrittenText: '本项目将构建清晰的管理体系，划分职责边界，并保障建设工作按期推进。',
    reason: '重新组织了表达。',
    riskNote: '请核对事实。',
  };
  const service = createBidProjectDuplicateRewriteService({
    aiService: {
      requestJson: async (request) => {
        received = request;
        return response;
      },
    },
  });

  const result = await service.rewriteMatch(rewriteInput);

  assert.deepEqual(result, response);
  assert.equal(received.signal, rewriteInput.signal);
  assert.equal(received.progressLabel, '标书重复内容 AI 改写');
  assert.equal(received.failureMessage, 'AI 改写失败，请检查模型配置后重试');
  assert.equal(received.normalizer, normalizeBidProjectDuplicateRewriteResponse);
});
