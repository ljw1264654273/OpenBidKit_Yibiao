const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyGeneratedIllustrationsToDocument,
  adjustMermaidReviewCode,
  generateAiRedrawCandidate,
  generateHtmlRedrawCandidate,
  generateMermaidIllustration,
  generateMermaidAiIllustration,
  generateMermaidAiIllustrationFromCode,
  generateMermaidRedrawCandidateFromCode,
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

function createAiExecution() {
  return {
    planItem: {
      item_id: 'ai-1',
      kind: 'ai',
      image_type: 'engineering',
      title: '设备部署示意',
      section_ids: ['1.2'],
      placement: 'after',
      generation: {
        status: 'success',
        asset_url: 'yibiao-asset://generated-images/original-ai.png',
      },
    },
    reference: '正文事实：设备部署在中心机房和泵站。',
  };
}

function createHtmlExecution(generation = {}) {
  return {
    planItem: {
      item_id: 'html-1',
      kind: 'html',
      image_type: 'architecture',
      title: '系统架构 PPT 图',
      section_ids: ['1.3'],
      placement: 'before',
      generation: {
        status: 'success',
        asset_url: 'yibiao-asset://generated-images/original-html.png',
        source_path: 'illustrations/test/html/html-1.html',
        ...generation,
      },
    },
    reference: '正文事实：平台由采集层、传输层、应用层组成。',
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

test('AI 配图重绘返回独立候选图片且不覆盖当前 asset_url', async () => {
  const imageRequests = [];
  const result = await generateAiRedrawCandidate({
    generateImage: async (request) => {
      imageRequests.push(request);
      return { asset_url: 'yibiao-asset://generated-images/redraw-ai.png' };
    },
  }, createAiExecution(), { instruction: '更突出泵站部署关系' });

  assert.equal(result.redraw_status, 'success');
  assert.equal(result.redraw_asset_url, 'yibiao-asset://generated-images/redraw-ai.png');
  assert.equal(result.asset_url, undefined);
  assert.equal(result.redraw_attempts, 1);
  assert.match(imageRequests[0].prompt, /更突出泵站部署关系/);
  assert.match(imageRequests[0].prompt, /原图地址：yibiao-asset:\/\/generated-images\/original-ai\.png/);
});

test('流程图使用已确认 Mermaid code 生成独立候选图片', async () => {
  const imageRequests = [];
  const result = await generateMermaidRedrawCandidateFromCode({
    generateImage: async (request) => {
      imageRequests.push(request);
      return { asset_url: 'yibiao-asset://generated-images/redraw-mermaid.png' };
    },
  }, createExecution(), 'flowchart TD\n  A["确认代码"] --> B["候选图"]', undefined, 3, '突出主流程，减少装饰元素');

  assert.equal(result.redraw_status, 'success');
  assert.equal(result.redraw_asset_url, 'yibiao-asset://generated-images/redraw-mermaid.png');
  assert.equal(result.asset_url, undefined);
  assert.equal(result.redraw_attempts, 3);
  assert.match(imageRequests[0].prompt, /A\["确认代码"\]/);
  assert.match(imageRequests[0].prompt, /突出主流程，减少装饰元素/);
});

test('PPT 图重绘读取原 HTML 并保存独立候选源文件和候选图片', async () => {
  const savedHtml = [];
  const savedPng = [];
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  const result = await generateHtmlRedrawCandidate({
    aiService: {
      chat: async ({ messages }) => {
        assert.match(messages[0].content, /当前 HTML/);
        assert.match(messages[0].content, /调整要求：改成左右分栏/);
        return '<html><body><section>redraw html</section></body></html>';
      },
    },
    execution: createHtmlExecution(),
    plan: { revision: 'test' },
    workspaceStore: {
      readIllustrationHtml: (sourcePath) => {
        assert.equal(sourcePath, 'illustrations/test/html/html-1.html');
        return '<html><body><section>original html</section></body></html>';
      },
      saveIllustrationHtml: ({ itemId, content }) => {
        savedHtml.push({ itemId, content });
        return { relativePath: `illustrations/test/html/${itemId}.html` };
      },
      saveIllustrationPng: ({ itemId, buffer }) => {
        savedPng.push({ itemId, buffer });
        return { assetUrl: `yibiao-asset://generated-images/${itemId}.png` };
      },
    },
    localImageRenderService: {
      probeHtmlLayoutOnly: async () => ({ width: 1200, height: 800, layout_issues: [] }),
      renderHtmlToPng: async () => ({ buffer: png, width: 1200, height: 800, layout_issues: [] }),
    },
    instruction: '改成左右分栏',
  });

  assert.equal(result.redraw_status, 'success');
  assert.equal(result.redraw_source_path, 'illustrations/test/html/html-1-redraw.html');
  assert.equal(result.redraw_asset_url, 'yibiao-asset://generated-images/html-1-redraw.png?pixel-density=2');
  assert.equal(result.asset_url, undefined);
  assert.deepEqual(savedHtml.map((entry) => entry.itemId), ['html-1-redraw']);
  assert.deepEqual(savedPng.map((entry) => entry.itemId), ['html-1-redraw']);
});

test('PPT 图重绘缺少原 HTML 源文件时进入候选错误', async () => {
  await assert.rejects(
    () => generateHtmlRedrawCandidate({
      aiService: { chat: async () => '<html><body></body></html>' },
      execution: createHtmlExecution({ source_path: '' }),
      plan: { revision: 'test' },
      workspaceStore: { readIllustrationHtml: () => '' },
      localImageRenderService: {
        probeHtmlLayoutOnly: async () => ({ width: 1200, height: 800, layout_issues: [] }),
        renderHtmlToPng: async () => ({ buffer: Buffer.from('89504e470d0a1a0a0000', 'hex'), width: 1200, height: 800, layout_issues: [] }),
      },
    }),
    /缺少原 HTML 源文件/,
  );
});

test('应用图片计划时忽略跳过项且不会插入候选图片', () => {
  const result = applyGeneratedIllustrationsToDocument({
    items: [
      {
        item_id: 'skipped-ai',
        kind: 'ai',
        title: '跳过图片',
        section_ids: ['1.1'],
        placement: 'after',
        generation: {
          status: 'success',
          review_status: 'skipped',
          asset_url: 'yibiao-asset://generated-images/skipped.png',
        },
      },
      {
        item_id: 'candidate-ai',
        kind: 'ai',
        title: '候选图片',
        section_ids: ['1.1'],
        placement: 'after',
        generation: {
          status: 'success',
          asset_url: 'yibiao-asset://generated-images/current.png',
          redraw_status: 'success',
          redraw_asset_url: 'yibiao-asset://generated-images/candidate.png',
        },
      },
    ],
  }, {
    outline: [{ id: '1.1', title: '正文', content: 'Existing text.' }],
  }, {
    '1.1': { id: '1.1', status: 'success', content: 'Existing text.' },
  });

  assert.doesNotMatch(result.sections['1.1'].content, /skipped\.png/);
  assert.doesNotMatch(result.sections['1.1'].content, /candidate\.png/);
  assert.match(result.sections['1.1'].content, /current\.png/);
});
