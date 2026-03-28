# GridWatch — Real-Time Infrastructure Anomaly Detection Platform

GridWatch is an operational platform for power distribution companies to ingest sensor data, detect anomalies, manage alerts, and give field operators a live view of their zones.

---

## 1. Setup

### Prerequisites
- Docker and Docker Compose installed
- Ports 3000, 4000, 5432, 6379 available

### One command to run everything

```bash
docker compose up
```

This starts Postgres, Redis, the backend, and the frontend. The schema is automatically applied on first boot via `docker-entrypoint-initdb.d`.

### Seed the database

After the stack is up, run the seed in a separate terminal:

```bash
docker compose --profile seed run seed
```

Or if running the backend locally:

```bash
cd backend
npm run seed
```

### Local development (recommended for active development)

Start Postgres and Redis in Docker, run the backend and frontend locally:

```bash
# Terminal 1 — infrastructure
docker compose up postgres redis

# Terminal 2 — backend
cd backend
npm install
npm run dev

# Terminal 3 — frontend
cd frontend/gridwatch
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`, backend on `http://localhost:4000`.

### Seed credentials

| Role | Email | Password | Zone Access |
|---|---|---|---|
| Supervisor | supervisor@gridwatch.io | supervisor123 | All zones |
| Operator 1 | operator1@gridwatch.io | operator1123 | Zone Alpha only |
| Operator 2 | operator2@gridwatch.io | operator2123 | Zone Beta only |

---

## 2. Architecture

### Data flow

```
Sensor Hardware
      |
      v
POST /ingest
      |
      |-- 1. Validate payload (Zod)
      |-- 2. Write batch to ingest_queue (PostgreSQL) <-- durable, before response
      |-- 3. Respond 202 immediately
      |
      v
processIngestBatch() [async, setImmediate]
      |
      |-- Insert readings into readings table
      |-- Evaluate Rule A (threshold) per reading per rule
      |-- Evaluate Rule B (rate of change) per reading per rule
      |-- Create anomaly records
      |-- Create alert records
      |-- Update sensor.status + last_seen_at
      |-- Publish to Redis: zone:<zoneId>:sensor_state
      |
      v
Redis Pub/Sub
      |
      v
WebSocket Server (Socket.io)
      |
      |-- Subscribed to zone:*:sensor_state via psubscribe
      |-- Forwards events only to sockets in matching zone room
      |
      v
Browser (operator dashboard)
      |
      v
Sensor card updates in real time (< 3 seconds)
```

### Background jobs

Three workers run independently on server boot:

- **silenceWorker** — runs every 30 seconds, finds sensors with `last_seen_at` older than 2 minutes, creates `pattern_absence` anomaly and marks sensor `silent`
- **escalationWorker** — runs every 30 seconds, finds critical open alerts older than 5 minutes that have not been escalated, reassigns to supervisor, writes to `escalation_log`
- **simulatorWorker** — runs every 10 seconds, sends realistic readings for 50 random sensors with occasional anomaly injections so the system demonstrates live behavior without manual input

### Tech stack

- Backend: Node.js, TypeScript, Express, Socket.io, ioredis, pg
- Frontend: React, TypeScript, Vite, Tailwind CSS, Shadcn UI, socket.io-client
- Database: PostgreSQL 16
- Cache / Pub-Sub: Redis 7

---

## 3. Schema Decisions

### Tables

**zones** — simple lookup table for geographic zones. Kept separate so zone assignments can be managed independently of users and sensors.

**users** — stores both operators and supervisors in one table with a `role` column. Supervisors have a `supervisor_id` of NULL. Operators have a `supervisor_id` pointing to their supervisor, used during escalation to find who to reassign to.

**zone_assignments** — many-to-many between users and zones. Operators can be assigned to multiple zones. Supervisors bypass this table entirely — they get unrestricted access at the query layer.

**sensors** — one row per physical sensor. Stores `status` and `last_seen_at` as denormalized columns so the dashboard query is a single table scan rather than an aggregation over readings. Status is updated on every ingest and by the silence worker.

**sensor_rules** — per-sensor detection rules. Storing rules in Postgres rather than code means operators can configure thresholds without a deployment. Each rule has a `rule_type` (threshold or rate_of_change), a `metric` (voltage, current, temperature), and the relevant threshold values. Severity is per rule so a voltage breach can be critical while a temperature warning is just a warning.

