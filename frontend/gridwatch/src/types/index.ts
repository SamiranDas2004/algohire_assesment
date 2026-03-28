export interface User {
  id: string;
  name: string;
  email: string;
  role: 'operator' | 'supervisor';
  zoneIds: string[];
}

export interface Zone {
  id: string;
  name: string;
}

export type SensorStatus = 'healthy' | 'warning' | 'critical' | 'silent';

export interface Sensor {
  id: string;
  name: string;
  zone_id: string;
  zone_name: string;
  last_seen_at: string | null;
  status: SensorStatus;
}

export interface Reading {
  id: string;
  sensor_id: string;
  timestamp: string;
  voltage: number;
  current: number;
  temperature: number;
  status_code: string;
  has_anomaly: boolean;
  anomalies: AnomalyWithAlert[];
}

export interface AnomalyWithAlert {
  anomaly_id: string;
  rule_type: 'threshold' | 'rate_of_change' | 'pattern_absence';
  metric: string | null;
  detail: Record<string, unknown>;
  suppressed: boolean;
  alert_id: string | null;
  alert_status: string | null;
  alert_severity: string | null;
}

export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
  id: string;
  anomaly_id: string;
  sensor_id: string;
  sensor_name: string;
  zone_name: string;
  severity: AlertSeverity;
  status: AlertStatus;
  suppressed: boolean;
  assigned_to: string | null;
  escalated: boolean;
  escalated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  alert_id: string;
  changed_by: string | null;
  changed_by_name: string | null;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
}

export interface Suppression {
  id: string;
  sensor_id: string;
  created_by: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  created_at: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface SensorStateEvent {
  sensor_id: string;
  status: SensorStatus;
  timestamp: string;
}
