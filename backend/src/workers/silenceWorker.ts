import { db } from '../lib/db';
import { redis } from '../lib/redis';

const SILENCE_THRESHOLD_MS = 2 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 1000;

export function startSilenceDetector(): void {
  console.log('[silence] Silence detector started');
  setInterval(detectSilentSensors, POLL_INTERVAL_MS);
  detectSilentSensors().catch(console.error);
}

async function detectSilentSensors(): Promise<void> {
  const cutoff = new Date(Date.now() - SILENCE_THRESHOLD_MS).toISOString();

  const result = await db.query(
    `SELECT s.id AS sensor_id, s.zone_id, s.last_seen_at
     FROM sensors s
     WHERE (s.last_seen_at IS NULL OR s.last_seen_at < $1)
       AND s.status != 'silent'`,
    [cutoff]
  );

  for (const sensor of result.rows) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const suppResult = await client.query(
        `SELECT 1 FROM suppressions
         WHERE sensor_id = $1 AND start_time <= NOW() AND end_time >= NOW() LIMIT 1`,
        [sensor.sensor_id]
      );
      const suppressed = suppResult.rows.length > 0;

      const anomalyResult = await client.query(
        `INSERT INTO anomalies (sensor_id, reading_id, rule_type, metric, detail, suppressed)
         VALUES ($1, NULL, 'pattern_absence', NULL, $2, $3) RETURNING id`,
        [
          sensor.sensor_id,
          JSON.stringify({ last_seen_at: sensor.last_seen_at, silence_threshold_minutes: 2 }),
          suppressed,
        ]
      );
      const anomalyId = anomalyResult.rows[0].id;

      await client.query(
        `INSERT INTO alerts (anomaly_id, sensor_id, severity, suppressed)
         VALUES ($1, $2, 'critical', $3)`,
        [anomalyId, sensor.sensor_id, suppressed]
      );

      await client.query(
        `UPDATE sensors SET status = 'silent' WHERE id = $1`,
        [sensor.sensor_id]
      );

      await client.query('COMMIT');

      await redis.publish(
        `zone:${sensor.zone_id}:sensor_state`,
        JSON.stringify({ sensor_id: sensor.sensor_id, status: 'silent', timestamp: new Date().toISOString() })
      );
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[silence] Error processing sensor ${sensor.sensor_id}:`, err);
    } finally {
      client.release();
    }
  }
}