**readings** — raw sensor data. Append-only. The primary index is `(sensor_id, timestamp DESC)` which is the exact access pattern for both the history query and the rate-of-change calculation. A secondary index on `timestamp DESC` alone supports time-range queries across all sensors.

**ingest_queue** — the durability buffer. Every ingest batch is written here before the endpoint responds. If processing fails, the row stays with `status='failed'` and the error message. This means no reading is ever silently dropped — failed batches can be replayed. The partial index on `status IN ('pending', 'failed')` keeps this index small as processed rows are excluded.

**anomalies** — one row per rule violation per reading. A single reading can produce multiple anomaly rows if it violates multiple rules. Linked to `reading_id` (nullable — pattern_absence anomalies have no reading). The `suppressed` flag is set at creation time based on whether an active suppression window exists.

**alerts** — one row per anomaly. Stores the full lifecycle state. The `escalated` boolean with a UNIQUE constraint on `escalation_log.alert_id` provides the exactly-once escalation guarantee. The partial index `WHERE status = 'open' AND severity = 'critical' AND escalated = FALSE` makes the escalation worker query fast even with millions of alerts.

**alert_audit_log** — append-only transition history. No UPDATE or DELETE ever touches this table. Every status change writes a new row with who changed it, from what, to what, and when.

**escalation_log** — separate table as required. Has a UNIQUE constraint on `alert_id` so even if the escalation worker runs twice concurrently, only one row is ever written.

**suppressions** — time-windowed suppression records per sensor. Checked at anomaly creation time via a range query on `(sensor_id, start_time, end_time)`.

### Key indexes

```sql
-- History query: sensor_id + time range, most recent first
idx_readings_sensor_ts ON readings(sensor_id, timestamp DESC)

-- Silence worker: find sensors not seen recently
idx_sensors_last_seen ON sensors(last_seen_at)

-- Escalation worker: partial index, only rows that need checking
idx_alerts_escalation ON alerts(created_at)
  WHERE status = 'open' AND severity = 'critical' AND escalated = FALSE

-- Ingest queue: only pending/failed rows, processed rows excluded
idx_ingest_queue_status ON ingest_queue(status)
  WHERE status IN ('pending', 'failed')

-- Suppression lookup: active window check
idx_suppressions_active ON suppressions(sensor_id, start_time, end_time)
```

---

## 4. Real-Time Design

The dashboard updates without polling. Here is exactly how it works:

1. When a sensor's status changes (during ingest processing or silence detection), the backend publishes a message to a Redis channel named `zone:<zoneId>:sensor_state`. The message contains `sensor_id`, `status`, and `timestamp`.

2. The WebSocket server uses `redisSub.psubscribe('zone:*:sensor_state')` — a single pattern subscription that catches all zone channels. When a message arrives, it extracts the zone ID from the channel name and calls `io.to('zone:<zoneId>').emit('sensor_state_change', data)`.

3. On the frontend, each connected socket joins rooms corresponding to the operator's assigned zones. Operators only join their own zone rooms. Supervisors join all zone rooms. This means zone isolation is enforced at the WebSocket layer too — an operator in Zone Alpha will never receive an event for a Zone Beta sensor.

4. The React dashboard listens for `sensor_state_change` events and updates the sensor's status in local state. No HTTP request is made. The card re-renders immediately.

The Redis pub/sub layer exists so this scales horizontally. If you run multiple backend instances behind a load balancer, each instance subscribes to Redis and can forward events to its own connected sockets. Without Redis, a state change processed by instance A would never reach clients connected to instance B.

End-to-end latency from ingest to dashboard update is typically under 500ms in local testing, well within the 3-second requirement.

---

## 5. What I Finished and What I Cut

### Finished and working

- Ingest pipeline with durable queue and async processing
- All three anomaly detection rules (A, B, C)
- Full alert lifecycle with valid transition enforcement
- Append-only audit log on every transition
- Auto-escalation with exactly-once guarantee
- Zone isolation enforced at the SQL layer on every query
- Suppression API with time windows
- Historical query endpoint with anomaly and alert flags, paginated
- WebSocket real-time layer with zone-scoped delivery
- Live sensor dashboard with real-time status updates
- Alert management panel with acknowledge/resolve and audit trail
- Sensor detail view with active anomalies, readings, suppression status
- Sensor simulator that auto-generates readings every 10 seconds
- Docker Compose setup with schema auto-applied on first boot
- Seed script with 1002 sensors across 3 zones, 2 operators, 1 supervisor, 48h of readings

### Cut or simplified

