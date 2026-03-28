export interface User {
  id: string;
  email: string;
  name: string;
  role: 'operator' | 'supervisor';
  supervisor_id: string | null;
}

export interface Sensor {
  id: string;
  name: string;
  zone_id: string;
  last_seen_at: string | null;
  status: 'healthy' | 'warning' | 'critical' | 'silent';
}

export interface Reading {
  id: string;
  sensor_id: string;
  timestamp: string;
  voltage: number;
  current: number;
  temperature: number;
  status_code: string;
}

export interface SensorRule {
  id: string;
  sensor_id: string;
  rule_type: 'threshold' | 'rate_of_change';
  metric: 'voltage' | 'current' | 'temperature' | null;
  min_value: number | null;
  max_value: number | null;
  change_percent: number | null;
  severity: 'warning' | 'critical';
}

export interface Anomaly {
  id: string;
  sensor_id: string;
  reading_id: string | null;
  rule_type: 'threshold' | 'rate_of_change' | 'pattern_absence';
  metric: string | null;
  detail: Record<string, unknown>;
  suppressed: boolean;
  created_at: string;
}

export interface Alert {
  id: string;
  anomaly_id: string;
  sensor_id: string;
  severity: 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  suppressed: boolean;
  assigned_to: string | null;
  escalated: boolean;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JwtPayload {
  userId: string;
  role: 'operator' | 'supervisor';
  zoneIds: string[];
}

export interface IngestReading {
  sensor_id: string;
  timestamp: string;
  voltage: number;
  current: number;
  temperature: number;
  status_code: string;
}
