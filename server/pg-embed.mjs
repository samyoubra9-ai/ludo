import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function isLoopback(url) {
  try {
    const host = new URL(url).hostname
    return host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}

async function canConnect(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    await client.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    try {
      await client.end()
    } catch {
      /* closed */
    }
  }
}

export async function ensureLocalPostgres(databaseUrl) {
  if (process.env.EMBEDDED_PG === '0') return false
  if (!isLoopback(databaseUrl)) return false
  if (await canConnect(databaseUrl)) return true

  const { default: EmbeddedPostgres } = await import('embedded-postgres')
  const parsed = new URL(databaseUrl)
  const dir = join(root, 'data', 'pg')
  mkdirSync(dir, { recursive: true })

  const cluster = new EmbeddedPostgres({
    databaseDir: dir,
    user: decodeURIComponent(parsed.username || 'ludo'),
    password: decodeURIComponent(parsed.password || 'ludo'),
    port: Number(parsed.port || 5432),
    persistent: true,
    onLog: () => {},
    onError: () => {},
  })

  if (!existsSync(join(dir, 'PG_VERSION'))) {
    await cluster.initialise()
  }

  try {
    await cluster.start()
  } catch {
    if (await canConnect(databaseUrl)) {
      console.log('PostgreSQL local déjà lancé.')
      return true
    }
    throw new Error('Impossible de démarrer PostgreSQL local.')
  }

  const name = decodeURIComponent((parsed.pathname || '/ludo').replace(/^\//, '') || 'ludo')
  try {
    await cluster.createDatabase(name)
  } catch {
    /* already exists */
  }

  console.log('PostgreSQL local prêt.')
  return true
}