- No user management UI — operators and supervisors are created via seed only
- No rule configuration UI — sensor rules are seeded, not editable through the frontend
- No notification system — suppressed anomalies are recorded but there is no email or webhook delivery for unsuppressed ones either. The assessment did not explicitly require a notification transport, only that suppressed ones do not produce notifications.
- Readings are seeded for only 50 of the 1002 sensors to keep seed time under 2 minutes. The other 952 sensors have `last_seen_at` set to NOW() so they start healthy and receive readings from the simulator.
- No rate limiting on the ingest endpoint. In production this would be essential.
- The historical query uses offset pagination rather than keyset pagination. For very large datasets keyset would be faster but offset is simpler and meets the 300ms requirement on 30 days of data for a single sensor given the composite index.

### Suppression edge case — alert already open when suppression is created

When a suppression window is created for a sensor that already has open alerts, those existing alerts are left as-is. They remain open and are not retroactively marked suppressed. Only anomalies and alerts created after the suppression window becomes active are marked suppressed.

The reasoning: a suppression window represents a planned maintenance period going forward. Alerts that fired before the maintenance window was created are legitimate — an operator already saw them and they may need acknowledgement or investigation. Retroactively suppressing them would silently hide real events that were already visible in the system.

If the requirement were to suppress existing open alerts too, the correct approach would be to run an UPDATE on alerts for that sensor at suppression creation time and log the change in the audit trail. That is a one-line change but the decision to do it should be explicit, not automatic.

---

## 6. The Three Hardest Problems

### 1. Exactly-once escalation

The requirement says escalation must fire exactly once per alert and duplicate escalations are a bug. The naive approach — check if escalated, then update — has a race condition if two worker instances run simultaneously.

The solution uses two layers of protection. First, the UPDATE statement itself is conditional: `UPDATE alerts SET escalated = TRUE WHERE id = $1 AND escalated = FALSE AND status = 'open'`. This is atomic at the database level. If two workers race, only one will get a row back from `RETURNING id`. The second layer is the UNIQUE constraint on `escalation_log.alert_id` with `ON CONFLICT DO NOTHING`. Even if somehow two processes both pass the UPDATE check, only one escalation_log row will ever be written.

### 2. Zone isolation at the data layer

The requirement says zone isolation must be enforced at the data layer, not just the UI. This means an operator who crafts a raw HTTP request with a valid token must still not be able to see data from other zones.

Every query that touches sensors, readings, or alerts goes through a `zoneScopeSQL()` helper that injects a `WHERE zone_id IN (...)` clause using the zone IDs from the JWT payload. Supervisors get an empty clause. The JWT is signed server-side and contains the operator's assigned zone IDs baked in at login time. There is no way for a client to expand their zone access without a new token issued by the server.

The WebSocket layer enforces the same isolation — operators only join Socket.io rooms for their assigned zones, so they physically cannot receive events for other zones.

### 3. Sub-200ms ingest with durability guarantee

The requirement says the endpoint must respond in under 200ms AND every reading must be durably stored before the response. These two requirements pull in opposite directions — durability usually means waiting for processing to complete.

The solution is to separate durability from processing. The endpoint writes the entire batch as a single JSON blob to the `ingest_queue` table in one INSERT, then responds 202. The actual anomaly detection runs asynchronously via `setImmediate`. The reading is durable the moment the INSERT commits — if the process crashes after responding but before processing, the queue row stays with `status='pending'` and can be replayed. The response time is bounded by a single INSERT, not by anomaly detection which involves multiple queries per reading.

---

## 7. Production Gap

The biggest gap between this implementation and production is the ingest queue processor. Right now, `processIngestBatch` runs in the same Node.js process as the HTTP server via `setImmediate`. Under sustained load of 10,000 readings per minute, the event loop will eventually back up — the async processing is not truly isolated from the web server.

In production I would move anomaly detection to a separate worker process or service that pulls from the ingest_queue table using `SELECT ... FOR UPDATE SKIP LOCKED`. This pattern gives you:

- True process isolation — a slow anomaly detection batch does not affect ingest response times
- Horizontal scaling — run multiple worker processes, each claiming queue rows atomically
- Backpressure visibility — queue depth becomes a metric you can alert on
- Crash recovery — if a worker dies mid-batch, the row stays `processing` and a separate cleanup job can reset it to `pending` after a timeout

The `SKIP LOCKED` approach is a well-understood pattern for building reliable job queues on top of Postgres without adding a separate queue service. It would be the first thing I would implement before putting this system under real load.
