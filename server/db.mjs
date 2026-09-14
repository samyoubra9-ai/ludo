import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadDotEnv() {
  const file = join(root, '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key] || key.startsWith('SOLANA_')) process.env[key] = value
  }
}

loadDotEnv()

pg.types.setTypeParser(20, (value) => Number(value))

const DATABASE_URL = String(process.env.DATABASE_URL || 'postgres://ludo:ludo@127.0.0.1:5432/ludo')

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 12,
})

const txStore = new AsyncLocalStorage()

function numbered(text) {
  let i = 0
  return String(text).replace(/\?/g, () => `$${++i}`)
}

async function query(text, params = []) {
  const client = txStore.getStore() || pool
  return client.query(numbered(text), params)
}

function statement(text) {
  return {
    async get(...params) {
      const { rows } = await query(text, params)
      return rows[0]
    },
    async all(...params) {
      const { rows } = await query(text, params)
      return rows
    },
    async run(...params) {
      const result = await query(text, params)
      return { changes: result.rowCount ?? 0 }
    },
  }
}

export const db = {
  prepare: statement,
  async exec(sql) {
    const client = txStore.getStore() || pool
    await client.query(sql)
  },
}

export function sql(text) {
  return statement(text)
}

export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await txStore.run(client, fn)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* already closed */
    }
    throw error
  } finally {
    client.release()
  }
}

export async function pingDb() {
  await pool.query('SELECT 1')
}

export async function initDb() {
  try {
    await pingDb()
  } catch (first) {
    try {
      const { ensureLocalPostgres } = await import('./pg-embed.mjs')
      await ensureLocalPostgres(DATABASE_URL)
      await pingDb()
    } catch (error) {
      console.error('PostgreSQL injoignable. Démarre une base, par ex. : docker compose up -d postgres')
      console.error(`DATABASE_URL=${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`)
      throw first.cause ? error : first
    }
  }
  const schema = `
    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      coins INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      telegram_id BIGINT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      address TEXT NOT NULL REFERENCES wallets(address),
      expires_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL REFERENCES wallets(address),
      stake INTEGER NOT NULL,
      players INTEGER NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0,
      won INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shop_orders (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL REFERENCES wallets(address),
      pack_id TEXT NOT NULL,
      coins INTEGER NOT NULL,
      usdt DOUBLE PRECISION NOT NULL,
      tx_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid',
      expected_raw TEXT NOT NULL DEFAULT '0',
      tx_sig TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL REFERENCES wallets(address),
      dest TEXT NOT NULL,
      tokens DOUBLE PRECISION NOT NULL,
      coins INTEGER NOT NULL,
      status TEXT NOT NULL,
      tx_sig TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    ALTER TABLE wallets ADD COLUMN IF NOT EXISTS telegram_id BIGINT;
    ALTER TABLE wallets ADD COLUMN IF NOT EXISTS last_seen BIGINT;
    CREATE UNIQUE INDEX IF NOT EXISTS wallets_telegram_id
      ON wallets (telegram_id) WHERE telegram_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS wallets_last_seen ON wallets (last_seen);
    CREATE INDEX IF NOT EXISTS sessions_address ON sessions(address);
    CREATE INDEX IF NOT EXISTS matches_address_settled ON matches(address, settled);
    CREATE INDEX IF NOT EXISTS shop_orders_address ON shop_orders(address);
    CREATE INDEX IF NOT EXISTS withdrawals_address ON withdrawals(address);
    CREATE UNIQUE INDEX IF NOT EXISTS shop_orders_tx_sig_unique
      ON shop_orders (tx_sig) WHERE tx_sig <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_one_pending
      ON withdrawals (address) WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      address TEXT UNIQUE NOT NULL REFERENCES wallets(address),
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_sessions (
      token TEXT PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );

    ALTER TABLE wallets ADD COLUMN IF NOT EXISTS kiosk_id INTEGER REFERENCES agents(id);

    ALTER TABLE agents ADD COLUMN IF NOT EXISTS sell_da INTEGER NOT NULL DEFAULT 230;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS buy_da INTEGER NOT NULL DEFAULT 230;

    CREATE TABLE IF NOT EXISTS kiosk_ops (
      id TEXT PRIMARY KEY,
      agent_id INTEGER NOT NULL REFERENCES agents(id),
      client_address TEXT NOT NULL,
      kind TEXT NOT NULL,
      coins INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    ALTER TABLE kiosk_ops ADD COLUMN IF NOT EXISTS da INTEGER NOT NULL DEFAULT 0;

    CREATE UNIQUE INDEX IF NOT EXISTS agents_name_lower ON agents (LOWER(name));
    CREATE INDEX IF NOT EXISTS kiosk_ops_agent ON kiosk_ops (agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS wallets_kiosk ON wallets (kiosk_id);

    CREATE TABLE IF NOT EXISTS center_apps (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      address TEXT NOT NULL REFERENCES wallets(address),
      name TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS center_apps_status ON center_apps (status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS center_apps_one_pending
      ON center_apps (address) WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS admin_grants (
      id TEXT PRIMARY KEY,
      admin_id INTEGER REFERENCES admins(id),
      address TEXT NOT NULL,
      coins INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_grants_created ON admin_grants (created_at DESC);
  `
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(728401)')
    for (const text of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
      try {
        await client.query(text)
      } catch (error) {
        if (error.code === '23505' || error.code === '42P07') continue
        throw error
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(728401)')
    } catch {
      /* ignore */
    }
    client.release()
  }
  await importSqliteIfEmpty()
}

async function importSqliteIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM wallets')
  if (rows[0]?.n) return
  const file = join(root, 'data', 'ludo.sqlite')
  if (!existsSync(file)) return
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const old = new DatabaseSync(file, { readOnly: true })
    const copy = async (table, columns) => {
      try {
        const items = old.prepare(`SELECT * FROM ${table}`).all()
        for (const row of items) {
          const marks = columns.map(() => '?').join(', ')
          await statement(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${marks}) ON CONFLICT DO NOTHING`,
          ).run(...columns.map((col) => row[col] ?? (col === 'won' ? null : col.endsWith('_at') ? '' : 0)))
        }
      } catch (error) {
        console.warn(`Import ${table} ignoré:`, error.message)
      }
    }
    await copy('wallets', ['address', 'token_hash', 'coins', 'created_at', 'updated_at'])
    await copy('sessions', ['token', 'address', 'expires_at'])
    await copy('matches', ['id', 'address', 'stake', 'players', 'settled', 'won', 'created_at'])
    await copy('shop_orders', [
      'id',
      'address',
      'pack_id',
      'coins',
      'usdt',
      'tx_hash',
      'created_at',
      'status',
      'expected_raw',
      'tx_sig',
    ])
    await copy('withdrawals', [
      'id',
      'address',
      'dest',
      'tokens',
      'coins',
      'status',
      'tx_sig',
      'error',
      'created_at',
    ])
    old.close()
    console.log('SQLite importé dans PostgreSQL.')
  } catch (error) {
    console.warn('Import SQLite ignoré:', error.message)
  }
}

export { pool, DATABASE_URL }
