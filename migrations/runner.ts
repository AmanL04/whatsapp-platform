import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'

export type MigrationFn = (db: Database.Database) => void

/**
 * Runs all pending migrations from the migrations/ directory.
 * Opens its own DB connection, runs migrations, then closes it.
 * Call this BEFORE creating the store/adapter so schema is ready.
 *
 * Each migration file exports an `up(db)` function.
 * Filenames are sorted alphabetically — use numeric prefixes for ordering.
 * Each migration runs in a transaction. Successfully run migrations are
 * recorded in the `migrations` table and never run again.
 */
export function runMigrations(dbPath: string) {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  try {
    _runMigrations(db)
  } finally {
    db.close()
  }
}

function _runMigrations(db: Database.Database) {
  // Ensure migrations tracking table exists
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at INTEGER)')

  // Get already-run migrations
  const ran = new Set(
    (db.prepare('SELECT name FROM migrations').all() as { name: string }[]).map(r => r.name)
  )

  // Find migration files (exclude runner infrastructure)
  const migrationsDir = path.join(__dirname)
  const exclude = new Set(['runner.ts', 'run.ts'])
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.ts') && !exclude.has(f))
    .sort()

  console.log(`[migrations] found ${files.length} migration files, ${ran.size} already ran`)

  let count = 0
  for (const file of files) {
    const name = file.replace(/\.ts$/, '')
    if (ran.has(name)) continue

    console.log(`[migrations] running: ${name}`)
    try {
      // Dynamic import won't work with tsx synchronously, so use require
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const migration = require(path.join(migrationsDir, file))
      const up: MigrationFn = migration.up ?? migration.default

      if (typeof up !== 'function') {
        console.error(`[migrations] ${name}: no up() function exported, skipping`)
        continue
      }

      db.exec('BEGIN')
      try {
        up(db)
        db.prepare('INSERT INTO migrations (name, ran_at) VALUES (?, ?)').run(name, Math.floor(Date.now() / 1000))
        db.exec('COMMIT')
        console.log(`[migrations] completed: ${name}`)
        count++
      } catch (err) {
        db.exec('ROLLBACK')
        console.error(`[migrations] failed: ${name}`, err)
      }
    } catch (err) {
      console.error(`[migrations] could not load: ${name}`, err)
    }
  }

  if (count > 0) console.log(`[migrations] ran ${count} migration(s)`)
}
