import { Router, Response } from 'express';
import { db } from '../lib/db';
import { authenticate, AuthRequest, zoneScopeSQL } from '../middleware/auth';

export const sensorsRouter = Router();

sensorsRouter.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const { clause, params } = zoneScopeSQL(user, 's', 0);

  const result = await db.query(
    `SELECT s.id, s.name, s.zone_id, z.name AS zone_name, s.last_seen_at, s.status
     FROM sensors s
     JOIN zones z ON z.id = s.zone_id
     WHERE 1=1 ${clause}
     ORDER BY s.name`,
    params
  );
  res.json(result.rows);
});

sensorsRouter.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const { clause, params } = zoneScopeSQL(user, 's', 1);

  const result = await db.query(
    `SELECT s.id, s.name, s.zone_id, z.name AS zone_name, s.last_seen_at, s.status
     FROM sensors s
     JOIN zones z ON z.id = s.zone_id
     WHERE s.id = $1 ${clause}`,
    [req.params.id, ...params]
  );
  if (!result.rows[0]) {
    res.status(404).json({ error: 'Sensor not found' });
    return;
  }
  res.json(result.rows[0]);
});

sensorsRouter.get('/:id/history', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const sensorId = req.params.id;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(500, parseInt(req.query.limit as string) || 100);
  const offset = (page - 1) * limit;

  if (!from || !to) {
    res.status(400).json({ error: 'from and to are required' });
    return;
  }

  const { clause, params } = zoneScopeSQL(user, 's', 1);
  const scopeCheck = await db.query(
    `SELECT 1 FROM sensors s WHERE s.id = $1 ${clause}`,
    [sensorId, ...params]
  );
  if (!scopeCheck.rows[0]) {
    res.status(404).json({ error: 'Sensor not found' });
    return;
  }

  const result = await db.query(
    `SELECT
       r.id,
       r.sensor_id,
       r.timestamp,
       r.voltage,
       r.current,
       r.temperature,
       r.status_code,
       CASE WHEN COUNT(an.id) > 0 THEN TRUE ELSE FALSE END AS has_anomaly,
       COALESCE(
         json_agg(
           json_build_object(
             'anomaly_id', an.id,
             'rule_type', an.rule_type,
             'metric', an.metric,
             'detail', an.detail,
             'suppressed', an.suppressed,
             'alert_id', al.id,
             'alert_status', al.status,
             'alert_severity', al.severity
           )
         ) FILTER (WHERE an.id IS NOT NULL),
         '[]'
       ) AS anomalies
     FROM readings r
     LEFT JOIN anomalies an ON an.reading_id = r.id
     LEFT JOIN alerts al ON al.anomaly_id = an.id
     WHERE r.sensor_id = $1
       AND r.timestamp >= $2
       AND r.timestamp <= $3
     GROUP BY r.id
     ORDER BY r.timestamp DESC
     LIMIT $4 OFFSET $5`,
    [sensorId, from, to, limit, offset]
  );

  const countResult = await db.query(
    `SELECT COUNT(*) FROM readings WHERE sensor_id = $1 AND timestamp >= $2 AND timestamp <= $3`,
    [sensorId, from, to]
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

sensorsRouter.post('/:id/suppress', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const sensorId = req.params.id;
  const { start_time, end_time, reason } = req.body;

  if (!start_time || !end_time) {
    res.status(400).json({ error: 'start_time and end_time required' });
    return;
  }

  const startDate = new Date(start_time);
  const endDate = new Date(end_time);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    res.status(400).json({ error: 'start_time and end_time must be valid ISO dates' });
    return;
  }

  if (endDate <= startDate) {
    res.status(400).json({ error: 'end_time must be after start_time' });
    return;
  }

  const { clause, params } = zoneScopeSQL(user, 's', 1);
  const scopeCheck = await db.query(
    `SELECT 1 FROM sensors s WHERE s.id = $1 ${clause}`,
    [sensorId, ...params]
  );
  if (!scopeCheck.rows[0]) {
    res.status(404).json({ error: 'Sensor not found' });
    return;
  }

  const result = await db.query(
    `INSERT INTO suppressions (sensor_id, created_by, start_time, end_time, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [sensorId, user.userId, start_time, end_time, reason || null]
  );

  res.status(201).json(result.rows[0]);
});

sensorsRouter.get('/:id/suppressions', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  const sensorId = req.params.id;

  const { clause, params } = zoneScopeSQL(user, 's', 1);
  const scopeCheck = await db.query(
    `SELECT 1 FROM sensors s WHERE s.id = $1 ${clause}`,
    [sensorId, ...params]
  );
  if (!scopeCheck.rows[0]) {
    res.status(404).json({ error: 'Sensor not found' });
    return;
  }

  const result = await db.query(
    `SELECT * FROM suppressions WHERE sensor_id = $1 ORDER BY start_time DESC`,
    [sensorId]
  );
  res.json(result.rows);
});
