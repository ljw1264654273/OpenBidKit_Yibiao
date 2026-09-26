const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createContentAiEditService } = require('./contentAiEditService.cjs');

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

function createFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), '易标-AI改写-'));
  const app = { getPath: (name) => (name === 'userData' ? userData : userData) };
  const savedState = { outlineData: { outline: [] } };
  const requests = [];
  const aiService = {
    collectJsonResponse: async (request) => {
      requests.push(request);
      return request.messages[1].content.includes('选中文字')
        ? { replacementText: '优化后的实施要求。' }
        : { insertionText: '新增的实施保障措施。' };
    },
    generateImage: async (request) => {
      requests.push(request);
      const filePath = path.join(userData, '模型输出.png');
      fs.writeFileSync(filePath, onePixelPng);
      return {
        asset_url: 'yibiao-asset://generated-images/model-output.png',
        file_path: filePath,
        mime_type: 'image/png',
      };
    },
    getImageModelAvailability: () => ({ available: true, status: 'available', message: '可用' }),
  };
  const technicalPlanStore = {
    loadTechnicalPlan: () => savedState,
  };
  const service = createContentAiEditService({ app, aiService, technicalPlanStore });
  return {
    userData,
    savedState,
    requests,
    service,
    cleanup: () => fs.rmSync(userData, { recursive: true, force: true }),
  };
}

test('局部改写与续写只返回结构化候选，不修改正文', async (t) => {
  const fixture = createFixture();
  t.after(fixture.cleanup);

  const rewrite = await fixture.service.aiEditContent({
    nodeId: '4.2',
    nodeTitle: '实施方案',
    content: '前文需要调整，后文保持不变。',
    selectionStart: 2,
    selectionEnd: 6,
    instruction: '更专业',
    mode: 'rewrite',
  });
  const continuation = await fixture.service.aiEditContent({
    nodeId: '4.2',
    nodeTitle: '实施方案',
    content: '已有正文。',
    selectionStart: 5,
    selectionEnd: 5,
    instruction: '补充保障措施',
    mode: 'continue',
  });

  assert.deepEqual(rewrite, { mode: 'rewrite', replacementText: '优化后的实施要求。' });
  assert.deepEqual(continuation, { mode: 'continue', insertionText: '新增的实施保障措施。' });
  assert.match(fixture.requests[0].logTitle, /局部改写-4\.2/);
  assert.match(fixture.requests[0].messages[1].content, /选中文字/);
  assert.match(fixture.requests[1].messages[1].content, /光标前文/);
});

test('AI 图片复制到项目候选目录并返回独立保护块', async (t) => {
  const fixture = createFixture();
  t.after(fixture.cleanup);

  const candidate = await fixture.service.generateInlineImage({
    projectId: '项目-中文',
    nodeId: '4.2',
    nodeTitle: '实施方案',
    content: '正文',
    insertionOffset: 2,
    imageTitle: '项目实施阶段示意图',
    imageDescription: '展示准备、实施、验收三个阶段',
  });

  assert.match(candidate.assetUrl, /^yibiao-asset:\/\/generated-images\/technical-plan\/illustrations\/inline-candidates\//);
  assert.match(candidate.markdown, /<!-- yibiao-inline-image:start id="/);
  assert.match(candidate.markdown, /!\[项目实施阶段示意图\]/);
  assert.match(candidate.markdown, /<!-- yibiao-figure-caption -->项目实施阶段示意图/);
  assert.equal(fs.existsSync(candidate.filePath), true);
  assert.match(candidate.filePath, /项目-中文/);
});

test('本地中文路径和剪贴板 data URL 都能导入候选图片', async (t) => {
  const fixture = createFixture();
  t.after(fixture.cleanup);
  const sourceDir = path.join(fixture.userData, '中文图片目录');
  fs.mkdirSync(sourceDir, { recursive: true });
  const sourcePath = path.join(sourceDir, '现场照片.jpg');
  fs.writeFileSync(sourcePath, onePixelPng);

  const local = await fixture.service.importInlineImage({
    projectId: 'project-1',
    source: { filePath: sourcePath },
    imageTitle: '现场照片',
  });
  const clipboard = await fixture.service.importInlineImage({
    projectId: 'project-1',
    source: { dataUrl: `data:image/png;base64,${onePixelPng.toString('base64')}` },
    imageTitle: '剪贴板图片',
    caption: '剪贴板图注',
  });

  assert.equal(fs.readFileSync(local.filePath).equals(onePixelPng), true);
  assert.match(local.filePath, /\.jpg$/i);
  assert.equal(fs.readFileSync(clipboard.filePath).equals(onePixelPng), true);
  assert.match(clipboard.filePath, /\.png$/i);
  assert.match(clipboard.markdown, /剪贴板图注/);
});

test('释放未采用候选会删除文件，已保存正文引用时保留文件', async (t) => {
  const fixture = createFixture();
  t.after(fixture.cleanup);
  const first = await fixture.service.importInlineImage({
    source: { dataUrl: `data:image/png;base64,${onePixelPng.toString('base64')}` },
    imageTitle: '待放弃图片',
  });
  const firstRelease = await fixture.service.releaseInlineImageCandidate({
    candidateId: first.candidateId,
  });
  assert.deepEqual(firstRelease, { success: true, released: true });
  assert.equal(fs.existsSync(first.filePath), false);

  const adopted = await fixture.service.importInlineImage({
    source: { dataUrl: `data:image/png;base64,${onePixelPng.toString('base64')}` },
    imageTitle: '已采用图片',
  });
  fixture.savedState.outlineData.outline = [{
    id: '1',
    title: '章节',
    content: adopted.markdown,
  }];
  const adoptedRelease = await fixture.service.releaseInlineImageCandidate({
    candidateId: adopted.candidateId,
  });
  assert.deepEqual(adoptedRelease, { success: true, released: false, reason: 'referenced' });
  assert.equal(fs.existsSync(adopted.filePath), true);
});

test('图片格式不支持时给出明确错误', async (t) => {
  const fixture = createFixture();
  t.after(fixture.cleanup);
  const sourcePath = path.join(fixture.userData, 'diagram.svg');
  fs.writeFileSync(sourcePath, '<svg/>', 'utf8');

  await assert.rejects(
    fixture.service.importInlineImage({
      source: { filePath: sourcePath },
      imageTitle: '不支持的图片',
    }),
    /仅支持 PNG、JPG、JPEG 或 WebP/,
  );
});
