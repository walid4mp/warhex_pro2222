/**
 * migrate.js — Run database migrations in order.
 * Usage: node src/migrate.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const logger = require('./logger');

async function main() {
  const cs = process.env.DATABASE_URL;
  if (!cs || cs.includes('user:password@localhost')) {
    logger.warn('No DATABASE_URL — migrations skipped (JSON mode)');
    return;
  }
  const pool = new Pool({ connectionString: cs, ssl: process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined });

  // Create migrations table
  await pool.query(`CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL, run_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  const dir = path.join(__dirname, '..', 'database', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  for (const f of files) {
    const ran = await pool.query('SELECT 1 FROM migrations WHERE name=$1', [f]);
    if (ran.rows.length > 0) { logger.info(`Skipping ${f} (already applied)`); continue; }
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO migrations (name) VALUES ($1)', [f]);
    logger.info(`Applied migration: ${f}`);
  }

  await pool.end();
  logger.info('Migrations complete.');
}

main().catch(e => { logger.error('Migration failed', { error: e.message }); process.exit(1); });
