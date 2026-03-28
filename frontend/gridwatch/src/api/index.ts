import api from './client';
import type { Alert, AlertStatus, PaginatedResponse, Reading, Sensor, Suppression, AuditLog, User } from '../types';

export const authApi = {
  login: async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    return res.data;
  },
};

export const sensorsApi = {
  list: async () => {
    const res = await api.get<Sensor[]>('/sensors');
    return res.data;
  },
  get: async (id: string) => {
    const res = await api.get<Sensor>(`/sensors/${id}`);
    return res.data;
  },
  history: async (id: string, from: string, to: string, page = 1, limit = 100) => {
    const res = await api.get<PaginatedResponse<Reading>>(`/sensors/${id}/history`, {
      params: { from, to, page, limit },
    });
    return res.data;
  },
  activeAnomalies: async (id: string) => {
    const res = await api.get<PaginatedResponse<Alert>>(`/alerts`, {
      params: { sensor_id: id, status: 'open', limit: 20 },
    });
    return res.data;
  },
  suppress: async (id: string, start_time: string, end_time: string, reason?: string) => {
    const res = await api.post<Suppression>(`/sensors/${id}/suppress`, { start_time, end_time, reason });
    return res.data;
  },
  suppressions: async (id: string) => {
    const res = await api.get<Suppression[]>(`/sensors/${id}/suppressions`);
    return res.data;
  },
};

export const alertsApi = {
  list: async (params?: { status?: string; severity?: string; sensor_id?: string; page?: number; limit?: number }) => {
    const res = await api.get<PaginatedResponse<Alert>>('/alerts', { params });
    return res.data;
  },
  get: async (id: string) => {
    const res = await api.get<Alert>(`/alerts/${id}`);
    return res.data;
  },
  transition: async (id: string, status: AlertStatus, note?: string) => {
    const res = await api.patch<{ id: string; status: string; updated: boolean }>(`/alerts/${id}`, { status, note });
    return res.data;
  },
  audit: async (id: string) => {
    const res = await api.get<AuditLog[]>(`/alerts/${id}/audit`);
    return res.data;
  },
};
