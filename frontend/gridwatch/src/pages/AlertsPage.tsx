import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { alertsApi } from '../api';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../components/ui/dialog';
import type { Alert, AlertStatus, AuditLog } from '../types';

const TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  open: ['acknowledged', 'resolved'],
  acknowledged: ['resolved'],
  resolved: [],
};

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [auditAlert, setAuditAlert] = useState<Alert | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await alertsApi.list({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        severity: severityFilter !== 'all' ? severityFilter : undefined,
        page,
        limit: 50,
      });
      setAlerts(data.data);
      setTotal(data.pagination.total);
      setTotalPages(data.pagination.pages);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, page]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const handleTransition = async (alert: Alert, newStatus: AlertStatus) => {
    setTransitioning(alert.id);
    try {
      await alertsApi.transition(alert.id, newStatus);
      await fetchAlerts();
    } finally {
      setTransitioning(null);
    }
  };

  const openAudit = async (alert: Alert) => {
    setAuditAlert(alert);
    setAuditLoading(true);
    try {
      const logs = await alertsApi.audit(alert.id);
      setAuditLogs(logs);
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Alert Management</h1>
          <p className="text-sm text-slate-400 mt-0.5">{total} alerts found</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <TabsList>
            {['all', 'open', 'acknowledged', 'resolved'].map((s) => (
              <TabsTrigger key={s} value={s} className="capitalize">{s}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(1); }}>
          <TabsList>
            {['all', 'critical', 'warning'].map((s) => (
              <TabsTrigger key={s} value={s} className="capitalize">{s}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Sensor</th>
                  <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Zone</th>
                  <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Severity</th>
                  <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Status</th>
                  <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Created</th>
                  <th className="text-left px-5 py-3.5 text-slate-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-slate-500">Loading alerts...</td>
                  </tr>
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-16 text-slate-500">
                      <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                      No alerts found
                    </td>
                  </tr>
                ) : (
                  alerts.map((alert) => (
                    <tr key={alert.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-medium">{alert.sensor_name}</span>
                          {alert.escalated && <Badge variant="escalated">escalated</Badge>}
                          {alert.suppressed && <Badge variant="suppressed">suppressed</Badge>}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-400">{alert.zone_name}</td>
                      <td className="px-5 py-3.5">
                        <Badge variant={alert.severity}>{alert.severity}</Badge>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge variant={alert.status}>{alert.status}</Badge>
                      </td>
                      <td className="px-5 py-3.5 text-slate-400 text-xs whitespace-nowrap">
                        {new Date(alert.created_at).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          {TRANSITIONS[alert.status].map((next) => (
                            <Button
                              key={next}
                              size="sm"
                              variant={next === 'acknowledged' ? 'warning' : 'success'}
                              disabled={transitioning === alert.id}
                              onClick={() => handleTransition(alert, next)}
                            >
                              {next}
                            </Button>
                          ))}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAudit(alert)}
                          >
                            <History className="w-3.5 h-3.5" />
                            Audit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            <ChevronLeft className="w-4 h-4" /> Previous
          </Button>
          <span className="text-sm text-slate-400">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Audit trail dialog */}
      <Dialog open={!!auditAlert} onOpenChange={(open) => !open && setAuditAlert(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Audit Trail</DialogTitle>
            <DialogDescription>
              {auditAlert?.sensor_name} · {auditAlert?.zone_name}
            </DialogDescription>
          </DialogHeader>
          {auditLoading ? (
            <p className="text-slate-400 text-sm py-4 text-center">Loading...</p>
          ) : auditLogs.length === 0 ? (
            <p className="text-slate-500 text-sm py-4 text-center">No audit entries yet</p>
          ) : (
            <div className="space-y-3 mt-2">
              {auditLogs.map((log) => (
                <div key={log.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                  <div className="flex items-center gap-2 mb-1.5">
                    {log.from_status && (
                      <>
                        <Badge variant={log.from_status as AlertStatus}>{log.from_status}</Badge>
                        <span className="text-slate-500 text-xs">→</span>
                      </>
                    )}
                    <Badge variant={log.to_status as AlertStatus}>{log.to_status}</Badge>
                  </div>
                  {log.note && (
                    <p className="text-xs text-slate-400 mb-1.5 italic">"{log.note}"</p>
                  )}
                  <p className="text-xs text-slate-500">
                    {log.changed_by_name || 'System'} · {new Date(log.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
