import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../lib/types';

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret') as JwtPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function requireSupervisor(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'supervisor') {
    res.status(403).json({ error: 'Supervisor access required' });
    return;
  }
  next();
}

// Returns SQL fragment + params for zone-scoped sensor filtering
// Supervisors get all sensors; operators get only their zones
export function zoneScopeSQL(
  user: JwtPayload,
  sensorAlias = 's',
  paramOffset = 0
): { clause: string; params: string[] } {
  if (user.role === 'supervisor') return { clause: '', params: [] };
  if (user.zoneIds.length === 0) return { clause: 'AND 1=0', params: [] };
  const placeholders = user.zoneIds.map((_, i) => `$${i + 1 + paramOffset}`).join(', ');
  return {
    clause: `AND ${sensorAlias}.zone_id IN (${placeholders})`,
    params: user.zoneIds,
  };
}
