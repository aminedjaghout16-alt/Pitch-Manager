// ─── Pitch Manager - PostgreSQL Database Layer ──────────────────────────────
// Works with: Supabase, Neon, Vercel Postgres, local PostgreSQL
// Set DATABASE_URL env var to connect. Falls back to localhost for dev.

const { Pool } = require('pg');

// Connection string: works with Supabase, Neon, Vercel Postgres, or local
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://pitchmanager:pitchmanager123@localhost:5432/pitchmanager';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,                    // Max connections (serverless safe)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err.message);
});

// ─── Query Helpers ────────────────────────────────────────────────────────────

// Run a query with parameters
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 100) {
    console.log(`[DB] Slow query (${duration}ms):`, text.substring(0, 80));
  }
  return res;
}

// Get a single row or null
async function queryOne(text, params) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

// Get all rows
async function queryAll(text, params) {
  const res = await query(text, params);
  return res.rows;
}

// Transaction helper
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ─── Schema Initialization ────────────────────────────────────────────────────

async function ensureSchema() {
  const fs = require('fs');
  const path = require('path');
  const schemaPath = path.join(__dirname, 'schema.sql');
  
  if (fs.existsSync(schemaPath)) {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    try {
      // Split by semicolons and run each statement separately
      const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for(const stmt of statements) {
        try {
          await pool.query(stmt);
        } catch(e) {
          // Ignore "already exists" and similar non-critical errors
          if(!e.message.includes('already exists') && 
             !e.message.includes('duplicate key') &&
             !e.message.includes('constraint') &&
             !e.message.includes('relation')) {
            console.log(`[DB] Schema stmt warning: ${e.message.substring(0, 80)}`);
          }
        }
      }
      console.log('[DB] Schema verified');
    } catch (err) {
      console.error('[DB] Schema init error:', err.message);
    }
  }
}

// ─── Health Check ─────────────────────────────────────────────────────────────

async function healthCheck() {
  try {
    const res = await pool.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('[DB] Health check failed:', err.message);
    return false;
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function close() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  queryOne,
  queryAll,
  transaction,
  ensureSchema,
  healthCheck,
  close,
};
