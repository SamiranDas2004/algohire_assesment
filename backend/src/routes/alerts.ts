import { Router, Response } from 'express';
import { db } from '../lib/db';
import { authenticate, AuthRequest, zoneScopeSQL } from '../middleware/auth';

export const alertsRouter = Router();

const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['acknowledged', 'resolved'],
  acknowledged: ['resolved'],
  resolved: [],
};

alertsRouter.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const status = req.query.status as string | undefined;
  const severity = req.query.severity as string | undefined;
  const sensorId = req.query.sensor_id as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, parseInt(req.query.limit as string) || 50);
  const offset = (page - 1) * limit;

  const { clause, params } = zoneScopeSQL(user, 's', 0);

  const filters: string[] = [];
  const filterParams: unknown[] = [...params];
  let pi = params.length + 1;

  if (status) { filters.push(`al.status = $${pi++}`); filterParams.push(status); }
  if (severity) { filters.push(`al.severity = $${pi++}`); filterParams.push(severity); }
  if (sensorId) { filters.push(`al.sensor_id = $${pi++}`); filterParams.push(sensorId); }

  const whereClause = filters.length ? `AND ${filters.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT al.*, s.name AS sensor_name, z.name AS zone_name
     FROM alerts al
     JOIN sensors s ON s.id = al.sensor_id
     JOIN zones z ON z.id = s.zone_id
     WHERE 1=1 ${clause} ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    filterParams
  );

  const countResult = await db.query(
    `SELECT COUNT(*) FROM alerts al
     JOIN sensors s ON s.id = al.sensor_id
     WHERE 1=1 ${clause} ${whereClause}`,
    filterParams
  );

  res.json({
    data: result.rows,
    pagination: {
      page,
      limit,
      total: parseInt(countResult.rows[0].count),
      pages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
    },
  });
});

alertsRouter.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const { clause, params } = zoneScopeSQL(user, 's', 1);

  const result = await db.query(
    `SELECT al.*, s.name AS sensor_name, z.name AS zone_name
     FROM alerts al
     JOIN sensors s ON s.id = al.sensor_id
     JOIN zones z ON z.id = s.zone_id
     WHERE al.id = $1 ${clause}`,
    [req.params.id, ...params]
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }
  res.json(result.rows[0]);
});

alertsRouter.patch('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const { status, note } = req.body;

  if (!status) {
    res.status(400).json({ error: 'status required' });
    return;
  }

  const { clause, params } = zoneScopeSQL(user, 's', 1);
  const alertResult = await db.query(
    `SELECT al.* FROM alerts al
     JOIN sensors s ON s.id = al.sensor_id
     WHERE al.id = $1 ${clause}`,
    [req.params.id, ...params]
  );
  const alert = alertResult.rows[0];
  if (!alert) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }

  const allowed = VALID_TRANSITIONS[alert.status] || [];
  if (!allowed.includes(status)) {
    res.status(400).json({ error: `Cannot transition from ${alert.status} to ${status}` });
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE alerts SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, alert.id]
    );

    await client.query(
      `INSERT INTO alert_audit_log (alert_id, changed_by, from_status, to_status, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [alert.id, user.userId, alert.status, status, note || null]
    );

    if (status === 'resolved') {
      const remaining = await client.query(
        `SELECT COUNT(*) FROM alerts
         WHERE sensor_id = $1 AND status IN ('open', 'acknowledged') AND id != $2`,
        [alert.sensor_id, alert.id]
      );
      if (parseInt(remaining.rows[0].count) === 0) {
        await client.query(
          `UPDATE sensors SET status = 'healthy' WHERE id = $1`,
          [alert.sensor_id]
        );
        const sensorResult = await client.query(
          `SELECT zone_id FROM sensors WHERE id = $1`,
          [alert.sensor_id]
        );
        if (sensorResult.rows[0]) {
          const { zone_id } = sensorResult.rows[0];
          const { redis } = await import('../lib/redis');
          await redis.publish(
            `zone:${zone_id}:sensor_state`,
            JSON.stringify({ sensor_id: alert.sensor_id, status: 'healthy', timestamp: new Date().toISOString() })
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ id: alert.id, status, updated: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

alertsRouter.get('/:id/audit', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const { clause, params } = zoneScopeSQL(user, 's', 1);

  const scopeCheck = await db.query(
    `SELECT 1 FROM alerts al JOIN sensors s ON s.id = al.sensor_id WHERE al.id = $1 ${clause}`,
    [req.params.id, ...params]
  );
  if (!scopeCheck.rows[0]) {
    res.status(404).json({ error: 'Alert not found' });
    return;
  }

  const result = await db.query(
    `SELECT l.*, u.name AS changed_by_name
     FROM alert_audit_log l
     LEFT JOIN users u ON u.id = l.changed_by
     WHERE l.alert_id = $1
     ORDER BY l.created_at ASC`,
    [req.params.id]
  );
  res.json(result.rows);
});
