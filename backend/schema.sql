CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator', 'supervisor')),
  supervisor_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE zone_assignments (
  user_id UUID NOT NULL REFERENCES users(id),
  zone_id UUID NOT NULL REFERENCES zones(id),
  PRIMARY KEY (user_id, zone_id)
);

CREATE TABLE sensors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  zone_id UUID NOT NULL REFERENCES zones(id),
  last_seen_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy', 'warning', 'critical', 'silent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sensors_zone ON sensors(zone_id);
CREATE INDEX idx_sensors_last_seen ON sensors(last_seen_at);

CREATE TABLE sensor_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id UUID NOT NULL REFERENCES sensors(id),
  rule_type TEXT NOT NULL CHECK (rule_type IN ('threshold', 'rate_of_change')),
  metric TEXT CHECK (metric IN ('voltage', 'current', 'temperature')),
  min_value NUMERIC,
  max_value NUMERIC,
  change_percent NUMERIC,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sensor_rules_sensor ON sensor_rules(sensor_id);

CREATE TABLE readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id UUID NOT NULL REFERENCES sensors(id),
  timestamp TIMESTAMPTZ NOT NULL,
  voltage NUMERIC NOT NULL,
  current NUMERIC NOT NULL,
  temperature NUMERIC NOT NULL,
  status_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_readings_sensor_ts ON readings(sensor_id, timestamp DESC);
CREATE INDEX idx_readings_ts ON readings(timestamp DESC);

CREATE TABLE ingest_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_ingest_queue_status ON ingest_queue(status) WHERE status IN ('pending', 'failed');

CREATE TABLE anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id UUID NOT NULL REFERENCES sensors(id),
  reading_id UUID REFERENCES readings(id),
  rule_type TEXT NOT NULL CHECK (rule_type IN ('threshold', 'rate_of_change', 'pattern_absence')),
  metric TEXT,
  detail JSONB NOT NULL DEFAULT '{}',
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_anomalies_sensor ON anomalies(sensor_id);
CREATE INDEX idx_anomalies_reading ON anomalies(reading_id);
CREATE INDEX idx_anomalies_created ON anomalies(created_at DESC);

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anomaly_id UUID NOT NULL REFERENCES anomalies(id),
  sensor_id UUID NOT NULL REFERENCES sensors(id),
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_to UUID REFERENCES users(id),
  escalated BOOLEAN NOT NULL DEFAULT FALSE,
  escalated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_sensor ON alerts(sensor_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX idx_alerts_escalation ON alerts(created_at) WHERE status = 'open' AND severity = 'critical' AND escalated = FALSE;

CREATE TABLE alert_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alerts(id),
  changed_by UUID REFERENCES users(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_alert ON alert_audit_log(alert_id);

CREATE TABLE escalation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES alerts(id) UNIQUE,
  escalated_to UUID NOT NULL REFERENCES users(id),
  escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id UUID NOT NULL REFERENCES sensors(id),
  created_by UUID NOT NULL REFERENCES users(id),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_suppressions_sensor ON suppressions(sensor_id);
CREATE INDEX idx_suppressions_active ON suppressions(sensor_id, start_time, end_time);
