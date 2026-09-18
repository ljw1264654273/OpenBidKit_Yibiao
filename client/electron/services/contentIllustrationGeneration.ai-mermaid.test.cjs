const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyGeneratedIllustrationsToDocument,
  adjustMermaidReviewCode,
  generateMermaidIllustration,
  generateMermaidAiIllustration,
  generateMermaidAiIllustrationFromCode,
  generateMermaidReviewDraft,
} = require('./contentIllustrationGeneration.cjs');

function createExecution() {
  return {
    planItem: {
      item_id: 'mermaid-1',
      kind: 'mermaid',
      image_type: 'process',
      title: '实施流程',
      section_ids: ['1.1'],
      placement: 'after',
      generation: {},
    },
    reference: '正文事实：先审核资料，再反馈结果。',
  };
}

function createRenderService() {
  const calls = [];
  return {
    calls,
    renderMermaidToPng: async (code) => {
      calls.push(code);
      return { buffer: Buffer.from('png') };
    },
  };
}

test('Mermaid 默认入口返回生成并通过本地渲染校验的 code', async () => {
  const renderService = createRenderService();
  const result = await generateMermaidIllustration({
    collectJsonResponse: async () => ({ code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]' }),
  }, createExecution(), undefined, renderService);

  assert.equal(result.code, 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]');
  assert.equal(result.attempts, 0);
  assert.deepEqual(renderService.calls, [result.code]);
});

test('Mermaid AI 重绘 prompt 包含已校验 code、标题、类型和正文 reference', async () => {
  const renderService = createRenderService();
  const imageRequests = [];
  const result = await generateMermaidAiIllustration({
    collectJsonResponse: async () => ({ code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]' }),
    generateImage: async (request) => {
      imageRequests.push(request);
      return { asset_url: 'yibiao-asset://generated-images/mermaid-1.png' };
    },
  }, createExecution(), undefined, renderService);

  assert.equal(result.asset_url, 'yibiao-asset://generated-images/mermaid-1.png');
  assert.equal(result.attempts, 1);
  assert.match(imageRequests[0].prompt, /flowchart TD/);
  assert.match(imageRequests[0].prompt, /实施流程/);
  assert.match(imageRequests[0].prompt, /flowchart/);
  assert.match(imageRequests[0].prompt, /正文事实：先审核资料，再反馈结果。/);
  assert.match(imageRequests[0].prompt, /不得新增流程/);
  assert.deepEqual(renderService.calls, ['flowchart TD\n  A["审核资料"] --> B["反馈结果"]']);
});

test('Mermaid AI 图片模型失败时直接报错，不回退为 Mermaid code', async () => {
  const renderService = createRenderService();
  await assert.rejects(
    () => generateMermaidAiIllustration({
      collectJsonResponse: async () => ({ code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]' }),
      generateImage: async () => { throw new Error('图片模型不可用'); },
    }, createExecution(), undefined, renderService),
    /图片模型不可用/,
  );
  assert.equal(renderService.calls.length, 1);
});

test('Mermaid AI 对象式运行参数会原样透传暂停异常', async () => {
  const renderService = createRenderService();
  const pauseError = new Error('任务已暂停');
  let caught;
  try {
    await generateMermaidAiIllustration({
      collectJsonResponse: async () => ({ code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]' }),
      generateImage: async () => { throw pauseError; },
    }, createExecution(), {
      isPauseLikeError: (error) => error === pauseError,
      localImageRenderService: renderService,
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, pauseError);
});

test('Mermaid AI asset_url result creates standard yibiao-asset image Markdown', () => {
  const result = applyGeneratedIllustrationsToDocument({
    items: [{
      item_id: 'mermaid-1',
      kind: 'mermaid',
      title: 'Implementation flow',
      section_ids: ['1.1'],
      placement: 'after',
      generation: {
        status: 'success',
        asset_url: 'yibiao-asset://generated-images/mermaid-1.png',
      },
    }],
  }, {
    outline: [{ id: '1.1', title: 'Implementation flow', content: 'Existing text.' }],
  }, {
    '1.1': { id: '1.1', status: 'success', content: 'Existing text.' },
  });

  assert.equal(
    result.sections['1.1'].content,
    'Existing text.\n\n<!-- yibiao-illustration:start id="mermaid-1" -->\n![Implementation flow](yibiao-asset://generated-images/mermaid-1.png)\n\n*<!-- yibiao-figure-caption -->Implementation flow*\n<!-- yibiao-illustration:end -->',
  );
  assert.equal(result.outlineData.outline[0].content, result.sections['1.1'].content);
});

test('Mermaid AI asset_url result takes priority over retained Mermaid code', () => {
  const result = applyGeneratedIllustrationsToDocument({
    items: [{
      item_id: 'mermaid-1',
      kind: 'mermaid',
      title: 'Implementation flow',
      section_ids: ['1.1'],
      placement: 'after',
      generation: {
        status: 'success',
        code: 'flowchart TD\n  A["Start"] --> B["Done"]',
        asset_url: 'yibiao-asset://generated-images/mermaid-1.png',
      },
    }],
  }, {
    outline: [{ id: '1.1', title: 'Implementation flow', content: 'Existing text.' }],
  }, {
    '1.1': { id: '1.1', status: 'success', content: 'Existing text.' },
  });

  assert.match(result.sections['1.1'].content, /!\[Implementation flow\]\(yibiao-asset:\/\/generated-images\/mermaid-1\.png\)/);
  assert.doesNotMatch(result.sections['1.1'].content, /```mermaid/);
});

test('Mermaid 审核草稿在审核期间仍保留代码图到正文', () => {
  const result = applyGeneratedIllustrationsToDocument({
    items: [{
      item_id: 'mermaid-1',
      kind: 'mermaid',
      title: 'Implementation flow',
      section_ids: ['1.1'],
      placement: 'after',
      generation: {
        status: 'reviewing',
        code: 'flowchart TD\n  A["Start"] --> B["Done"]',
        review_status: 'pending',
      },
    }],
  }, {
    outline: [{ id: '1.1', title: 'Implementation flow', content: 'Existing text.' }],
  }, {
    '1.1': { id: '1.1', status: 'success', content: 'Existing text.' },
  });

  assert.match(result.sections['1.1'].content, /```mermaid\s+flowchart TD/);
  assert.match(result.sections['1.1'].content, /A\["Start"\] --> B\["Done"\]/);
  assert.match(result.outlineData.outline[0].content, /<!-- yibiao-illustration:start id="mermaid-1" -->/);
});

test('Mermaid review draft returns validated code without calling image generation', async () => {
  const renderService = createRenderService();
  let imageCalled = false;
  const result = await generateMermaidReviewDraft({
    collectJsonResponse: async () => ({ code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]' }),
    generateImage: async () => {
      imageCalled = true;
      return { asset_url: 'yibiao-asset://generated-images/should-not-exist.png' };
    },
  }, createExecution(), undefined, renderService);

  assert.deepEqual(result, {
    status: 'reviewing',
    code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]',
    draft_code: 'flowchart TD\n  A["审核资料"] --> B["反馈结果"]',
    review_status: 'pending',
    attempts: 0,
  });
  assert.equal(imageCalled, false);
  assert.deepEqual(renderService.calls, [result.code]);
});

test('Mermaid review AI adjustment returns updated code without image generation', async () => {
  const requests = [];
  let imageCalled = false;
  const result = await adjustMermaidReviewCode({
    collectJsonResponse: async (request) => {
      requests.push(request);
      return { code: 'flowchart TD\n  A["资料收集"] --> B["问题整改"]\n  B --> C["成果验收"]' };
    },
    generateImage: async () => {
      imageCalled = true;
      return { asset_url: 'yibiao-asset://generated-images/should-not-exist.png' };
    },
  }, {
    execution: createExecution(),
    currentCode: 'flowchart TD\n  A["资料收集"] --> C["成果验收"]',
    adjustment: '在资料收集和成果验收之间增加问题整改节点',
  });

  assert.equal(result.code, 'flowchart TD\n  A["资料收集"] --> B["问题整改"]\n  B --> C["成果验收"]');
  assert.equal(imageCalled, false);
  assert.match(requests[0].messages[0].content, /Mermaid 流程图调整助手/);
  assert.match(requests[0].messages[1].content, /在资料收集和成果验收之间增加问题整改节点/);
  assert.match(requests[0].messages[1].content, /flowchart TD/);
  assert.match(requests[0].messages[1].content, /正文事实：先审核资料，再反馈结果。/);
});

test('Mermaid AI 调整可同时携带参考图片和文字要求', async () => {
  const requests = [];
  const result = await adjustMermaidReviewCode({
    collectJsonResponse: async (request) => {
      requests.push(request);
      return { code: 'flowchart TD\n  A["资料"] --> B["审核"]' };
    },
  }, {
    execution: createExecution(),
    currentCode: 'flowchart TD\n  A["资料"] --> B["结果"]',
    adjustment: '参考图片布局，把审核节点放到中间',
    referenceImagePath: 'C:\\\\temp\\\\mermaid-reference.png',
  });

  assert.equal(result.code, 'flowchart TD\n  A["资料"] --> B["审核"]');
  assert.equal(Array.isArray(requests[0].messages[1].content), true);
  assert.match(requests[0].messages[1].content.find((part) => part.type === 'text').text, /参考图片布局/);
  assert.deepEqual(
    requests[0].messages[1].content.find((part) => part.type === 'local_image'),
    { type: 'local_image', path: 'C:\\\\temp\\\\mermaid-reference.png', detail: 'high' },
  );
});

test('Mermaid AI 调整可使用无本地路径的剪贴板图片 Data URL', async () => {
  const requests = [];
  await adjustMermaidReviewCode({
    collectJsonResponse: async (request) => {
      requests.push(request);
      return { code: 'flowchart TD\n  A["资料"] --> B["审核"]' };
    },
  }, {
    execution: createExecution(),
    currentCode: 'flowchart TD\n  A["资料"] --> B["结果"]',
    adjustment: '参考这张图片的布局',
    referenceImageDataUrl: 'data:image/png;base64,AAAA',
  });

  assert.deepEqual(
    requests[0].messages[1].content.find((part) => part.type === 'image_url'),
    {
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,AAAA',
        detail: 'high',
      },
    },
  );
});

test('Mermaid AI 调整可同时携带多张参考图片并保持图片顺序', async () => {
  const requests = [];
  await adjustMermaidReviewCode({
    collectJsonResponse: async (request) => {
      requests.push(request);
      return { code: 'flowchart TD\n  A["资料"] --> B["审核"]' };
    },
  }, {
    execution: createExecution(),
    currentCode: 'flowchart TD\n  A["资料"] --> B["结果"]',
    adjustment: '参考这些图片的布局',
    referenceImages: [
      { referenceImagePath: 'C:\\\\temp\\\\first.png' },
      { referenceImageDataUrl: 'data:image/png;base64,SECOND' },
    ],
  });

  assert.deepEqual(
    requests[0].messages[1].content.filter((part) => part.type !== 'text'),
    [
      { type: 'local_image', path: 'C:\\\\temp\\\\first.png', detail: 'high' },
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,SECOND',
          detail: 'high',
        },
      },
    ],
  );
});

test('Mermaid AI 重绘确认代码时不重新生成 Mermaid code', async () => {
  const imageRequests = [];
  let textGenerationCalled = false;
  const result = await generateMermaidAiIllustrationFromCode({
    collectJsonResponse: async () => {
      textGenerationCalled = true;
      return { code: 'flowchart TD\n  X["错误"] --> Y["不应使用"]' };
    },
    generateImage: async (request) => {
      imageRequests.push(request);
      return { asset_url: 'yibiao-asset://generated-images/confirmed.png' };
    },
  }, createExecution(), 'flowchart TD\n  A["用户确认"] --> B["AI重绘"]');

  assert.equal(result.asset_url, 'yibiao-asset://generated-images/confirmed.png');
  assert.equal(result.attempts, 1);
  assert.equal(textGenerationCalled, false);
  assert.match(imageRequests[0].prompt, /A\["用户确认"\]/);
  assert.doesNotMatch(imageRequests[0].prompt, /X\["错误"\]/);
});
