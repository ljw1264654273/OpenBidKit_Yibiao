const assert = require('node:assert/strict');
const test = require('node:test');

const { createAiService } = require('./aiService.cjs');

function createJsonResponse(data, options = {}) {
  const rawText = JSON.stringify(data);
  return {
    ok: options.ok ?? true,
    status: options.status || 200,
    statusText: options.statusText || '',
    headers: {
      get: () => 'application/json',
    },
    async text() {
      return rawText;
    },
    async json() {
      return data;
    },
  };
}

function createSseResponse(events) {
  const payload = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
  const encoder = new TextEncoder();
  const chunks = [encoder.encode(payload)];
  return {
    ok: true,
    status: 200,
    statusText: '',
    headers: {
      get: () => 'text/event-stream',
    },
    body: {
      getReader() {
        return {
          async read() {
            const value = chunks.shift();
            return value ? { value, done: false } : { value: undefined, done: true };
          },
        };
      },
    },
  };
}

function createImageConfig(overrides = {}) {
  return {
    api_key: 'test-key',
    base_url: 'https://example.test/v1',
    model_name: 'gpt-image-2',
    provider: 'custom',
    image_size: '1024x1024',
    request_mode: 'stream',
    status: 'available',
    ...overrides,
  };
}

test('retries JSON requests without response_format when the provider reports the type is unavailable', async (t) => {
  const originalFetch = global.fetch;
  const requestBodies = [];
  let callCount = 0;

  global.fetch = async (url, options) => {
    if (!String(url).endsWith('/chat/completions')) {
      return createJsonResponse({ ok: true });
    }

    requestBodies.push(JSON.parse(options.body));
    callCount += 1;
    if (callCount === 1) {
      return createJsonResponse({
        error: { message: 'This response_format type is unavailable now' },
      }, {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });
    }

    return createJsonResponse({
      choices: [{ message: { content: '{"rewrittenText":"改写后的正文"}' } }],
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const service = createAiService({
    app: null,
    configStore: {
      load: () => ({
        api_key: 'test-key',
        model_name: 'test-model',
        base_url: 'https://example.test/v1',
        request_mode: 'normal',
        developer_mode: false,
      }),
    },
  });

  const result = await service.requestJson({
    messages: [{ role: 'user', content: '请改写这段正文' }],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'rewrite', schema: { type: 'object' } },
    },
    max_retries: 0,
  });

  assert.deepEqual(result, { rewrittenText: '改写后的正文' });
  assert.equal(callCount, 2);
  assert.equal(requestBodies[0].response_format.type, 'json_schema');
  assert.equal(Object.hasOwn(requestBodies[1], 'response_format'), false);
});

test('parses nested image data from a custom streaming image response', async (t) => {
  const originalFetch = global.fetch;
  const imageBase64 = Buffer.from('fake-png').toString('base64');

  global.fetch = async (url) => {
    assert.equal(String(url), 'https://example.test/v1/images/generations');
    return createSseResponse([
      {
        type: 'image_generation.completed',
        data: {
          image_data: `data:image/png;base64,${imageBase64}`,
        },
      },
    ]);
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const userData = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'yibiao-ai-image-'));
  t.after(() => {
    require('node:fs').rmSync(userData, { recursive: true, force: true });
  });

  const service = createAiService({
    app: { getPath: () => userData, isPackaged: false },
    configStore: {
      load: () => ({
        developer_mode: false,
        image_model: createImageConfig(),
      }),
    },
  });

  const result = await service.generateImage({
    title: '测试图片',
    prompt: '一张测试图片',
  });

  assert.equal(result.success, true);
  assert.equal(require('node:fs').existsSync(result.file_path), true);
  assert.equal(require('node:fs').readFileSync(result.file_path).toString(), 'fake-png');
});
