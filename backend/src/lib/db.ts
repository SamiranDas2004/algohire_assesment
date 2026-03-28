import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

export const db = new Pool(
  connectionString
    ? { connectionString, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 2000 }
    : {
        host: 'localhost',
        port: 5432,
        user: 'gridwatch',
        password: 'gridwatch',
        database: 'gridwatch',
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
);
