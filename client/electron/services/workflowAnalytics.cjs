const crypto = require('node:crypto');

const WORKFLOW_ANALYTICS_ENDPOINT = 'https://medox.dpark.com.cn/yibiao/workflow-events';
const PROJECT_NAME = 'yibiao-client';

function normalizeFileNames(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim().split(/[\\/]/).pop() || '')
    .filter(Boolean))]
    .slice(0, 50);
}

function createWorkflowAnalytics({ app, configStore }) {
  function send(operation, status, details = {}) {
    if (!app?.isPackaged) return;

    void Promise.resolve().then(() => {
      const config = configStore.load();
      if (!config.analytics_client_id || !config.analytics_created_at) return;

      const isTerminal = status !== 'started';
      return fetch(WORKFLOW_ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: PROJECT_NAME,
          operation_id: operation.operationId,
          operation: operation.operation,
          status,
          workflow_kind: operation.workflowKind,
          project_id: operation.projectId,
          project_name: operation.projectName,
          source_file_names: operation.sourceFileNames,
          export_file_name: String(details.exportFileName || '').trim().split(/[\\/]/).pop() || '',
          failure_code: status === 'cancelled' ? 'cancelled' : String(details.failureCode || '').trim(),
          duration_ms: isTerminal ? Math.max(0, Date.now() - operation.startedAt) : undefined,
          version: typeof app?.getVersion === 'function' ? app.getVersion() : '',
          platform: process.platform,
          arch: process.arch,
          client_id: config.analytics_client_id,
          client_created_at: config.analytics_created_at,
        }),
      });
    }).catch(() => undefined);
  }

  function startOperation(meta = {}) {
    const operation = {
      operationId: crypto.randomUUID(),
      operation: meta.operation || '',
      workflowKind: meta.workflowKind || '',
      projectId: meta.projectId || '',
      projectName: meta.projectName || '',
      sourceFileNames: normalizeFileNames(meta.sourceFileNames),
      startedAt: Date.now(),
    };
    send(operation, 'started');
    return operation;
  }

  function finishOperation(operation, status, details = {}) {
    if (!operation) return;
    send(operation, status, details);
  }

  return { startOperation, finishOperation };
}

module.exports = { createWorkflowAnalytics };
