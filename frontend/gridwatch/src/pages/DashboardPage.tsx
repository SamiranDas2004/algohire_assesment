import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wifi, RefreshCw, Radio } from 'lucide-react';
import { sensorsApi } from '../api';
import { useWs } from '../context/WsContext';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import type { Sensor, SensorStatus } from '../types';

const STATUS_ORDER: SensorStatus[] = ['critical', 'warning', 'silent', 'healthy'];

const STATUS_DOT: Record<SensorStatus, string> = {
  critical: 'bg-red-400 animate-pulse',
  warning: 'bg-yellow-400',
  silent: 'bg-slate-500',
  healthy: 'bg-emerald-400',
};

export function DashboardPage() {
  const { user } = useAuth();
  const { on } = useWs();
  const navigate = useNavigate();
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [recentChanges, setRecentChanges] = useState<Set<string>>(new Set());

  const fetchSensors = useCallback(async () => {
    try {
      const data = await sensorsApi.list();
      setSensors(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSensors(); }, [fetchSensors]);

  // Real-time WebSocket — no polling
  useEffect(() => {
    const unsub = on((event) => {
      setSensors((prev) =>
        prev.map((s) =>
          s.id === event.sensor_id ? { ...s, status: event.status, last_seen_at: event.timestamp } : s
        )
      );
      setLastUpdate(new Date());
      // Flash the card that changed
      setRecentChanges((prev) => new Set(prev).add(event.sensor_id));
      setTimeout(() => {
        setRecentChanges((prev) => {
          const next = new Set(prev);
          next.delete(event.sensor_id);
          return next;
        });
      }, 3000);
    });
    return unsub;
  }, [on]);

  const zones = Array.from(new Set(sensors.map((s) => s.zone_name))).sort();

  const counts: Record<SensorStatus, number> = {
    critical: sensors.filter((s) => s.status === 'critical').length,
    warning: sensors.filter((s) => s.status === 'warning').length,
    silent: sensors.filter((s) => s.status === 'silent').length,
    healthy: sensors.filter((s) => s.status === 'healthy').length,
  };

  const filterSensors = (zoneSensors: Sensor[]) =>
    zoneSensors
      .filter((s) => statusFilter === 'all' || s.status === statusFilter)
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Sensor Dashboard</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {user?.role === 'supervisor' ? 'All zones' : 'Your assigned zones'} · {sensors.length} sensors total
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
          <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400 font-medium">Live · {lastUpdate.toLocaleTimeString()}</span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(['critical', 'warning', 'silent', 'healthy'] as SensorStatus[]).map((s) => (
          <Card
            key={s}
            className={`cursor-pointer transition-all hover:border-slate-600 ${statusFilter === s ? 'border-blue-500 bg-blue-500/5' : ''}`}
            onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[s]}`} />
                <Badge variant={s}>{s}</Badge>
              </div>
              <p className="text-3xl font-bold text-white">{counts[s]}</p>
              <p className="text-xs text-slate-500 mt-0.5">sensors</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Zone tabs */}
      <Tabs defaultValue="all">
        <div className="flex items-center justify-between mb-2">
          <TabsList>
            <TabsTrigger value="all">All Zones</TabsTrigger>
            {zones.map((z) => (
              <TabsTrigger key={z} value={z}>{z}</TabsTrigger>
            ))}
          </TabsList>
          <div className="flex gap-2">
            {(['all', 'critical', 'warning', 'silent', 'healthy'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize ${statusFilter === s ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* All zones tab */}
        <TabsContent value="all">
          <SensorGrid
            sensors={filterSensors(sensors)}
            recentChanges={recentChanges}
            onSelect={(id) => navigate(`/sensors/${id}`)}
          />
        </TabsContent>

        {/* Per-zone tabs */}
        {zones.map((zone) => (
          <TabsContent key={zone} value={zone}>
            <SensorGrid
              sensors={filterSensors(sensors.filter((s) => s.zone_name === zone))}
              recentChanges={recentChanges}
              onSelect={(id) => navigate(`/sensors/${id}`)}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function SensorGrid({
  sensors,
  recentChanges,
  onSelect,
}: {
  sensors: Sensor[];
  recentChanges: Set<string>;
  onSelect: (id: string) => void;
}) {
  if (sensors.length === 0) {
    return <div className="text-center py-16 text-slate-500 text-sm">No sensors match the current filter</div>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
      {sensors.map((sensor) => (
        <button
          key={sensor.id}
          onClick={() => onSelect(sensor.id)}
          className={`group relative bg-slate-900 border rounded-xl p-3 text-left transition-all hover:scale-105 hover:shadow-lg ${
            recentChanges.has(sensor.id) ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-slate-950' : ''
          } ${
            sensor.status === 'critical'
              ? 'border-red-500/50 shadow-red-500/10 shadow-md'
              : sensor.status === 'warning'
              ? 'border-yellow-500/30'
              : sensor.status === 'silent'
              ? 'border-slate-600/50'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`w-2 h-2 rounded-full ${STATUS_DOT[sensor.status]}`} />
            {recentChanges.has(sensor.id) && (
              <Wifi className="w-3 h-3 text-blue-400 animate-pulse" />
            )}
          </div>
          <p className="text-xs font-semibold text-white truncate">{sensor.name}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{sensor.zone_name}</p>
          <p className="text-xs text-slate-700 truncate mt-0.5 font-mono">{sensor.id.slice(0, 8)}...</p>
          {sensor.last_seen_at && (
            <p className="text-xs text-slate-600 mt-1">{new Date(sensor.last_seen_at).toLocaleTimeString()}</p>
          )}
          <div className="mt-2">
            <Badge variant={sensor.status} className="text-xs py-0 px-1.5">{sensor.status}</Badge>
          </div>
        </button>
      ))}
    </div>
  );
}
