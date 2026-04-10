import type Database from 'better-sqlite3'

/**
 * Add deleted_at column to messages table for soft-delete tracking.
 */
export function up(db: Database.Database) {
  const cols = (db.pragma('table_info(messages)') as { name: string }[]).map(c => c.name)
  if (!cols.includes('deleted_at')) {
    db.exec('ALTER TABLE messages ADD COLUMN deleted_at INTEGER')
  }
}
