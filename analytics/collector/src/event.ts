export const ALLOWED_EVENTS = new Set([
  'app_open',
  'page_view',
  'config_usage',
  'ai_request',
  'resource_click',
  'agent_runtime',
]);

const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,80}$/;
const AGENT_RUNTIME_KIND_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const AGENT_RUNTIME_STATUSES = new Set(['success', 'failed']);

export interface TrackingEvent {
  projectName: string;
  event: string;
  page: string;
  version: string;
  platform: string;
  arch: string;
  clientId: string;
  clientCreatedAt: string | null;
  clientIp: string | null;
  configKey: string;
  configValue: string;
  aiRequestType: string;
  aiModelProvider: string;
  aiModelEndpointHost: string;
  aiModelName: string;
  resourceKey: string;
  agentRuntimeKind: string;
  agentRuntimeStatus: string;
  agentRuntimeRetryCount: number;
  agentRuntimeModelRetryCount: number;
  licenseStatus: string;
  licensePlan: string;
  licenseExpiresAt: string | null;
  sourceTrusted: string;
  untrustedReason: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function text(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function metricText(value: unknown, maxLength: number) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return text(value, maxLength);
}

function positiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.floor(parsed)) : 0;
}

function date(value: unknown) {
  const normalized = text(value, 20).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function endpointHost(value: unknown) {
  const source = text(value, 200);
  if (!source) return '';
  try {
    return text(new URL(source.includes('://') ? source : `https://${source}`).hostname.toLowerCase(), 120);
  } catch {
    return text(source.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase(), 120);
  }
}

function ip(value: unknown) {
  const normalized = text(value, 80).replace(/^\[|\]$/g, '').toLowerCase();
  if (!normalized || /[\s,/]/.test(normalized) || !isIP(normalized)) return null;
  const ipv4 = normalized.split('.');
  if (ipv4.length === 4) {
    return ipv4.map((part) => String(Number(part))).join('.');
  }
  return normalized;
}

export function normalizeTrackingEvent(body: unknown, clientIp: unknown): TrackingEvent {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const promptTokens = positiveInteger(input.prompt_tokens ?? input.promptTokens);
  const completionTokens = positiveInteger(input.completion_tokens ?? input.completionTokens);
  const suppliedTotalTokens = positiveInteger(input.total_tokens ?? input.totalTokens);

  return {
    projectName: text(input.projectName ?? input.project_name, 80),
    event: text(input.event, 50),
    page: text(input.page, 120),
    version: text(input.version, 50),
    platform: text(input.platform, 50),
    arch: text(input.arch, 50),
    clientId: text(input.client_id ?? input.clientId, 120),
    clientCreatedAt: date(input.client_created_at ?? input.clientCreatedAt),
    clientIp: ip(clientIp),
    configKey: text(input.config_key ?? input.configKey, 80),
    configValue: metricText(input.config_value ?? input.configValue, 200),
    aiRequestType: text(input.ai_request_type ?? input.aiRequestType, 20),
    aiModelProvider: text(input.ai_model_provider ?? input.aiModelProvider, 80),
    aiModelEndpointHost: endpointHost(input.ai_model_base_url ?? input.aiModelBaseUrl),
    aiModelName: text(input.ai_model_name ?? input.aiModelName, 160),
    resourceKey: text(input.resource_key ?? input.resourceKey, 80),
    agentRuntimeKind: text(input.agent_runtime_kind ?? input.agentRuntimeKind, 40),
    agentRuntimeStatus: text(input.agent_runtime_status ?? input.agentRuntimeStatus, 20),
    agentRuntimeRetryCount: positiveInteger(input.agent_runtime_retry_count ?? input.agentRuntimeRetryCount, 3),
    agentRuntimeModelRetryCount: positiveInteger(input.agent_runtime_model_retry_count ?? input.agentRuntimeModelRetryCount, 9999),
    licenseStatus: text(input.license_status ?? input.licenseStatus, 30),
    licensePlan: text(input.license_plan ?? input.licensePlan, 40),
    licenseExpiresAt: date(input.license_expires_at ?? input.licenseExpiresAt),
    sourceTrusted: text(input.source_trusted ?? input.sourceTrusted, 20),
    untrustedReason: text(input.untrusted_reason ?? input.untrustedReason, 80),
    promptTokens,
    completionTokens,
    totalTokens: suppliedTotalTokens || promptTokens + completionTokens,
  };
}

export function validateTrackingEvent(event: TrackingEvent) {
  if (!PROJECT_NAME_PATTERN.test(event.projectName)) return 'invalid projectName';
  if (!ALLOWED_EVENTS.has(event.event)) return 'invalid event';
  if (!event.clientId) return 'missing client_id';
  if (!event.clientCreatedAt) return 'missing client_created_at';
  if (!event.version) return 'missing version';
  if (event.event === 'agent_runtime' && !AGENT_RUNTIME_KIND_PATTERN.test(event.agentRuntimeKind)) {
    return 'invalid agent_runtime_kind';
  }
  if (event.event === 'agent_runtime' && !AGENT_RUNTIME_STATUSES.has(event.agentRuntimeStatus)) {
    return 'invalid agent_runtime_status';
  }
  return '';
}
import { isIP } from 'node:net';
