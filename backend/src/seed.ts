import { db } from './lib/db';
import bcrypt from 'bcryptjs';

const ZONES = ['Zone Alpha', 'Zone Beta', 'Zone Gamma'];
const SENSORS_PER_ZONE = 334; // ~1000 total
const READINGS_HOURS = 48;
const READING_INTERVAL_SECONDS = 10;

async function seed(): Promise<void> {
  console.log('[seed] Starting...');
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Zones
    const zoneIds: string[] = [];
    for (const name of ZONES) {
      const r = await client.query(
        `INSERT INTO zones (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [name]
      );
      zoneIds.push(r.rows[0].id);
    }
    console.log('[seed] Zones created:', zoneIds.length);

    // Supervisor
    const supHash = await bcrypt.hash('supervisor123', 10);
    const supResult = await client.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ('supervisor@gridwatch.io', $1, 'Grid Supervisor', 'supervisor')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
      [supHash]
    );
    const supervisorId = supResult.rows[0].id;

    // Operators — one per zone (zone 0 and zone 1)
    const operatorIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const hash = await bcrypt.hash(`operator${i + 1}123`, 10);
      const r = await client.query(
        `INSERT INTO users (email, password_hash, name, role, supervisor_id)
         VALUES ($1, $2, $3, 'operator', $4)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
        [`operator${i + 1}@gridwatch.io`, hash, `Operator ${i + 1}`, supervisorId]
      );
      operatorIds.push(r.rows[0].id);
      await client.query(
        `INSERT INTO zone_assignments (user_id, zone_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [r.rows[0].id, zoneIds[i]]
      );
    }
    console.log('[seed] Users created');

    // Sensors + rules
    const sensorIds: { id: string; zoneId: string }[] = [];
    for (let z = 0; z < zoneIds.length; z++) {
      for (let s = 0; s < SENSORS_PER_ZONE; s++) {
        const sensorNum = z * SENSORS_PER_ZONE + s + 1;
        const r = await client.query(
          `INSERT INTO sensors (name, zone_id) VALUES ($1, $2) RETURNING id`,
          [`Sensor-${String(sensorNum).padStart(4, '0')}`, zoneIds[z]]
        );
        const sensorId = r.rows[0].id;
        sensorIds.push({ id: sensorId, zoneId: zoneIds[z] });

        // Threshold rule (voltage)
        await client.query(
          `INSERT INTO sensor_rules (sensor_id, rule_type, metric, min_value, max_value, severity)
           VALUES ($1, 'threshold', 'voltage', 200, 250, 'critical')`,
          [sensorId]
        );
        // Threshold rule (temperature)
        await client.query(
          `INSERT INTO sensor_rules (sensor_id, rule_type, metric, min_value, max_value, severity)
           VALUES ($1, 'threshold', 'temperature', 0, 85, 'warning')`,
          [sensorId]
        );
        // Rate-of-change rule
        await client.query(
          `INSERT INTO sensor_rules (sensor_id, rule_type, metric, change_percent, severity)
           VALUES ($1, 'rate_of_change', 'voltage', 20, 'warning')`,
          [sensorId]
        );
      }
    }
    console.log('[seed] Sensors + rules created:', sensorIds.length);

    // Mark ALL sensors as healthy with last_seen_at = NOW() so silence worker doesn't fire on seed data
    await client.query(`UPDATE sensors SET last_seen_at = NOW(), status = 'healthy'`);

    await client.query('COMMIT');

    // Insert readings in batches (outside transaction for performance)
    console.log('[seed] Inserting readings (this may take a minute)...');
    const now = Date.now();
    const totalReadings = READINGS_HOURS * 3600 / READING_INTERVAL_SECONDS;
    const BATCH_SIZE = 500;

    // Seed readings for first 50 sensors to keep seed time reasonable
    const seedSensors = sensorIds.slice(0, 50);

    for (const sensor of seedSensors) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let pi = 1;

      for (let i = totalReadings; i >= 0; i--) {
        const ts = new Date(now - i * READING_INTERVAL_SECONDS * 1000).toISOString();
        const voltage = 220 + Math.random() * 10 - 5;
        const current = 10 + Math.random() * 2;
        const temperature = 40 + Math.random() * 10;
        const statusCode = 'OK';

        placeholders.push(`($${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++}, $${pi++})`);
        values.push(sensor.id, ts, voltage, current, temperature, statusCode);

        if (placeholders.length >= BATCH_SIZE) {
          await db.query(
            `INSERT INTO readings (sensor_id, timestamp, voltage, current, temperature, status_code)
             VALUES ${placeholders.join(',')}`,
            values
          );
          placeholders.length = 0;
          values.length = 0;
          pi = 1;
        }
      }

      if (placeholders.length > 0) {
        await db.query(
          `INSERT INTO readings (sensor_id, timestamp, voltage, current, temperature, status_code)
           VALUES ${placeholders.join(',')}`,
          values
        );
      }

      // Keep last_seen_at fresh for sensors with readings
      await db.query(
        `UPDATE sensors SET last_seen_at = NOW(), status = 'healthy' WHERE id = $1`,
        [sensor.id]
      );
    }

    console.log('[seed] Done!');
    console.log('');
    console.log('=== Seed Credentials ===');
    console.log('Supervisor:  supervisor@gridwatch.io / supervisor123');
    console.log('Operator 1:  operator1@gridwatch.io  / operator1123  (Zone Alpha)');
    console.log('Operator 2:  operator2@gridwatch.io  / operator2123  (Zone Beta)');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[seed] Error:', err);
    process.exit(1);
  } finally {
    client.release();
    await db.end();
  }
}

seed();
