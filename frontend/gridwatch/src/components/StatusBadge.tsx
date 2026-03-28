import type { SensorStatus, AlertSeverity, AlertStatus } from '../types';

const sensorColors: Record<SensorStatus, string> = {
  healthy: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  warning: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  silent: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
};

const severityColors: Record<AlertSeverity, string> = {
  warning: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
};

const alertStatusColors: Record<AlertStatus, string> = {
  open: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  acknowledged: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  resolved: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
};

export function SensorStatusBadge({ status }: { status: SensorStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${sensorColors[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'healthy' ? 'bg-emerald-400' : status === 'warning' ? 'bg-yellow-400' : status === 'critical' ? 'bg-red-400 animate-pulse' : 'bg-slate-400'}`} />
      {status}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${severityColors[severity]}`}>
      {severity}
    </span>
  );
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${alertStatusColors[status]}`}>
      {status}
    </span>
  );
}
