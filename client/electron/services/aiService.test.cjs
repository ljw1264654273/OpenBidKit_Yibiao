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
