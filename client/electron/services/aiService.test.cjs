const assert = require('node:assert/strict');
const test = require('node:test');

const { createAiService, normalizeStructuredPayload } = require('./aiService.cjs');

test('normalizes structured payload objects and arrays without changing their shape', () => {
  const objectPayload = { facts: [{ key: 'project_name', value: '示例项目' }] };
  const arrayPayload = [{ key: 'project_name', value: '示例项目' }];

  assert.strictEqual(normalizeStructuredPayload(objectPayload), objectPayload);
  assert.strictEqual(normalizeStructuredPayload(arrayPayload), arrayPayload);
});

test('parses JSON object and array payloads wrapped in a json code fence', () => {
  assert.deepEqual(
    normalizeStructuredPayload('```json\n{"facts":[{"key":"project_name"}]}\n```'),
    { facts: [{ key: 'project_name' }] },
  );
  assert.deepEqual(
    normalizeStructuredPayload('```json\n[{"key":"project_name"}]\n```'),
    [{ key: 'project_name' }],
  );
});

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

test('uses the current test poster text for every image provider', () => {
  const source = require('node:fs').readFileSync(require.resolve('./aiService.cjs'), 'utf8');

  assert.equal(source.includes('易标AI老好了'), false);
  assert.equal(source.match(/园测AI标书/g)?.length, 4);
});

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

test('falls back from json_schema to json_object and then plain JSON', async (t) => {
  const originalFetch = global.fetch;
  const requestBodies = [];
  let callCount = 0;

  global.fetch = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    callCount += 1;
    if (callCount < 3) {
      return createJsonResponse({ error: { message: 'response_format is not supported' } }, {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });
    }
    return createJsonResponse({ choices: [{ message: { content: '[{"fact_key":"project_name"}]' } }] });
  };
  t.after(() => { global.fetch = originalFetch; });

  const service = createAiService({
    app: null,
    configStore: { load: () => ({ api_key: 'test-key', model_name: 'test-model', base_url: 'https://example.test/v1', request_mode: 'normal' }) },
  });
  const result = await service.requestJson({
    messages: [{ role: 'user', content: '提取事实' }],
    response_format: { type: 'json_schema', json_schema: { name: 'facts', schema: { type: 'array' } } },
    max_retries: 0,
  });

  assert.deepEqual(result, [{ fact_key: 'project_name' }]);
  assert.equal(requestBodies[0].response_format.type, 'json_schema');
  assert.equal(requestBodies[1].response_format.type, 'json_object');
  assert.equal(Object.hasOwn(requestBodies[2], 'response_format'), false);
});

test('classifies HTTP 413 as context_length_exceeded and propagates error_code', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => createJsonResponse({ error: { message: 'context length exceeded' } }, {
    ok: false,
    status: 413,
    statusText: 'Payload Too Large',
  });
  t.after(() => { global.fetch = originalFetch; });

  const service = createAiService({
    app: null,
    configStore: { load: () => ({ api_key: 'test-key', model_name: 'test-model', base_url: 'https://example.test/v1', request_mode: 'normal' }) },
  });

  await assert.rejects(
    service.requestJson({ messages: [{ role: 'user', content: '过长正文' }], max_retries: 0 }),
    (error) => error.error_code === 'context_length_exceeded',
  );
});

test('classifies a nested Undici timeout error as timeout', async (t) => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const undiciTimeout = new Error('Headers timeout');
  undiciTimeout.code = 'UND_ERR_HEADERS_TIMEOUT';
  const fetchError = new TypeError('fetch failed');
  fetchError.cause = undiciTimeout;

  global.fetch = async () => {
    throw fetchError;
  };
  global.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay <= 5000 ? 0 : delay, ...args);
  t.after(() => {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  });

  const service = createAiService({
    app: null,
    configStore: { load: () => ({ api_key: 'test-key', model_name: 'test-model', base_url: 'https://example.test/v1', request_mode: 'normal' }) },
  });

  await assert.rejects(
    service.chat({ messages: [{ role: 'user', content: '测试超时' }] }),
    (error) => error.error_code === 'timeout',
  );
});

test('classifies unrecoverable structured output as invalid_json', async (t) => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return createJsonResponse({ choices: [{ message: { content: 'not-json' } }] });
  };
  t.after(() => { global.fetch = originalFetch; });

  const service = createAiService({
    app: null,
    configStore: { load: () => ({ api_key: 'test-key', model_name: 'test-model', base_url: 'https://example.test/v1', request_mode: 'normal' }) },
  });

  await assert.rejects(
    service.requestJson({ messages: [{ role: 'user', content: '返回 JSON' }], max_retries: 0 }),
    (error) => error.error_code === 'invalid_json' && callCount === 2,
  );
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
