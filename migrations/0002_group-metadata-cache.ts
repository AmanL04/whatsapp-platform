import type Database from 'better-sqlite3'

/**
 * Add group metadata columns + fix indexes.
 *
 * Schema:
 * - chats.participants (TEXT, JSON) — cached group participant list
 * - chats.group_metadata_updated_at (INTEGER) — staleness tracking
 *
 * Indexes:
 * - Add idx_messages_sender — speeds up cascadeNormalize (UPDATE WHERE sender_id = ?)
 * - Add idx_chats_group — partial index for group-only queries
 * - Drop idx_reactions_message — redundant with composite PK (message_id, sender_id)
 */
export function up(db: Database.Database) {
  // New columns
  const cols = (db.pragma('table_info(chats)') as { name: string }[]).map(c => c.name)
  if (!cols.includes('participants')) {
    db.exec('ALTER TABLE chats ADD COLUMN participants TEXT')
  }
  if (!cols.includes('group_metadata_updated_at')) {
    db.exec('ALTER TABLE chats ADD COLUMN group_metadata_updated_at INTEGER')
  }

  // New indexes (IF NOT EXISTS — safe if init() already created them on fresh DB)
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_chats_group ON chats(is_group) WHERE is_group = 1')

  // Drop redundant index (composite PK already covers message_id lookups)
  db.exec('DROP INDEX IF EXISTS idx_reactions_message')
}
