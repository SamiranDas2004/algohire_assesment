import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, ShieldOff, ChevronLeft, ChevronRight, Copy, Check, Zap } from 'lucide-react';
import { sensorsApi, alertsApi } from '../api';
import { useWs } from '../context/WsContext';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Label } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import type { Sensor, Reading, Suppression, Alert, AlertStatus } from '../types';

export function SensorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { on } = useWs();

  const [sensor, setSensor] = useState<Sensor | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [showSuppressDialog, setShowSuppressDialog] = useState(false);
  const [suppStart, setSuppStart] = useState('');
  const [suppEnd, setSuppEnd] = useState('');
  const [suppReason, setSuppReason] = useState('');
  const [suppLoading, setSuppLoading] = useState(false);
  const [suppError, setSuppError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    // Use tomorrow as `to` so readings with future UTC timestamps (IST offset) are included
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const [sensorData, historyData, suppData, alertsData] = await Promise.all([
        sensorsApi.get(id),
        sensorsApi.history(id, from, to, page, 50),
        sensorsApi.suppressions(id),
        alertsApi.list({ sensor_id: id, status: 'open', limit: 20 }),
      ]);
      setSensor(sensorData);
      setReadings(historyData.data);
      setTotalPages(historyData.pagination.pages);
      setTotal(historyData.pagination.total);
      setSuppressions(suppData);
      setActiveAlerts(alertsData.data);
    } catch (err) {
      console.error('[SensorDetail] fetchAll error:', err);
    } finally {
      setLoading(false);
    }
  }, [id, page]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Real-time status update via WebSocket
  useEffect(() => {
    const unsub = on((event) => {
      if (event.sensor_id === id) {
        setSensor((prev) => prev ? { ...prev, status: event.status, last_seen_at: event.timestamp } : prev);
      }
    });
    return unsub;
  }, [on, id]);

  const handleSuppress = async () => {
    if (!id || !suppStart || !suppEnd) return;
    setSuppError(null);

    const startDate = new Date(suppStart);
    const endDate = new Date(suppEnd);

    if (endDate <= startDate) {
      setSuppError('End time must be after start time.');
      return;
    }

    setSuppLoading(true);
    try {
      await sensorsApi.suppress(id, startDate.toISOString(), endDate.toISOString(), suppReason || undefined);
      setShowSuppressDialog(false);
      setSuppStart(''); setSuppEnd(''); setSuppReason(''); setSuppError(null);
      const suppData = await sensorsApi.suppressions(id);
      setSuppressions(suppData);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSuppError(msg || 'Failed to create suppression. Please try again.');
    } finally {
      setSuppLoading(false);
    }
  };

  const [copied, setCopied] = useState(false);

  const copyId = () => {
    if (!sensor) return;
    navigator.clipboard.writeText(sensor.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTransition = async (alertId: string, newStatus: AlertStatus) => {
    setTransitioning(alertId);
    try {
      await alertsApi.transition(alertId, newStatus);
      await fetchAll();
    } finally {
      setTransitioning(null);
    }
  };

  const activeSuppression = suppressions.find(
    (s) => new Date(s.start_time) <= new Date() && new Date(s.end_time) >= new Date()
  );

  if (loading && !sensor) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading...</div>;
  }
  if (!sensor) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Sensor not found</div>;
  }

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-white">{sensor.name}</h1>
            <Badge variant={sensor.status}>{sensor.status}</Badge>
            {activeSuppression && (
              <Badge variant="suppressed">
                <Clock className="w-3 h-3" /> Suppressed
              </Badge>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            {sensor.zone_name} · Last seen: {sensor.last_seen_at ? new Date(sensor.last_seen_at).toLocaleString() : 'Never'}
          </p>
          <button
            onClick={copyId}
            className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 hover:text-slate-300 transition-colors font-mono group"
          >
            <span>{sensor.id}</span>
            {copied
              ? <Check className="w-3 h-3 text-emerald-400" />
              : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
          </button>
        </div>
        <Button variant="outline" onClick={() => setShowSuppressDialog(true)}>
          <ShieldOff className="w-4 h-4" />
          Add Suppression
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Total Readings (30d)</p>
            <p className="text-2xl font-bold text-white">{total.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Active Open Alerts</p>
            <p className={`text-2xl font-bold ${activeAlerts.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {activeAlerts.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Active Suppression</p>
            <p className="text-2xl font-bold text-white">{activeSuppression ? 'Yes' : 'No'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Active suppression banner */}
      {activeSuppression && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Clock className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-yellow-400">Active Suppression Window</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {new Date(activeSuppression.start_time).toLocaleString()} → {new Date(activeSuppression.end_time).toLocaleString()}
              </p>
              {activeSuppression.reason && (
                <p className="text-xs text-slate-500 mt-0.5">Reason: {activeSuppression.reason}</p>
              )}
              <p className="text-xs text-slate-500 mt-1">
                Anomalies are still recorded but alerts will not escalate during this window.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Anomalies */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              Active Anomalies
            </CardTitle>
            <Badge variant={activeAlerts.length > 0 ? 'critical' : 'healthy'}>
              {activeAlerts.length} open
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="mt-4">
          {activeAlerts.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-slate-500 text-sm">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              No active anomalies — sensor is operating normally
            </div>
          ) : (
            <div className="space-y-3">
              {activeAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-start justify-between gap-4 p-4 rounded-xl border ${
                    alert.severity === 'critical'
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'border-yellow-500/30 bg-yellow-500/5'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${
                      alert.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'
                    }`} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={alert.severity}>{alert.severity}</Badge>
                        <Badge variant={alert.status}>{alert.status}</Badge>
                        {alert.suppressed && <Badge variant="suppressed">suppressed</Badge>}
                        {alert.escalated && <Badge variant="escalated">escalated</Badge>}
                      </div>
                      <p className="text-xs text-slate-400 mt-1.5">
                        Created {new Date(alert.created_at).toLocaleString()}
                      </p>
                      {alert.escalated_at && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Escalated at {new Date(alert.escalated_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {alert.status === 'open' && (
                      <Button
                        size="sm"
                        variant="warning"
                        disabled={transitioning === alert.id}
                        onClick={() => handleTransition(alert.id, 'acknowledged')}
                      >
                        Acknowledge
                      </Button>
                    )}
                    {(alert.status === 'open' || alert.status === 'acknowledged') && (
                      <Button
                        size="sm"
                        variant="success"
                        disabled={transitioning === alert.id}
                        onClick={() => handleTransition(alert.id, 'resolved')}
                      >
                        Resolve
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Readings table */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Readings — Last 30 Days</CardTitle>
            <span className="text-xs text-slate-500">{total.toLocaleString()} total</span>
          </div>
        </CardHeader>
        <CardContent className="p-0 mt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Timestamp</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Voltage</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Current</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Temp</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Code</th>
                  <th className="text-left px-5 py-3 text-slate-400 font-medium">Anomaly</th>
                </tr>
              </thead>
              <tbody>
                {readings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-500">No readings in this window</td>
                  </tr>
                ) : (
                  readings.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors ${r.has_anomaly ? 'bg-red-500/5' : ''}`}
                    >
                      <td className="px-5 py-3 text-slate-300 text-xs whitespace-nowrap">
                        {new Date(r.timestamp).toLocaleString()}
                      </td>
                      <td className={`px-5 py-3 font-mono text-xs ${Number(r.voltage) < 200 || Number(r.voltage) > 250 ? 'text-red-400 font-semibold' : 'text-slate-300'}`}>
                        {Number(r.voltage).toFixed(1)}V
                      </td>
                      <td className="px-5 py-3 text-slate-300 font-mono text-xs">
                        {Number(r.current).toFixed(2)}A
                      </td>
                      <td className={`px-5 py-3 font-mono text-xs ${Number(r.temperature) > 85 ? 'text-yellow-400 font-semibold' : 'text-slate-300'}`}>
                        {Number(r.temperature).toFixed(1)}°C
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs">{r.status_code}</td>
                      <td className="px-5 py-3">
                        {r.has_anomaly ? (
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                            <span className="text-xs text-red-400">
                              {r.anomalies.length} anomal{r.anomalies.length === 1 ? 'y' : 'ies'}
                            </span>
                            <div className="flex gap-1">
                              {r.anomalies.map((a) => (
                                <Badge key={a.anomaly_id} variant="default" className="text-xs py-0 px-1">
                                  {a.rule_type.replace('_', ' ')}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <CheckCircle className="w-3.5 h-3.5 text-slate-700" />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 p-4 border-t border-slate-800">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-4 h-4" /> Previous
              </Button>
              <span className="text-sm text-slate-400">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suppression dialog */}
      <Dialog open={showSuppressDialog} onOpenChange={(open) => { setShowSuppressDialog(open); if (!open) { setSuppStart(''); setSuppEnd(''); setSuppReason(''); setSuppError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Suppression Window</DialogTitle>
            <DialogDescription>
              Anomalies will still be recorded but alerts will not escalate during this window.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Start Time</Label>
              <Input type="datetime-local" value={suppStart} onChange={(e) => { setSuppStart(e.target.value); setSuppError(null); }} />
            </div>
            <div className="space-y-1.5">
              <Label>End Time</Label>
              <Input
                type="datetime-local"
                value={suppEnd}
                onChange={(e) => { setSuppEnd(e.target.value); setSuppError(null); }}
                className={suppError && suppError.includes('End time') ? 'border-red-500' : ''}
              />
              {suppEnd && new Date(suppEnd) < new Date() && (
                <p className="text-xs text-yellow-400 mt-1">⚠ End time is in the past — suppression will be immediately expired.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Input
                type="text"
                value={suppReason}
                onChange={(e) => setSuppReason(e.target.value)}
                placeholder="Planned maintenance..."
              />
            </div>
            {suppError && (
              <p className="text-sm text-red-400">{suppError}</p>
            )}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleSuppress}
                disabled={suppLoading || !suppStart || !suppEnd}
                className="flex-1"
              >
                {suppLoading ? 'Creating...' : 'Create Suppression'}
              </Button>
              <Button variant="outline" onClick={() => { setShowSuppressDialog(false); setSuppStart(''); setSuppEnd(''); setSuppReason(''); setSuppError(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
