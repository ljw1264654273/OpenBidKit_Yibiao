import type { Pool } from 'pg';
import type { TrackingEvent } from './event.js';

const INSERT_EVENT_SQL = `
  INSERT INTO tracking_events (
    project_name, event_type, page, app_version, platform, arch, client_id, client_created_at, client_ip,
    config_key, config_value, ai_request_type, ai_model_provider, ai_model_endpoint_host, ai_model_name,
    resource_key, agent_runtime_kind, agent_runtime_status, agent_runtime_retry_count,
    agent_runtime_model_retry_count, license_status, license_plan, license_expires_at, source_trusted,
    untrusted_reason, prompt_tokens, completion_tokens, total_tokens
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
    $20, $21, $22, $23, $24, $25, $26, $27, $28
  )
`;

export async function insertTrackingEvent(pool: Pool, event: TrackingEvent) {
  await pool.query(INSERT_EVENT_SQL, [
    event.projectName, event.event, event.page, event.version, event.platform, event.arch,
    event.clientId, event.clientCreatedAt, event.clientIp, event.configKey, event.configValue,
    event.aiRequestType, event.aiModelProvider, event.aiModelEndpointHost, event.aiModelName,
    event.resourceKey, event.agentRuntimeKind, event.agentRuntimeStatus, event.agentRuntimeRetryCount,
    event.agentRuntimeModelRetryCount, event.licenseStatus, event.licensePlan, event.licenseExpiresAt,
    event.sourceTrusted, event.untrustedReason, event.promptTokens, event.completionTokens, event.totalTokens,
  ]);
}
