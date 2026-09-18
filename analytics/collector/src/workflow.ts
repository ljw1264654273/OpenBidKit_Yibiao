import { isIP } from 'node:net';

const OPERATIONS = new Set(['project_created', 'word_export']);
const STATUSES = new Set(['started', 'succeeded', 'failed', 'cancelled']);
const WORKFLOW_KINDS = new Set(['technical-plan', 'existing-plan-expansion']);
const FAILURE_CODES = new Set(['network', 'parse', 'ai', 'export', 'project', 'cancelled', 'unknown']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface WorkflowEvent {
  operationId: string;
  operation: string;
  status: string;
  workflowKind: string;
  projectId: string;
  projectName: string;
  sourceFileNames: string[];
  exportFileName: string;
  failureCode: string;
  durationMs: number | null;
  version: string;
  platform: string;
  arch: string;
  clientId: string;
  clientCreatedAt: string | null;
  clientIp: string | null;
}

function text(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function date(value: unknown) {
  const normalized = text(value, 20).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function fileName(value: unknown) {
  const normalized = text(value, 500).split(/[\\/]/).pop() || '';
  return normalized.slice(0, 255);
}

function fileNames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(fileName).filter(Boolean))].slice(0, 50);
}

function duration(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function ip(value: unknown) {
  const normalized = text(value, 80).replace(/^\[|\]$/g, '').toLowerCase();
  if (!normalized || /[\s,/]/.test(normalized) || !isIP(normalized)) return null;
  if (normalized.includes(':')) return normalized;
  return normalized.split('.').map((part) => String(Number(part))).join('.');
}

export function normalizeWorkflowEvent(body: unknown, clientIp: unknown): WorkflowEvent {
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  return {
    operationId: text(input.operation_id ?? input.operationId, 36),
    operation: text(input.operation, 40),
    status: text(input.status, 20),
    workflowKind: text(input.workflow_kind ?? input.workflowKind, 40),
    projectId: text(input.project_id ?? input.projectId, 120),
    projectName: text(input.project_name ?? input.projectName, 255),
    sourceFileNames: fileNames(input.source_file_names ?? input.sourceFileNames),
    exportFileName: fileName(input.export_file_name ?? input.exportFileName),
    failureCode: text(input.failure_code ?? input.failureCode, 40),
    durationMs: duration(input.duration_ms ?? input.durationMs),
    version: text(input.version, 50),
    platform: text(input.platform, 50),
    arch: text(input.arch, 50),
    clientId: text(input.client_id ?? input.clientId, 120),
    clientCreatedAt: date(input.client_created_at ?? input.clientCreatedAt),
    clientIp: ip(clientIp),
  };
}

export function validateWorkflowEvent(event: WorkflowEvent) {
  if (!UUID_PATTERN.test(event.operationId)) return 'invalid operation_id';
  if (!OPERATIONS.has(event.operation)) return 'invalid operation';
  if (!STATUSES.has(event.status)) return 'invalid status';
  if (!WORKFLOW_KINDS.has(event.workflowKind)) return 'invalid workflow_kind';
  if (!event.projectId) return 'missing project_id';
  if (!event.projectName) return 'missing project_name';
  if (!event.clientId) return 'missing client_id';
  if (!event.clientCreatedAt) return 'missing client_created_at';
  if (!event.version) return 'missing version';
  if (event.status === 'started' && event.durationMs !== null) return 'started event cannot include duration_ms';
  if (event.status !== 'started' && event.durationMs === null) return 'terminal event requires duration_ms';
  if (event.status === 'failed' && !FAILURE_CODES.has(event.failureCode)) return 'invalid failure_code';
  if (event.status === 'cancelled' && event.failureCode !== 'cancelled') return 'cancelled event requires cancelled failure_code';
  if ((event.status === 'started' || event.status === 'succeeded') && event.failureCode) return 'successful event cannot include failure_code';
  return '';
}
