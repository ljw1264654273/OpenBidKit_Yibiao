import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { createApp } from './app.js';
import { normalizeTrackingEvent, validateTrackingEvent } from './event.js';

test('normalizes the existing client ai_request payload without retaining its path', () => {
  const event = normalizeTrackingEvent({
    projectName: 'yibiao-client',
    event: 'ai_request',
    version: '2.0.0',
    client_id: 'client-1',
    client_created_at: '2026-09-17',
    ai_request_type: 'text',
    ai_model_provider: 'openai',
    ai_model_base_url: 'https://api.example.com/v1',
    ai_model_name: 'model-a',
    prompt_tokens: 12,
    completion_tokens: 8,
  }, '203.0.113.10');

  assert.equal(validateTrackingEvent(event), '');
  assert.equal(event.aiModelEndpointHost, 'api.example.com');
  assert.equal(event.totalTokens, 20);
  assert.equal(event.clientIp, '203.0.113.10');
});

test('rejects events that do not satisfy the current track contract', () => {
  const event = normalizeTrackingEvent({
    projectName: 'yibiao-client',
    event: 'unknown',
    version: '2.0.0',
    client_id: 'client-1',
    client_created_at: '2026-09-17',
  }, '127.0.0.1');

  assert.equal(validateTrackingEvent(event), 'invalid event');
});

test('stores a valid track request and preserves the Worker response contract', async () => {
  const calls: unknown[][] = [];
  const pool = {
    query: async (_sql: string, values: unknown[]) => { calls.push(values); },
  } as unknown as Pool;
  const app = createApp(pool, false);

  const response = await app.inject({
    method: 'POST',
    url: '/track',
    payload: {
      projectName: 'yibiao-client',
      event: 'page_view',
      page: 'technical-plan/bid-analysis',
      version: '2.0.0',
      platform: 'win32',
      client_id: 'client-1',
      client_created_at: '2026-09-17',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { code: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'page_view');
  await app.close();
});
