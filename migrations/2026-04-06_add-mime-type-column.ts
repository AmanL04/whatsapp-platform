import type Database from 'better-sqlite3'

/**
 * Add mime_type column to messages table.
 *
 * The column was added to CREATE TABLE IF NOT EXISTS but existing prod DBs
 * created before this change don't have it, causing upsertMessage to crash.
 */
export function up(db: Database.Database): void {
  // Check if column already exists (safe to re-run)
  const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]
  if (cols.some(c => c.name === 'mime_type')) {
    console.log('[migrations] add-mime-type-column: column already exists, skipping')
    return
  }

  db.exec('ALTER TABLE messages ADD COLUMN mime_type TEXT')
  console.log('[migrations] add-mime-type-column: added mime_type column to messages')
}
