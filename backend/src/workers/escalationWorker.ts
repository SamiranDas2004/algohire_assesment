import { db } from '../lib/db';

const ESCALATION_THRESHOLD_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 30 * 1000;

export function startEscalationWorker(): void {
  console.log('[escalation] Escalation worker started');
  setInterval(runEscalation, POLL_INTERVAL_MS);
  runEscalation().catch(console.error);
}

async function runEscalation(): Promise<void> {
  const cutoff = new Date(Date.now() - ESCALATION_THRESHOLD_MS).toISOString();

  const result = await db.query(
    `SELECT al.id, al.sensor_id, al.assigned_to, s.zone_id
     FROM alerts al
     JOIN sensors s ON s.id = al.sensor_id
     WHERE al.status = 'open'
       AND al.severity = 'critical'
       AND al.escalated = FALSE
       AND al.suppressed = FALSE
       AND al.created_at <= $1`,
    [cutoff]
  );

  for (const alert of result.rows) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const supervisorResult = await client.query(
        `SELECT u.id FROM users u WHERE u.role = 'supervisor' LIMIT 1`
      );
      const supervisor = supervisorResult.rows[0];
      if (!supervisor) {
        await client.query('ROLLBACK');
        continue;
      }

      const updateResult = await client.query(
        `UPDATE alerts
         SET escalated = TRUE, escalated_at = NOW(), assigned_to = $1, updated_at = NOW()
         WHERE id = $2 AND escalated = FALSE AND status = 'open'
         RETURNING id`,
        [supervisor.id, alert.id]
      );

      if (!updateResult.rows[0]) {
        await client.query('ROLLBACK');
        continue;
      }

      await client.query(
        `INSERT INTO escalation_log (alert_id, escalated_to) VALUES ($1, $2)
         ON CONFLICT (alert_id) DO NOTHING`,
        [alert.id, supervisor.id]
      );

      await client.query(
        `INSERT INTO alert_audit_log (alert_id, changed_by, from_status, to_status, note)
         VALUES ($1, NULL, 'open', 'open', 'Auto-escalated to supervisor')`,
        [alert.id]
      );

      await client.query('COMMIT');
      console.log(`[escalation] Alert ${alert.id} escalated to supervisor ${supervisor.id}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[escalation] Error escalating alert ${alert.id}:`, err);
    } finally {
      client.release();
    }
  }
}
