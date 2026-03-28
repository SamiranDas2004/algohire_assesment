import { PoolClient } from 'pg';
import { db } from '../lib/db';
import { redis } from '../lib/redis';
import { IngestReading, SensorRule } from '../lib/types';

// Check if sensor is currently suppressed
async function isSuppressed(client: PoolClient, sensorId: string, at: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM suppressions
     WHERE sensor_id = $1 AND start_time <= $2 AND end_time >= $2
     LIMIT 1`,
    [sensorId, at]
  );
  return result.rows.length > 0;
}

// Get last 3 readings for rate-of-change calculation
async function getLastReadings(
  client: PoolClient,
  sensorId: string,
  beforeTimestamp: string,
  metric: string
): Promise<number[]> {
  const result = await client.query(
    `SELECT ${metric} FROM readings
     WHERE sensor_id = $1 AND timestamp < $2
     ORDER BY timestamp DESC
     LIMIT 3`,
    [sensorId, beforeTimestamp]
  );
  return result.rows.map((r: Record<string, unknown>) => Number(r[metric]));
}

async function createAnomalyAndAlert(
  client: PoolClient,
  sensorId: string,
  readingId: string | null,
  ruleType: string,
  metric: string | null,
  detail: Record<string, unknown>,
  severity: string,
  suppressed: boolean
): Promise<void> {
  const anomalyResult = await client.query(
    `INSERT INTO anomalies (sensor_id, reading_id, rule_type, metric, detail, suppressed)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [sensorId, readingId, ruleType, metric, JSON.stringify(detail), suppressed]
  );
  const anomalyId = anomalyResult.rows[0].id;

  await client.query(
    `INSERT INTO alerts (anomaly_id, sensor_id, severity, suppressed)
     VALUES ($1, $2, $3, $4)`,
    [anomalyId, sensorId, severity, suppressed]
  );
}

async function updateSensorStatus(
  client: PoolClient,
  sensorId: string,
  newStatus: string,
  timestamp: string
): Promise<void> {
  const result = await client.query(
    `UPDATE sensors SET status = $1, last_seen_at = $2
     WHERE id = $3 AND status != $1
     RETURNING id, zone_id`,
    [newStatus, timestamp, sensorId]
  );

  // Only publish if status actually changed
  if (result.rows[0]) {
    const { zone_id } = result.rows[0];
    await redis.publish(
      `zone:${zone_id}:sensor_state`,
      JSON.stringify({ sensor_id: sensorId, status: newStatus, timestamp })
    );
  } else {
    // Still update last_seen_at even if status unchanged
    await client.query(
      `UPDATE sensors SET last_seen_at = $1 WHERE id = $2`,
      [timestamp, sensorId]
    );
  }
}

export async function processIngestBatch(queueId: string, readings: IngestReading[]): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE ingest_queue SET status = 'processing', attempts = attempts + 1 WHERE id = $1`, [queueId]);

    for (const reading of readings) {
      // Insert raw reading
      const readingResult = await client.query(
        `INSERT INTO readings (sensor_id, timestamp, voltage, current, temperature, status_code)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [reading.sensor_id, reading.timestamp, reading.voltage, reading.current, reading.temperature, reading.status_code]
      );
      const readingId = readingResult.rows[0].id;

      // Fetch rules for this sensor
      const rulesResult = await client.query<SensorRule>(
        `SELECT * FROM sensor_rules WHERE sensor_id = $1`,
        [reading.sensor_id]
      );
      const rules = rulesResult.rows;

      const suppressed = await isSuppressed(client, reading.sensor_id, reading.timestamp);
      let worstSeverity = 'healthy';

      for (const rule of rules) {
        if (rule.rule_type === 'threshold' && rule.metric) {
          const value = reading[rule.metric as keyof IngestReading] as number;
          const breached =
            (rule.min_value !== null && value < rule.min_value) ||
            (rule.max_value !== null && value > rule.max_value);

          if (breached) {
            await createAnomalyAndAlert(
              client, reading.sensor_id, readingId, 'threshold', rule.metric,
              { value, min: rule.min_value, max: rule.max_value }, rule.severity, suppressed
            );
            if (rule.severity === 'critical') worstSeverity = 'critical';
            else if (worstSeverity !== 'critical') worstSeverity = 'warning';
          }
        }

        if (rule.rule_type === 'rate_of_change' && rule.metric && rule.change_percent !== null) {
          const value = reading[rule.metric as keyof IngestReading] as number;
          const prev = await getLastReadings(client, reading.sensor_id, reading.timestamp, rule.metric);

          if (prev.length > 0) {
            const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
            if (avg !== 0) {
              const changePct = Math.abs((value - avg) / avg) * 100;
              if (changePct > rule.change_percent) {
                await createAnomalyAndAlert(
                  client, reading.sensor_id, readingId, 'rate_of_change', rule.metric,
                  { value, avg, change_pct: changePct, threshold: rule.change_percent },
                  rule.severity, suppressed
                );
                if (rule.severity === 'critical') worstSeverity = 'critical';
                else if (worstSeverity !== 'critical') worstSeverity = 'warning';
              }
            }
          }
        }
      }

      const sensorStatus = worstSeverity === 'healthy' ? 'healthy' : worstSeverity;
      await updateSensorStatus(client, reading.sensor_id, sensorStatus, reading.timestamp);
    }

    await client.query(`UPDATE ingest_queue SET status = 'done', processed_at = NOW() WHERE id = $1`, [queueId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    await db.query(
      `UPDATE ingest_queue SET status = 'failed', error = $1 WHERE id = $2`,
      [String(err), queueId]
    );
    throw err;
  } finally {
    client.release();
  }
}
