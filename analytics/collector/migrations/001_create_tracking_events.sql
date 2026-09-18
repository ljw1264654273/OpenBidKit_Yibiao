CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  project_name VARCHAR(80) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  page VARCHAR(120) NOT NULL DEFAULT '',
  app_version VARCHAR(50) NOT NULL,
  platform VARCHAR(50) NOT NULL DEFAULT '',
  arch VARCHAR(50) NOT NULL DEFAULT '',
  client_id VARCHAR(120) NOT NULL,
  client_created_at DATE,
  client_ip INET,
  config_key VARCHAR(80) NOT NULL DEFAULT '',
  config_value VARCHAR(200) NOT NULL DEFAULT '',
  ai_request_type VARCHAR(20) NOT NULL DEFAULT '',
  ai_model_provider VARCHAR(80) NOT NULL DEFAULT '',
  ai_model_endpoint_host VARCHAR(120) NOT NULL DEFAULT '',
  ai_model_name VARCHAR(160) NOT NULL DEFAULT '',
  resource_key VARCHAR(80) NOT NULL DEFAULT '',
  agent_runtime_kind VARCHAR(40) NOT NULL DEFAULT '',
  agent_runtime_status VARCHAR(20) NOT NULL DEFAULT '',
  agent_runtime_retry_count INTEGER NOT NULL DEFAULT 0,
  agent_runtime_model_retry_count INTEGER NOT NULL DEFAULT 0,
  license_status VARCHAR(30) NOT NULL DEFAULT '',
  license_plan VARCHAR(40) NOT NULL DEFAULT '',
  license_expires_at DATE,
  source_trusted VARCHAR(20) NOT NULL DEFAULT '',
  untrusted_reason VARCHAR(80) NOT NULL DEFAULT '',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_project_received
  ON tracking_events (project_name, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracking_events_project_event_received
  ON tracking_events (project_name, event_type, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracking_events_client_received
  ON tracking_events (project_name, client_id, received_at DESC);
