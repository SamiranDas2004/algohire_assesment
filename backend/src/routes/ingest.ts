import { Router, Response } from 'express';
import { z } from 'zod';
import { db } from '../lib/db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { processIngestBatch } from '../workers/anomalyWorker';

export const ingestRouter = Router();

const ReadingSchema = z.object({
  sensor_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  voltage: z.number(),
  current: z.number(),
  temperature: z.number(),
  status_code: z.string(),
});

const IngestSchema = z.object({
  readings: z.array(ReadingSchema).min(1).max(1000),
});

ingestRouter.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = IngestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const { readings } = parsed.data;

  const result = await db.query(
    `INSERT INTO ingest_queue (payload) VALUES ($1) RETURNING id`,
    [JSON.stringify(readings)]
  );
  const queueId = result.rows[0].id;

  res.status(202).json({ queued: readings.length, queue_id: queueId });

  setImmediate(() => {
    processIngestBatch(queueId, readings).catch((err) => {
      console.error(`[ingest] Failed to process queue ${queueId}:`, err);
    });
  });
});
