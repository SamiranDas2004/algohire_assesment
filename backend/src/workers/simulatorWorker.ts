import { db } from '../lib/db';
import { processIngestBatch } from './anomalyWorker';
import { IngestReading } from '../lib/types';

const INTERVAL_MS = 10_000;
const SENSORS_PER_TICK = 50;

const VOLTAGE_SPIKE_CHANCE = 0.05;
const TEMP_SPIKE_CHANCE = 0.05;
const RATE_CHANGE_CHANCE = 0.05;

function generateReading(sensorId: string): IngestReading {
  const now = new Date().toISOString();

  let voltage = 215 + Math.random() * 20;
  let temperature = 35 + Math.random() * 20;
  const current = 9 + Math.random() * 2;

  if (Math.random() < VOLTAGE_SPIKE_CHANCE) {
    voltage = Math.random() < 0.5 ? 260 + Math.random() * 40 : 150 + Math.random() * 40;
  }

  if (Math.random() < TEMP_SPIKE_CHANCE) {
    temperature = 86 + Math.random() * 30;
  }

  if (Math.random() < RATE_CHANGE_CHANCE) {
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
  const sensorsResult = await db.query(`SELECT id FROM sensors ORDER BY random() LIMIT 200`);
  const sensorIds: string[] = sensorsResult.rows.map((r: { id: string }) => r.id);

  if (sensorIds.length === 0) {
    console.log('[simulator] No sensors found — waiting for seed...');
    return;
  }

  const shuffled = [...sensorIds].sort(() => Math.random() - 0.5);
  const batch = shuffled.slice(0, SENSORS_PER_TICK);
  const readings = batch.map(generateReading);

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
