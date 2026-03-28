import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { authRouter } from './routes/auth';
import { ingestRouter } from './routes/ingest';
import { sensorsRouter } from './routes/sensors';
import { alertsRouter } from './routes/alerts';
import { initWebSocket } from './lib/websocket';
import { startSilenceDetector } from './workers/silenceWorker';
import { startEscalationWorker } from './workers/escalationWorker';
import { startSimulator } from './workers/simulatorWorker';
import { db } from './lib/db';

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(compression());
app.use(express.json({ limit: '5mb' }));

app.use('/auth', authRouter);
app.use('/ingest', ingestRouter);
app.use('/sensors', sensorsRouter);
app.use('/alerts', alertsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

const httpServer = http.createServer(app);
initWebSocket(httpServer);

const PORT = parseInt(process.env.PORT || '4000');

async function start(): Promise<void> {
  await db.query('SELECT 1');

  httpServer.listen(PORT, () => {
    console.log(`[server] GridWatch backend running on port ${PORT}`);
  });

  startSilenceDetector();
  startEscalationWorker();
  startSimulator();
}

start().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
