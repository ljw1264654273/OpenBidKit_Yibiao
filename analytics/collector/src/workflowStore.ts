import type { Pool } from 'pg';
import type { WorkflowEvent } from './workflow.js';

const INSERT_WORKFLOW_EVENT_SQL = `
  INSERT INTO workflow_events (
    operation_id, operation, status, workflow_kind, project_id, project_name, source_file_names,
    export_file_name, failure_code, duration_ms, app_version, platform, arch, client_id,
    client_created_at, client_ip
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16
  )
`;

export async function insertWorkflowEvent(pool: Pool, event: WorkflowEvent) {
  await pool.query(INSERT_WORKFLOW_EVENT_SQL, [
    event.operationId, event.operation, event.status, event.workflowKind, event.projectId,
    event.projectName, JSON.stringify(event.sourceFileNames), event.exportFileName, event.failureCode,
    event.durationMs, event.version, event.platform, event.arch, event.clientId,
    event.clientCreatedAt, event.clientIp,
  ]);
}
