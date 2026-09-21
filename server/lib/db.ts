

import pg from 'pg';

const DB_HOST = process.env.DB_HOST || '';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_USER = process.env.DB_USER || '';
const DB_PASS = process.env.DB_PASS || '';
const DB_NAME = process.env.DB_NAME || '';

export const pool = new pg.Pool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 10000,
  max: 5,
});

let status = {
  connected: false,
  host: DB_HOST,
  database: DB_NAME,
  error: 'Belum pernah dicoba' as string | null,
};

pool.on('error', (err) => {
  // Prevents an idle client error from crashing the whole Node process.
  console.error('[DB Lokal] Idle client error:', err.message);
});

export async function checkLocalDb(): Promise<typeof status> {
  try {
    const client = await pool.connect();
    client.release();
    status = { connected: true, host: DB_HOST, database: DB_NAME, error: null };
  } catch (err: any) {
    status = {
      connected: false,
      host: DB_HOST,
      database: DB_NAME,
      error: err.message || 'Tidak bisa konek ke database lokal',
    };
  }
  return status;
}

export function getDbStatus() {
  return status;
}

export async function queryLocal<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  try {
    const result = await pool.query(sql, params);
    if (!status.connected) status = { ...status, connected: true, error: null };
    return result.rows;
  } catch (err: any) {
    status = { connected: false, host: DB_HOST, database: DB_NAME, error: err.message };
    throw err;
  }
}

export function pgEscape(value: string): string {

  return String(value).replace(/'/g, "''");
}
