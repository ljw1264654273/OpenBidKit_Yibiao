import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { createApp } from './app.js';
import { normalizeWorkflowEvent, validateWorkflowEvent } from './workflow.js';

const operationId = 'd2719e92-8d6e-4b5a-9bc7-777777777777';

test('normalizes terminal workflow events and strips source file paths', () => {
  const event = normalizeWorkflowEvent({
    operation_id: operationId,
    operation: 'project_created',
    status: 'succeeded',
    workflow_kind: 'technical-plan',
    project_id: 'project-1',
    project_name: '项目方案',
    source_file_names: ['C:\\投标\\招标文件.docx', '/tmp/附件.pdf'],
    duration_ms: 4200,
    version: '2.0.0',
    platform: 'win32',
    client_id: 'client-1',
    client_created_at: '2026-09-17',
  }, '203.0.113.10');

  assert.equal(validateWorkflowEvent(event), '');
  assert.deepEqual(event.sourceFileNames, ['招标文件.docx', '附件.pdf']);
  assert.equal(event.clientIp, '203.0.113.10');
});

test('requires a controlled failure code for failed workflow events', () => {
  const event = normalizeWorkflowEvent({
    operation_id: operationId,
    operation: 'word_export',
    status: 'failed',
    workflow_kind: 'technical-plan',
    project_id: 'project-1',
    project_name: '项目方案',
    duration_ms: 1,
    failure_code: 'uncontrolled',
    version: '2.0.0',
    client_id: 'client-1',
    client_created_at: '2026-09-17',
  }, '127.0.0.1');

  assert.equal(validateWorkflowEvent(event), 'invalid failure_code');
});

test('stores a valid workflow event through the dedicated endpoint', async () => {
  const calls: unknown[][] = [];
  const pool = {
    query: async (_sql: string, values: unknown[]) => { calls.push(values); },
  } as unknown as Pool;
  const app = createApp(pool, false);

  const response = await app.inject({
    method: 'POST',
    url: '/workflow-events',
    payload: {
      operation_id: operationId,
      operation: 'word_export',
      status: 'cancelled',
      workflow_kind: 'technical-plan',
      project_id: 'project-1',
      project_name: '项目方案',
      failure_code: 'cancelled',
      duration_ms: 5,
      version: '2.0.0',
      client_id: 'client-1',
      client_created_at: '2026-09-17',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { code: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], 'cancelled');
  await app.close();
});
