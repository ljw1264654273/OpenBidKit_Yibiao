CREATE TABLE IF NOT EXISTS workflow_events (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  operation_id UUID NOT NULL,
  operation VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL,
  workflow_kind VARCHAR(40) NOT NULL,
  project_id VARCHAR(120) NOT NULL,
  project_name VARCHAR(255) NOT NULL,
  source_file_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  export_file_name VARCHAR(255) NOT NULL DEFAULT '',
  failure_code VARCHAR(40) NOT NULL DEFAULT '',
  duration_ms BIGINT,
  app_version VARCHAR(50) NOT NULL,
  platform VARCHAR(50) NOT NULL DEFAULT '',
  arch VARCHAR(50) NOT NULL DEFAULT '',
  client_id VARCHAR(120) NOT NULL,
  client_created_at DATE,
  client_ip INET
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_project_received
  ON workflow_events (project_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_events_operation_status_received
  ON workflow_events (operation, status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_events_operation_id
  ON workflow_events (operation_id);
