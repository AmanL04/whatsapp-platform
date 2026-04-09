import type Database from 'better-sqlite3'

/**
 * Add sent_by_app_id column to messages table.
 * Tracks which registered app (or "dashboard") sent a message via the API.
 * NULL = sent from phone/Beeper, not via API.
 */
export function up(db: Database.Database) {
  const cols = (db.pragma('table_info(messages)') as { name: string }[]).map(c => c.name)
  if (!cols.includes('sent_by_app_id')) {
    db.exec('ALTER TABLE messages ADD COLUMN sent_by_app_id TEXT')
  }
}
