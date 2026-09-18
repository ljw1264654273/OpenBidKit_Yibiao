import { Pool } from 'pg';
import { createApp } from './app.js';

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const trustProxy = process.env.TRUST_PROXY === 'true';
const pool = new Pool({ connectionString: databaseUrl });
const app = createApp(pool, trustProxy);

async function start() {
  try {
    await pool.query('SELECT 1');
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    await pool.end();
    process.exitCode = 1;
  }
}

async function close() {
  await app.close();
  await pool.end();
}

process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
void start();
