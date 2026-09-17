const BID_PROJECT_DUPLICATE_REWRITE_RESPONSE_SCHEMA = Object.freeze({
  name: 'bid_project_duplicate_rewrite',
  strict: true,
  schema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: Object.freeze({
      rewrittenText: Object.freeze({
        type: 'string',
        description: '改写后的目标正文，保留原文事实和承诺，不得为空。',
      }),
      reason: Object.freeze({
        type: 'string',
        description: '说明本次改写如何调整表达，以及保留了哪些事实。',
      }),
      riskNote: Object.freeze({
        type: 'string',
        description: '需要人工核对的事实、承诺、数字或合规风险；没有明显风险时填写无明显风险。',
      }),
    }),
    required: ['rewrittenText', 'reason', 'riskNote'],
  }),
});

const REWRITE_SYSTEM_PROMPT = `你是投标文件重复内容改写助手。

你的任务是只改写用户指定的目标文本，使其与另一份标书中的参考文本降低连续重复表达，同时保持目标文本原有的事实、数字、范围、责任边界、服务承诺和合规要求。

请严格遵守：
1. 明确区分目标文本和参考文本：只改写目标文本，参考文本只用于理解重复点，不得改写参考文本。
2. 保留事实：保留目标文本中的数字、专有名词、项目范围、责任边界、工期和承诺，不得凭空新增或删除实质信息。
3. 不得照搬参考侧的句式、连续表达、措辞组合或段落结构；不得只做同义词替换后继续沿用参考侧表达。
4. 应重新组织目标文本自己的叙述逻辑和表达方式，但不能改变原意，也不能把参考文本的事实混入目标文本。
5. 只返回包含 rewrittenText、reason、riskNote 的 JSON，不要输出 Markdown、代码围栏、解释或额外文字。

返回 rewrittenText、reason、riskNote 三个字段。`;

function requireText(value, message) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error(message);
  }
  return text;
}

function normalizeTargetSide(value) {
  const targetSide = String(value ?? '').trim();
  if (targetSide !== 'left' && targetSide !== 'right') {
    throw new Error('改写目标必须选择左侧或右侧文件');
  }
  return targetSide;
}

function buildBidProjectDuplicateRewriteRequest(input = {}) {
  const targetSide = normalizeTargetSide(input.targetSide);
  const leftProjectName = requireText(input.leftProjectName, '缺少左侧标书项目名称');
  const rightProjectName = requireText(input.rightProjectName, '缺少右侧标书项目名称');
  const leftText = String(input.leftText ?? '').trim();
  const rightText = String(input.rightText ?? '').trim();
  const targetText = targetSide === 'left' ? leftText : rightText;
  const referenceText = targetSide === 'left' ? rightText : leftText;

  requireText(targetText, '目标文本不能为空，请先确认选中的文件包含正文');
  requireText(referenceText, '参考文本不能为空，请先确认另一侧文件包含正文');

  return {
    messages: [
      { role: 'system', content: REWRITE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `左右标书项目上下文：
左侧项目名：${leftProjectName}
右侧项目名：${rightProjectName}
targetSide：${targetSide}

左侧项目正文：
<<<LEFT_TEXT
${leftText}
LEFT_TEXT>>>

右侧项目正文：
<<<RIGHT_TEXT
${rightText}
RIGHT_TEXT>>>`,
      },
      {
        role: 'user',
        content: `本次改写任务：
目标文本：${targetSide === 'left' ? '左侧项目正文' : '右侧项目正文'}
参考文本：${targetSide === 'left' ? '右侧项目正文' : '左侧项目正文'}

请只改写目标文本。参考文本仅用于定位重复表达，绝不能照搬参考侧的句式、连续表达、措辞组合或段落结构。请保留目标文本的全部事实和承诺，并返回结构化 JSON。`,
      },
    ],
    response_format: {
      type: 'json_object',
    },
    progressLabel: '标书重复内容 AI 改写',
    failureMessage: 'AI 改写失败，请检查模型配置后重试',
    logTitle: '标书重复内容 AI 改写',
    signal: input.signal,
    normalizer: normalizeBidProjectDuplicateRewriteResponse,
  };
}

function normalizeBidProjectDuplicateRewriteResponse(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AI 改写结果不是有效对象，请重试');
  }

  const rewrittenText = String(payload.rewrittenText ?? '').trim();
  const reason = String(payload.reason ?? '').trim();
  const riskNote = String(payload.riskNote ?? '').trim();

  if (!rewrittenText) {
    throw new Error('AI 改写结果缺少有效的 rewrittenText，请重新生成');
  }
  if (!reason) {
    throw new Error('AI 改写结果缺少 reason，请重新生成');
  }
  if (!riskNote) {
    throw new Error('AI 改写结果缺少 riskNote，请重新生成');
  }

  return { rewrittenText, reason, riskNote };
}

function createBidProjectDuplicateRewriteService({ aiService } = {}) {
  if (!aiService || typeof aiService.requestJson !== 'function') {
    throw new Error('AI 服务尚未初始化');
  }

  return {
    async rewriteMatch(input = {}) {
      const request = buildBidProjectDuplicateRewriteRequest(input);
      const response = await aiService.requestJson(request);
      return normalizeBidProjectDuplicateRewriteResponse(response);
    },
  };
}

module.exports = {
  BID_PROJECT_DUPLICATE_REWRITE_RESPONSE_SCHEMA,
  buildBidProjectDuplicateRewriteRequest,
  normalizeBidProjectDuplicateRewriteResponse,
  createBidProjectDuplicateRewriteService,
};
