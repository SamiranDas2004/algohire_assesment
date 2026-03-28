import { db } from '../lib/db';
import { processIngestBatch } from './anomalyWorker';
import { IngestReading } from '../lib/types';

const INTERVAL_MS = 30_000;       // every 30 seconds
const SENSORS_PER_TICK = 50;      // simulate 50 sensors per tick

// Anomaly injection rates
const VOLTAGE_SPIKE_CHANCE = 0.05;
const TEMP_SPIKE_CHANCE = 0.05;
const RATE_CHANGE_CHANCE = 0.05;

function generateReading(sensorId: string): IngestReading {
  const now = new Date().toISOString();

  // Normal ranges: voltage 215-235V, current 9-11A, temp 35-55°C
  let voltage = 215 + Math.random() * 20;
  let temperature = 35 + Math.random() * 20;
  const current = 9 + Math.random() * 2;

  // Occasionally inject anomalies for demo purposes
  if (Math.random() < VOLTAGE_SPIKE_CHANCE) {
    // Voltage breach — outside 200-250 range
    voltage = Math.random() < 0.5 ? 260 + Math.random() * 40 : 150 + Math.random() * 40;
  }

  if (Math.random() < TEMP_SPIKE_CHANCE) {
    // Temperature breach — above 85°C
    temperature = 86 + Math.random() * 30;
  }

  if (Math.random() < RATE_CHANGE_CHANCE) {
    // Rate-of-change spike — jump voltage by >20%
    voltage = voltage * (1.25 + Math.random() * 0.5);
  }

  return {
    sensor_id: sensorId,
    timestamp: now,
    voltage: parseFloat(voltage.toFixed(2)),
    current: parseFloat(current.toFixed(2)),
    temperature: parseFloat(temperature.toFixed(2)),
    status_code: 'OK',
  };
}

async function runSimulatorTick(): Promise<void> {
  // Fetch fresh sensor IDs on every tick so seed data is picked up automatically
  const sensorsResult = await db.query(`SELECT id FROM sensors ORDER BY random() LIMIT 200`);
  const sensorIds: string[] = sensorsResult.rows.map((r: { id: string }) => r.id);

  if (sensorIds.length === 0) {
    console.log('[simulator] No sensors found — waiting for seed...');
    return;
  }

  // Pick random subset of sensors for this tick
  const shuffled = [...sensorIds].sort(() => Math.random() - 0.5);
  const batch = shuffled.slice(0, SENSORS_PER_TICK);
  const readings = batch.map(generateReading);

  // Write to ingest_queue and process
  const queueResult = await db.query(
    `INSERT INTO ingest_queue (payload) VALUES ($1) RETURNING id`,
    [JSON.stringify(readings)]
  );
  const queueId = queueResult.rows[0].id;

  processIngestBatch(queueId, readings).catch((err) => {
    console.error('[simulator] Batch processing error:', err);
  });
}

export async function startSimulator(): Promise<void> {
  console.log(`[simulator] Starting — sending ${SENSORS_PER_TICK} readings every ${INTERVAL_MS / 1000}s`);
  runSimulatorTick().catch(console.error);
  setInterval(() => {
    runSimulatorTick().catch(console.error);
  }, INTERVAL_MS);
}
